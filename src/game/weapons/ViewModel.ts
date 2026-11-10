import type { WeaponId } from '../../types';
import {
  Color3,
  CreateBox,
  CreateCylinder,
  CreatePlane,
  Constants,
  Mesh,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Camera,
  type FreeCamera,
  type Scene,
} from '../rendering/babylon';
import { muzzleFlashTexture } from '../rendering/textures';
import type { WeaponSystem } from './WeaponSystem';
import type { PlacedSkin, WeaponSkin } from './WeaponSkins';
import { FirstPersonArms, type ArmsTemplate } from './FirstPersonArms';
import type { AnimatedArms } from './AnimatedArms';

interface GunModel {
  root: TransformNode;
  mag: TransformNode | null;
  /** Magazine rest height (its position.y when seated). */
  magBase: number;
  muzzle: TransformNode;
  hip: [number, number, number];
  adsPos: [number, number, number];
  flashScale: number;
  skin?: PlacedSkin;
  /** Where the hands hold the gun (gun-root space). With arms, the support point is the handguard's underside centre. */
  gripLocal: Vector3;
  supportLocal: Vector3 | null;
  /** Revolver cylinder: rest rotation, current and target turn (radians). */
  cylinder?: { node: TransformNode; rest: Quaternion; angle: number; target: number; step: number };
}

const VM_GROUP = 1;
const tmpCyl = new Quaternion();

export class ViewModel {
  private readonly holder: TransformNode;
  private readonly guns = new Map<WeaponId, GunModel>();
  private readonly mats = new Map<string, StandardMaterial>();
  private readonly flash: Mesh;
  private flashTime = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private kick = 0;
  private currentId: WeaponId | null = null;
  private arms: FirstPersonArms | null = null;
  /** Animated arms pack (replaces `arms` when loaded). */
  private animArms: AnimatedArms | null = null;
  private wasReloading = false;
  private reloadEmpty = false;
  private lastHands: { grip: [number, number, number]; front: [number, number, number] | null } = { grip: [0, -0.075, -0.08], front: null };
  visible = true;

  constructor(
    private readonly scene: Scene,
    camera: Camera,
    weaponIds: WeaponId[],
    skins: Map<WeaponId, WeaponSkin> = new Map(),
    armsTemplate: ArmsTemplate | null = null,
  ) {
    this.holder = new TransformNode('vm-holder', scene);
    this.holder.parent = camera;
    if (armsTemplate?.rig) {
      try {
        this.animArms = armsTemplate.rig.createArms(this.holder, VM_GROUP);
      } catch (err) {
        console.warn('[viewmodel] animated arms unavailable', err);
      }
    }
    if (armsTemplate && !this.animArms) {
      try {
        // the skinned glove model when loaded, otherwise the built-in arms
        this.arms = new FirstPersonArms(armsTemplate, this.holder, VM_GROUP);
      } catch (err) {
        console.warn('[viewmodel] first-person arms unavailable', err);
      }
    }
    for (const id of weaponIds) {
      const skin = skins.get(id);
      const gun = (skin ? this.buildSkinned(id, skin) : this.build(id)) as GunModel;
      gun.gripLocal = new Vector3(...this.lastHands.grip);
      gun.supportLocal = this.lastHands.front ? new Vector3(...this.lastHands.front) : null;
      if ((this.arms || this.animArms) && gun.supportLocal) gun.supportLocal = this.handguardUnderside(gun.root, gun.supportLocal);
      this.guns.set(id, gun);
    }

    const fm = new StandardMaterial('vm-flash', scene);
    fm.diffuseTexture = muzzleFlashTexture(scene);
    fm.diffuseTexture.hasAlpha = true;
    fm.emissiveColor = new Color3(1, 0.85, 0.6);
    fm.disableLighting = true;
    fm.useAlphaFromDiffuseTexture = true;
    fm.alphaMode = Constants.ALPHA_ADD;
    fm.backFaceCulling = false;
    this.flash = CreatePlane('vm-flash-plane', { size: 0.22 }, scene);
    this.flash.material = fm;
    this.flash.renderingGroupId = VM_GROUP;
    this.flash.isPickable = false;
    this.flash.setEnabled(false);
  }

  /**
   * The bottom of the handguard around the support-hand point (gun-root space), measured from the
   * gun's own meshes, so the arm's palm rests against it whatever the model. Falls back to `near`.
   */
  private handguardUnderside(root: TransformNode, near: Vector3): Vector3 {
    root.computeWorldMatrix(true);
    const inv = root.getWorldMatrix().clone().invert();
    const v = new Vector3();
    const z0 = near.z - 0.03;
    const z1 = near.z + 0.03;
    let yMin = Infinity;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const m of root.getChildMeshes(false)) {
      const pos = m.getVerticesData('position');
      const idx = m.getIndices();
      if (!pos || !idx) continue;
      const toRoot = m.computeWorldMatrix(true).multiply(inv);
      const p = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], toRoot, v);
        p[i] = v.x;
        p[i + 1] = v.y;
        p[i + 2] = v.z;
      }
      // every triangle that crosses the slab around the support point (low-poly boxes have no vertices inside it)
      for (let k = 0; k < idx.length; k += 3) {
        const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
        if (Math.max(p[a + 2], p[b + 2], p[c + 2]) < z0 || Math.min(p[a + 2], p[b + 2], p[c + 2]) > z1) continue;
        if (Math.max(p[a + 1], p[b + 1], p[c + 1]) < near.y - 0.06) continue;
        for (const o of [a, b, c]) {
          if (Math.abs(p[o] - near.x) > 0.06) continue;
          yMin = Math.min(yMin, p[o + 1]);
          xMin = Math.min(xMin, p[o]);
          xMax = Math.max(xMax, p[o]);
        }
      }
    }
    return Number.isFinite(yMin) ? new Vector3((xMin + xMax) / 2, yMin, near.z) : near.clone();
  }

  private mat(name: string, color: string, spec = 0.15, emissive?: string): StandardMaterial {
    const key = `${name}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(`vm-${name}`, this.scene);
      m.diffuseColor = Color3.FromHexString(color);
      m.specularColor = new Color3(spec, spec, spec);
      m.specularPower = 48;
      // A little self-illumination keeps the viewmodel readable when facing away from the sun.
      m.emissiveColor = emissive ? Color3.FromHexString(emissive) : Color3.FromHexString(color).scale(0.22);
      this.mats.set(key, m);
    }
    return m;
  }

  private part(
    parent: TransformNode,
    kind: 'box' | 'cyl',
    size: [number, number, number],
    pos: [number, number, number],
    mat: StandardMaterial,
    rot: [number, number, number] = [0, 0, 0],
  ): Mesh {
    const m =
      kind === 'box'
        ? CreateBox('vm-part', { width: size[0], height: size[1], depth: size[2] }, this.scene)
        : CreateCylinder('vm-part', { diameter: size[0], height: size[2], tessellation: 14 }, this.scene);
    if (kind === 'cyl') m.rotation.x = Math.PI / 2;
    m.parent = parent;
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.x += rot[0];
    m.rotation.y += rot[1];
    m.rotation.z += rot[2];
    m.material = mat;
    m.renderingGroupId = VM_GROUP;
    m.isPickable = false;
    return m;
  }

  /** A box stretched between two points (forearms). */
  private limb(parent: TransformNode, from: [number, number, number], to: [number, number, number], thick: number, mat: StandardMaterial) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    const m = this.part(parent, 'box', [thick, thick * 0.95, len], [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2], mat);
    m.rotation.y = Math.atan2(dx, dz);
    m.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
    return m;
  }

  private hands(root: TransformNode, front: [number, number, number] | null, grip: [number, number, number]) {
    this.lastHands = { grip, front };
    if (this.arms || this.animArms) return; // the rigged arms hold the gun instead of the block hands
    const glove = this.mat('glove', '#2b3038', 0.05);
    const sleeve = this.mat('sleeve', '#46566b', 0.05);
    const cuff = this.mat('cuff', '#ff4655', 0.1, '#5a1018');
    // trigger hand wraps the grip, forearm runs off-screen bottom-right
    this.part(root, 'box', [0.055, 0.075, 0.075], grip, glove);
    const wrist: [number, number, number] = [grip[0] + 0.03, grip[1] - 0.05, grip[2] - 0.08];
    this.limb(root, wrist, [grip[0] + 0.2, grip[1] - 0.24, grip[2] - 0.42], 0.072, sleeve);
    this.part(root, 'box', [0.08, 0.08, 0.025], wrist, cuff).rotation.x = 0.5;
    if (front) {
      // support hand under the handguard, forearm runs off-screen bottom-centre
      this.part(root, 'box', [0.07, 0.05, 0.11], front, glove);
      this.limb(root, [front[0] - 0.02, front[1] - 0.03, front[2] - 0.05], [front[0] - 0.2, front[1] - 0.3, front[2] - 0.38], 0.07, sleeve);
    }
  }

  private build(id: WeaponId): Omit<GunModel, 'gripLocal' | 'supportLocal'> {
    const root = new TransformNode(`vm-${id}`, this.scene);
    root.parent = this.holder;
    const muzzle = new TransformNode(`vm-${id}-muzzle`, this.scene);
    muzzle.parent = root;
    let mag: TransformNode | null = null;
    const dark = this.mat('dark', '#2e333b', 0.25);
    const metal = this.mat('metal', '#596069', 0.4);

    if (id === 'vandal') {
      const wood = this.mat('vandal-wood', '#b4652c', 0.08);
      const accent = this.mat('vandal-accent', '#c98a45', 0.2);
      this.part(root, 'box', [0.06, 0.08, 0.34], [0, 0, 0], dark); // receiver
      this.part(root, 'box', [0.065, 0.06, 0.2], [0, -0.005, 0.25], wood); // handguard
      this.part(root, 'cyl', [0.022, 0, 0.26], [0, 0.012, 0.47], metal); // barrel
      this.part(root, 'box', [0.045, 0.04, 0.06], [0, 0.012, 0.6], dark); // muzzle brake
      this.part(root, 'box', [0.045, 0.085, 0.14], [0, -0.022, -0.22], wood, [0.12, 0, 0]); // stock
      this.part(root, 'box', [0.012, 0.03, 0.012], [0, 0.065, 0.32], dark); // front sight
      this.part(root, 'box', [0.03, 0.02, 0.03], [0, 0.05, -0.05], dark); // rear sight
      this.part(root, 'box', [0.062, 0.012, 0.3], [0, 0.044, 0.02], accent); // top rail accent
      const m = new TransformNode('vm-mag', this.scene);
      m.parent = root;
      m.position.set(0, -0.09, 0.08);
      this.part(m, 'box', [0.04, 0.13, 0.06], [0, 0, 0], accent, [0.35, 0, 0]);
      mag = m;
      this.part(root, 'box', [0.04, 0.09, 0.05], [0, -0.075, -0.07], dark, [-0.3, 0, 0]); // grip
      this.hands(root, [0, -0.05, 0.25], [0.005, -0.075, -0.075]);
      muzzle.position.set(0, 0.012, 0.66);
      return { root, mag, magBase: mag?.position.y ?? 0, muzzle, hip: [0.17, -0.19, 0.6], adsPos: [0, -0.098, 0.38], flashScale: 1 };
    }
    if (id === 'phantom') {
      const body = this.mat('phantom-body', '#2f3540', 0.3);
      const accent = this.mat('phantom-accent', '#7fb3d5', 0.3, '#13212b');
      this.part(root, 'box', [0.062, 0.075, 0.38], [0, 0, 0.02], body);
      this.part(root, 'box', [0.064, 0.012, 0.36], [0, 0.043, 0.03], accent);
      this.part(root, 'cyl', [0.045, 0, 0.32], [0, 0.005, 0.38], dark); // suppressor
      this.part(root, 'box', [0.046, 0.075, 0.15], [0, -0.02, -0.22], body, [0.08, 0, 0]);
      this.part(root, 'box', [0.04, 0.04, 0.07], [0, 0.07, -0.02], dark); // optic
      this.part(root, 'box', [0.03, 0.025, 0.004], [0, 0.072, 0.015], accent);
      const m = new TransformNode('vm-mag', this.scene);
      m.parent = root;
      m.position.set(0, -0.09, 0.07);
      this.part(m, 'box', [0.038, 0.13, 0.055], [0, 0, 0], dark, [0.12, 0, 0]);
      mag = m;
      this.part(root, 'box', [0.04, 0.09, 0.05], [0, -0.075, -0.08], dark, [-0.3, 0, 0]);
      this.hands(root, [0, -0.05, 0.2], [0.005, -0.075, -0.085]);
      muzzle.position.set(0, 0.005, 0.56);
      return { root, mag, magBase: mag?.position.y ?? 0, muzzle, hip: [0.17, -0.19, 0.6], adsPos: [0, -0.112, 0.38], flashScale: 0.45 };
    }
    if (id === 'sheriff') {
      const wood = this.mat('sheriff-grip', '#6b3f22', 0.1);
      const steel = this.mat('sheriff-steel', '#8c8f94', 0.6);
      this.part(root, 'cyl', [0.03, 0, 0.2], [0, 0.02, 0.12], steel);
      this.part(root, 'cyl', [0.06, 0, 0.06], [0, 0.005, 0.0], steel);
      this.part(root, 'box', [0.035, 0.05, 0.1], [0, 0.0, -0.05], steel);
      this.part(root, 'box', [0.035, 0.1, 0.045], [0, -0.07, -0.08], wood, [-0.35, 0, 0]);
      this.part(root, 'box', [0.008, 0.02, 0.008], [0, 0.045, 0.2], dark);
      this.hands(root, null, [0.004, -0.07, -0.085]);
      muzzle.position.set(0, 0.02, 0.23);
      return { root, mag: null, magBase: 0, muzzle, hip: [0.15, -0.165, 0.48], adsPos: [0, -0.068, 0.34], flashScale: 0.9 };
    }
    // classic
    const slide = this.mat('classic-slide', '#3a3f47', 0.35);
    const frame = this.mat('classic-frame', '#9aa4ad', 0.2);
    this.part(root, 'box', [0.034, 0.04, 0.17], [0, 0.015, 0.04], slide);
    this.part(root, 'box', [0.032, 0.03, 0.14], [0, -0.012, 0.04], frame);
    this.part(root, 'box', [0.032, 0.1, 0.045], [0, -0.065, -0.03], frame, [-0.3, 0, 0]);
    this.part(root, 'box', [0.008, 0.015, 0.008], [0, 0.04, 0.115], dark);
    const m = new TransformNode('vm-mag', this.scene);
    m.parent = root;
    m.position.set(0, -0.11, -0.04);
    this.part(m, 'box', [0.026, 0.02, 0.035], [0, 0, 0], dark);
    mag = m;
    this.hands(root, null, [0.004, -0.065, -0.035]);
    muzzle.position.set(0, 0.015, 0.13);
    return { root, mag, magBase: mag?.position.y ?? 0, muzzle, hip: [0.15, -0.165, 0.48], adsPos: [0, -0.068, 0.36], flashScale: 0.6 };
  }

  /** First-person gun built from a weapon skin (GLB), placed so its grip sits in the trigger hand. */
  private buildSkinned(id: WeaponId, skin: WeaponSkin): Omit<GunModel, 'gripLocal' | 'supportLocal'> {
    const pistol = id === 'sheriff' || id === 'classic';
    const root = new TransformNode(`vm-${id}`, this.scene);
    root.parent = this.holder;
    const grip = pistol ? new Vector3(0.004, -0.07, -0.085) : new Vector3(0.005, -0.075, -0.08);
    const placed = skin.place(root, pistol ? 0.34 : 0.92, grip);
    for (const m of placed.meshes) {
      m.renderingGroupId = VM_GROUP;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true; // skinned / near-camera bounds are unreliable for culling
    }
    const muzzle = new TransformNode(`vm-${id}-muzzle`, this.scene);
    muzzle.parent = root;
    muzzle.position.copyFrom(placed.muzzle);

    // Magazine: re-parent under a pivot in gun space so the reload drop moves it straight down.
    let mag: TransformNode | null = null;
    if (placed.mag) {
      mag = new TransformNode(`vm-${id}-mag`, this.scene);
      mag.parent = root;
      root.computeWorldMatrix(true);
      for (const n of [mag, placed.holder, ...placed.holder.getDescendants(false)]) (n as TransformNode).computeWorldMatrix?.(true);
      placed.mag.setParent(mag);
    }
    let cylinder: GunModel['cylinder'];
    if (placed.cylinder) {
      const node = placed.cylinder;
      node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
      cylinder = { node, rest: node.rotationQuaternion.clone(), angle: 0, target: 0, step: (Math.PI * 2) / (skin.spec.chambers ?? 6) };
    }

    const front = placed.handguard ? placed.handguard.add(new Vector3(0, -0.03, 0)) : null;
    this.hands(root, front ? [front.x, front.y, front.z] : null, [grip.x, grip.y, grip.z]);
    // Aim down sights: put the top of the gun just under the screen centre.
    const adsY = -0.035 - placed.sightY;
    return {
      root,
      mag,
      magBase: 0,
      muzzle,
      hip: pistol ? [0.15, -0.165, 0.48] : [0.17, -0.19, 0.6],
      adsPos: [0, adsY, pistol ? 0.34 : 0.4],
      flashScale: id === 'phantom' ? 0.45 : pistol ? 0.9 : 1,
      skin: placed,
      cylinder,
    };
  }

  onShot() {
    this.animArms?.fire();
    this.kick = Math.min(1.4, this.kick + 1);
    this.flashTime = 0.045;
    const cyl = this.currentId ? this.guns.get(this.currentId)?.cylinder : undefined;
    if (cyl) cyl.target += cyl.step;
  }

  update(dt: number, ws: WeaponSystem, speed: number, grounded: boolean, mouseDX: number, mouseDY: number) {
    const id = ws.weapon.id;
    if (id !== this.currentId) {
      for (const [gid, g] of this.guns) g.root.setEnabled(gid === id);
      this.currentId = id;
    }
    const gun = this.guns.get(id);
    if (!gun) return;
    gun.root.setEnabled(this.visible);
    this.arms?.setVisible(this.visible);
    if (!this.visible) {
      this.flash.setEnabled(false);
      return;
    }

    // sway towards mouse movement (clamped), bob from movement
    const targetSX = Math.max(-1, Math.min(1, -mouseDX * 0.004));
    const targetSY = Math.max(-1, Math.min(1, mouseDY * 0.004));
    const k = 1 - Math.exp(-dt * 10);
    this.swayX += (targetSX - this.swayX) * k;
    this.swayY += (targetSY - this.swayY) * k;
    const moving = grounded ? Math.min(1, speed / 5.4) : 0;
    this.bobPhase += dt * (6 + speed * 1.2) * (moving > 0.05 ? 1 : 0);
    const bobX = Math.sin(this.bobPhase) * 0.012 * moving;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.01 * moving;

    this.kick *= Math.exp(-dt * 16);
    const ads = ws.weapon.altFire === 'ads' ? ws.ads : 0;
    const lerp = (a: number, b: number) => a + (b - a) * ads;
    const hipFactor = 1 - ads * 0.85;

    const equip = ws.equipProgress;
    const equipDrop = (1 - equip) * (1 - equip) * 0.3;
    const reload = ws.reloadAnimProgress; // the animation finishes early; see WeaponSystem.reloadAnimProgress
    const reloadDip = ws.reloading ? Math.sin(Math.min(1, reload) * Math.PI) : 0;

    const pistol = id === 'sheriff' || id === 'classic';
    if (ws.reloading && !this.wasReloading) this.reloadEmpty = ws.slot.ammo === 0;
    this.wasReloading = ws.reloading;

    const rigGun = { root: gun.root, gripLocal: gun.gripLocal, supportLocal: gun.supportLocal, pistol, mag: gun.mag };
    if (this.animArms && !pistol) {
      // the animated arms carry the rifle: Draw follows the equip, Reload the reload, Fire each shot
      const clipSecs = this.animArms.reloadClipSeconds(ws.weapon.reloadTime, this.reloadEmpty);
      const elapsed = ws.reloadProgress * ws.weapon.reloadTime;
      this.animArms.update(
        dt,
        rigGun,
        {
          equip,
          reload: ws.reloading ? Math.min(1, elapsed / clipSecs) : -1,
          reloadEmpty: this.reloadEmpty,
          ads,
          adsPos: new Vector3(gun.adsPos[0], gun.adsPos[1], gun.adsPos[2]),
          sightY: -0.035 - gun.adsPos[1],
          offsetPos: new Vector3(
            (this.swayX * 0.012 + bobX * 0.6) * hipFactor,
            (this.swayY * 0.012 - bobY * 0.6) * hipFactor + this.kick * 0.003,
            -this.kick * 0.02,
          ),
          offsetRot: new Vector3(
            -this.kick * 0.025 + (pistol ? reloadDip * 0.3 : 0),
            this.swayX * 0.03 * hipFactor,
            (pistol ? reloadDip * 0.35 : 0) + this.swayX * 0.02 * hipFactor,
          ),
        },
      );
    } else {
      const p = gun.root.position;
      p.x = lerp(gun.hip[0], gun.adsPos[0]) + (this.swayX * 0.02 + bobX) * hipFactor;
      p.y = lerp(gun.hip[1], gun.adsPos[1]) + (this.swayY * 0.02 - bobY) * hipFactor - equipDrop - reloadDip * 0.05 + this.kick * 0.006;
      p.z = lerp(gun.hip[2], gun.adsPos[2]) - this.kick * 0.035;
      const r = gun.root.rotation;
      r.x = -this.kick * 0.06 + equipDrop * 1.6 + reloadDip * 0.35;
      r.y = (this.swayX * 0.05 - 0.05) * hipFactor;
      r.z = reloadDip * 0.5 + this.swayX * 0.04 * hipFactor;

      if (this.animArms) {
        // pistols: the gun is placed here and the animated arms are solved onto it
        (this.holder.parent as TransformNode).computeWorldMatrix(true);
        this.holder.computeWorldMatrix(true);
        gun.root.computeWorldMatrix(true);
        this.animArms.update(dt, rigGun, { equip, reload: -1, reloadEmpty: false, ads, adsPos: Vector3.Zero(), sightY: 0, offsetPos: Vector3.Zero(), offsetRot: Vector3.Zero() });
      } else if (this.arms) {
        // solve the arms onto this frame's gun pose
        (this.holder.parent as TransformNode).computeWorldMatrix(true);
        this.holder.computeWorldMatrix(true);
        const W = gun.root.computeWorldMatrix(true);
        this.arms.pose({
          grip: Vector3.TransformCoordinates(gun.gripLocal, W),
          support: gun.supportLocal ? Vector3.TransformCoordinates(gun.supportLocal, W) : null,
          right: Vector3.TransformNormal(Vector3.Right(), W).normalize(),
          up: Vector3.TransformNormal(Vector3.Up(), W).normalize(),
          forward: Vector3.TransformNormal(Vector3.Forward(), W).normalize(),
          pistol,
        });
      }

      if (gun.mag) {
        // magazine drops out and returns during reload
        const t = ws.reloading ? reload : 1;
        const out = t < 0.3 ? t / 0.3 : t < 0.6 ? 1 : 1 - (t - 0.6) / 0.3;
        gun.mag.position.y = gun.magBase - Math.max(0, Math.min(1, out)) * 0.25;
      }
    }

    if (gun.cylinder) {
      // revolver cylinder turns one chamber per shot (eased)
      const c = gun.cylinder;
      c.angle += (c.target - c.angle) * (1 - Math.exp(-dt * 18));
      Quaternion.RotationAxisToRef(Vector3.Forward(), c.angle, tmpCyl);
      c.rest.multiplyToRef(tmpCyl, c.node.rotationQuaternion!);
    }

    // muzzle flash
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      const m = gun.muzzle.getAbsolutePosition();
      this.flash.setEnabled(true);
      this.flash.position.copyFrom(m);
      const cam = this.holder.parent as FreeCamera;
      this.flash.rotationQuaternion = null;
      this.flash.rotation.copyFrom(cam.rotation);
      this.flash.rotation.z = Math.random() * Math.PI * 2;
      const s = gun.flashScale * (0.8 + Math.random() * 0.5) * (1 - ads * 0.3);
      this.flash.scaling.set(s, s, s);
    } else this.flash.setEnabled(false);
  }

  muzzleWorld(): [number, number, number] {
    const gun = this.currentId ? this.guns.get(this.currentId) : null;
    if (!gun) return [0, 0, 0];
    const m = gun.muzzle.getAbsolutePosition();
    return [m.x, m.y, m.z];
  }

  /**
   * Progress (0 → 1) of the reload as animated, for timing the synthesized reload cues: the animated
   * arms' reload clip when they're holding a rifle, otherwise the gun's own (faster) reload animation.
   */
  reloadCueProgress(ws: WeaponSystem): number {
    const id = ws.weapon.id;
    if (this.animArms && id !== 'sheriff' && id !== 'classic' && ws.reloading) {
      const secs = this.animArms.reloadClipSeconds(ws.weapon.reloadTime, this.reloadEmpty);
      return Math.min(1, (ws.reloadProgress * ws.weapon.reloadTime) / secs);
    }
    return ws.reloadAnimProgress;
  }

  dispose() {
    this.animArms?.dispose();
    this.arms?.dispose();
    for (const g of this.guns.values()) g.skin?.dispose();
    this.holder.dispose(false, true);
    this.flash.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}
