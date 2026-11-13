import type { WeaponId } from '../../types';
import { WEAPONS } from './weaponConfigs';
import { PISTOL_HOLD_UP } from './holds';
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
import { BOLT_CYCLE, smoothstep, type WeaponSystem } from './WeaponSystem';
import type { PlacedSkin, WeaponSkin } from './WeaponSkins';
import { FirstPersonArms, type ArmsTemplate } from './FirstPersonArms';
import type { AnimatedArms } from './AnimatedArms';
import type { PistolArms } from './PistolArms';

interface GunModel {
  root: TransformNode;
  mag: TransformNode | null;
  /** Magazine rest height (its position.y when seated). */
  magBase: number;
  /** Magazine rest position sideways (pistols; read when first needed). */
  magX?: number;
  muzzle: TransformNode;
  hip: [number, number, number];
  adsPos: [number, number, number];
  flashScale: number;
  skin?: PlacedSkin;
  /** Where the hands hold the gun (gun-root space). With arms, the support point is the handguard's underside centre. */
  gripLocal: Vector3;
  supportLocal: Vector3 | null;
  /** Pistols: the bottom of the grip under the grip point (gun-root space), where the left hand goes. */
  gripBottomLocal?: Vector3;
  /** The magazine is a stand-in inside a skin's grip: shown only while it is out of the gun. */
  magHidden?: boolean;
  /**
   * Bolt (bolt action): a pivot on the bolt's axis that carries the bolt mesh, and the tip of its handle
   * at rest (gun-root space).
   */
  bolt?: { pivot: TransformNode; rest: Vector3; handle: Vector3 };
  /** Revolver cylinder: rest rotation, current and target turn (radians). */
  cylinder?: { node: TransformNode; rest: Quaternion; angle: number; target: number; step: number };
}

const VM_GROUP = 1;
/** Animated arms: how far a pistol is moved from its hip position (sideways, up; metres). */
const PISTOL_TWO_HAND_LIFT = [-0.025, 0.06];
const tmpCyl = new Quaternion();
/** Bolt action: how far the handle is turned up (radians) and the bolt drawn back (metres). */
const BOLT_LIFT = 0.7;
const BOLT_TRAVEL = 0.075;
/**
 * Where the hand's grasp goes, measured from the tip of the bolt handle: out, up, forward (metres). It takes
 * the handle from below, so the hand stays beside the receiver instead of rising in front of the view.
 */
const BOLT_GRASP = new Vector3(0, -0.05, -0.02);

/**
 * Working the bolt, `age` seconds after the shot (−1 = not being worked): how far the trigger hand has
 * gone to the handle, how far the handle is lifted and the bolt drawn back, and how far the gun is canted.
 */
function boltPose(age: number, fireRate: number) {
  if (age < 0) return { reach: 0, lift: 0, back: 0, cant: 0 };
  const C = BOLT_CYCLE;
  const t = age * fireRate * C.per; // the timeline is written for one shot every `per` seconds
  const reach = smoothstep(C.reach, C.lift, t) * (1 - smoothstep(C.release, C.done, t));
  const lift = smoothstep(C.lift, C.back, t) * (1 - smoothstep(C.down, C.release, t));
  const back = smoothstep(C.back, C.forward - 0.03, t) * (1 - smoothstep(C.forward, C.down, t));
  const cant = smoothstep(C.reach - 0.04, C.lift, t) * (1 - smoothstep(C.release, C.done, t));
  return { reach, lift, back, cant };
}

/** A pistol reload pose: offsets added to the gun's hip pose, the magazine, and the left hand. */
interface PistolReloadPose {
  /** Gun position offset (view space, metres) and rotation offset (pitch, yaw, roll; radians). */
  pos: Vector3;
  rot: Vector3;
  /** Magazine relative to its seat (gun space): sideways, down, and its spin about the barrel axis. */
  mag: { x: number; drop: number; spin: number };
  /** Left hand, as offsets from its hold under the grip: along the view's axes and along the gun's. */
  hand: { view: Vector3; gun: Vector3 };
}

/** 0 → 1 → 0 over `from`…`to`. */
function bump(t: number, from: number, to: number) {
  return Math.sin(Math.max(0, Math.min(1, (t - from) / (to - from))) * Math.PI);
}

/**
 * Moments of the magazine-pistol reload (share of the reload): the magazine is thrown clear, the new
 * one is seated, and the slide is released (only after an empty magazine).
 */
const PISTOL_RELOAD = { out: 0.14, in: 0.56, slide: 0.7 };
/** The same for the revolver: the cylinder opens, and the rounds go in. */
const REVOLVER_RELOAD = { out: 0.14, in: 0.62 };

/**
 * The magazine-pistol reload at progress `t` (0 → 1), in the close, fast style of a competition
 * shooter:
 *  - the gun is pulled back and up into the middle of the view, just under the sight line, canted
 *    hard inwards with the muzzle up, while the left hand is already on its way to a new magazine;
 *  - a flick of the wrist throws the old magazine clear to the side;
 *  - the left hand comes up along the line of the grip and drives the new magazine home (the gun jolts);
 *  - after an empty magazine the slide is released (a short snap);
 *  - the left hand re-grips as the gun is punched straight back out, a little past its rest and back.
 */
function magazineReload(t: number, empty: boolean): PistolReloadPose {
  const R = PISTOL_RELOAD;
  const work = smoothstep(0, R.out, t) * (1 - smoothstep(0.72, 0.92, t));
  const flick = bump(t, R.out - 0.04, R.out + 0.07);
  const seat = bump(t, R.in - 0.03, R.in + 0.08);
  const slide = empty ? bump(t, R.slide - 0.02, R.slide + 0.06) : 0;
  const punch = bump(t, 0.78, 1);
  const pos = new Vector3(-0.06 * work - 0.015 * flick, 0.02 * work + 0.02 * seat, -0.09 * work - 0.012 * slide + 0.025 * punch);
  const rot = new Vector3(-0.3 * work - 0.07 * seat - 0.05 * slide + 0.03 * punch, -0.15 * work - 0.1 * flick, -0.8 * work - 0.3 * flick);

  // old magazine: thrown out along the canted grip and to the side, spinning; then the new one comes
  // up from out of view into the grip
  const out = Math.max(0, Math.min(1, (t - R.out) / 0.16));
  const back = smoothstep(0.36, R.in, t);
  const mag = t < 0.33 ? { x: -0.14 * out, drop: 0.1 * out + 0.5 * out * out, spin: 2.6 * out } : { x: 0, drop: (1 - back) * 0.45, spin: 0 };

  // left hand: off the gun straight away, down and back out of view; then, still out of view, under
  // the new magazine, which it carries up into the grip; then back to its hold
  const away = smoothstep(0, 0.1, t) * (1 - smoothstep(0.62, 0.8, t));
  const carry = smoothstep(0.3, 0.36, t);
  const hand = {
    view: new Vector3(-0.2, -0.4, -0.3).scaleInPlace((1 - carry) * away),
    gun: new Vector3(0, -(t < 0.33 ? 0.45 : mag.drop), 0).scaleInPlace(carry * away),
  };
  return { pos, rot, mag, hand };
}

/**
 * The revolver reload at progress `t` (0 → 1): the gun tips up and rolls inwards, the left hand drops
 * out of view for the rounds, comes up to the cylinder, then both return.
 */
function revolverReload(t: number): PistolReloadPose {
  const R = REVOLVER_RELOAD;
  const tilt = smoothstep(0, R.out, t) * (1 - smoothstep(0.74, 0.92, t));
  const seat = bump(t, R.in - 0.03, R.in + 0.09);
  const back = smoothstep(0.4, R.in, t);
  const away = smoothstep(0.02, 0.16, t) * (1 - smoothstep(0.7, 0.88, t));
  return {
    pos: new Vector3(-0.05 * tilt, 0.05 * tilt + 0.012 * seat, 0),
    rot: new Vector3(-0.2 * tilt - 0.05 * seat, 0, -0.5 * tilt),
    mag: { x: 0, drop: 0, spin: 0 },
    hand: {
      view: new Vector3(-0.2, -0.4, -0.3).scaleInPlace((1 - back) * away),
      gun: new Vector3(-0.01, 0.06, 0.07).scaleInPlace(back * away),
    },
  };
}

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
  /** Animated pistol arms pack: holds the sidearms in place of `animArms` when loaded. */
  private pistolArms: PistolArms | null = null;
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
    if (this.animArms && armsTemplate?.pistolRig) {
      try {
        this.pistolArms = armsTemplate.pistolRig.createArms(this.holder, VM_GROUP);
        this.pistolArms.setVisible(false);
      } catch (err) {
        console.warn('[viewmodel] pistol arms unavailable', err);
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
    for (const id of weaponIds) this.addWeapon(id, skins.get(id));

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

  /** Build the first-person model for a weapon (no-op if it already exists). New guns start hidden. */
  addWeapon(id: WeaponId, skin?: WeaponSkin) {
    if (this.guns.has(id)) return;
    const gun = (skin ? this.buildSkinned(id, skin) : this.build(id)) as GunModel;
    gun.gripLocal = new Vector3(...this.lastHands.grip);
    gun.supportLocal = this.lastHands.front ? new Vector3(...this.lastHands.front) : null;
    if ((this.arms || this.animArms) && gun.supportLocal) gun.supportLocal = this.handguardUnderside(gun.root, gun.supportLocal);
    if (this.animArms && WEAPONS[id].slot === 'secondary') gun.gripBottomLocal = this.handguardUnderside(gun.root, gun.gripLocal);
    if (this.currentId !== null) gun.root.setEnabled(false);
    this.guns.set(id, gun);
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
      if (!m.isEnabled()) continue; // a stand-in magazine hidden inside the grip
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
    if (id === 'spectre') {
      const body = this.mat('spectre-body', '#343844', 0.3);
      const accent = this.mat('spectre-accent', '#8e7cc3', 0.3, '#1c1830');
      this.part(root, 'box', [0.058, 0.085, 0.26], [0, 0, 0.02], body); // receiver
      this.part(root, 'box', [0.06, 0.012, 0.24], [0, 0.048, 0.02], accent); // top rail
      this.part(root, 'box', [0.05, 0.05, 0.1], [0, -0.012, 0.19], body); // handguard
      this.part(root, 'cyl', [0.042, 0, 0.2], [0, 0.008, 0.33], dark); // suppressor
      this.part(root, 'box', [0.03, 0.03, 0.2], [0, 0.012, -0.2], metal); // stock tube
      this.part(root, 'box', [0.04, 0.08, 0.03], [0, -0.005, -0.31], dark); // butt plate
      this.part(root, 'box', [0.03, 0.03, 0.04], [0, 0.07, 0.0], dark); // rear sight
      const m = new TransformNode('vm-mag', this.scene);
      m.parent = root;
      m.position.set(0, -0.105, 0.06);
      this.part(m, 'box', [0.03, 0.15, 0.04], [0, 0, 0], accent, [0.06, 0, 0]);
      mag = m;
      this.part(root, 'box', [0.04, 0.09, 0.05], [0, -0.075, -0.06], dark, [-0.3, 0, 0]); // grip
      this.hands(root, [0, -0.05, 0.19], [0.005, -0.075, -0.065]);
      muzzle.position.set(0, 0.008, 0.44);
      return { root, mag, magBase: mag.position.y, muzzle, hip: [0.17, -0.19, 0.56], adsPos: [0, -0.108, 0.38], flashScale: 0.4 };
    }
    if (id === 'guardian') {
      const body = this.mat('guardian-body', '#3a4034', 0.25);
      const accent = this.mat('guardian-accent', '#9fb86a', 0.25);
      this.part(root, 'box', [0.06, 0.08, 0.36], [0, 0, 0], body); // receiver
      this.part(root, 'box', [0.064, 0.055, 0.26], [0, -0.004, 0.3], accent); // long handguard
      this.part(root, 'cyl', [0.022, 0, 0.3], [0, 0.012, 0.56], metal); // barrel
      this.part(root, 'box', [0.04, 0.035, 0.07], [0, 0.012, 0.72], dark); // muzzle brake
      this.part(root, 'box', [0.045, 0.09, 0.2], [0, -0.02, -0.26], body, [0.1, 0, 0]); // stock
      this.part(root, 'box', [0.062, 0.012, 0.34], [0, 0.045, 0.04], dark); // rail
      this.part(root, 'box', [0.012, 0.03, 0.012], [0, 0.065, 0.4], dark); // front sight
      this.part(root, 'box', [0.03, 0.022, 0.03], [0, 0.056, -0.06], dark); // rear sight
      const m = new TransformNode('vm-mag', this.scene);
      m.parent = root;
      m.position.set(0, -0.075, 0.07);
      this.part(m, 'box', [0.04, 0.085, 0.06], [0, 0, 0], dark);
      mag = m;
      this.part(root, 'box', [0.04, 0.09, 0.05], [0, -0.075, -0.07], dark, [-0.3, 0, 0]); // grip
      this.hands(root, [0, -0.05, 0.3], [0.005, -0.075, -0.075]);
      muzzle.position.set(0, 0.012, 0.77);
      return { root, mag, magBase: mag.position.y, muzzle, hip: [0.17, -0.19, 0.6], adsPos: [0, -0.104, 0.38], flashScale: 1 };
    }
    if (id === 'operator') {
      const body = this.mat('operator-body', '#2c3b3a', 0.25);
      const accent = this.mat('operator-accent', '#5f8f8a', 0.3);
      const glass = this.mat('operator-glass', '#0d1a22', 0.9, '#0a2a3a');
      this.part(root, 'box', [0.065, 0.085, 0.42], [0, 0, 0], body); // receiver
      this.part(root, 'box', [0.068, 0.06, 0.24], [0, -0.008, 0.32], accent); // handguard
      this.part(root, 'cyl', [0.03, 0, 0.52], [0, 0.014, 0.7], metal); // heavy barrel
      this.part(root, 'box', [0.06, 0.05, 0.1], [0, 0.014, 1.0], dark); // muzzle brake
      this.part(root, 'box', [0.048, 0.095, 0.18], [0, -0.03, -0.27], body, [0.08, 0, 0]); // stock
      this.part(root, 'cyl', [0.036, 0, 0.26], [0, 0.08, 0.14], dark); // scope tube (kept slim and forward so it doesn't fill the view)
      this.part(root, 'cyl', [0.05, 0, 0.07], [0, 0.08, 0.29], dark); // objective bell
      this.part(root, 'cyl', [0.042, 0, 0.004], [0, 0.08, 0.327], glass); // front lens
      this.part(root, 'cyl', [0.042, 0, 0.04], [0, 0.08, 0.0], dark); // eyepiece
      this.part(root, 'box', [0.02, 0.03, 0.03], [0, 0.052, 0.07], dark); // scope mounts
      this.part(root, 'box', [0.02, 0.03, 0.03], [0, 0.052, 0.21], dark);
      this.part(root, 'cyl', [0.014, 0, 0.07], [0.05, 0.01, -0.1], metal, [0, 0, 0]).rotation.set(Math.PI / 2, 0, Math.PI / 2 - 0.5); // bolt handle
      const m = new TransformNode('vm-mag', this.scene);
      m.parent = root;
      m.position.set(0, -0.075, 0.06);
      this.part(m, 'box', [0.045, 0.07, 0.09], [0, 0, 0], dark);
      mag = m;
      this.part(root, 'box', [0.042, 0.09, 0.05], [0, -0.08, -0.09], dark, [-0.3, 0, 0]); // grip
      this.hands(root, [0, -0.055, 0.3], [0.005, -0.08, -0.095]);
      muzzle.position.set(0, 0.014, 1.06);
      return { root, mag, magBase: mag.position.y, muzzle, hip: [0.18, -0.2, 0.58], adsPos: [0, -0.15, 0.3], flashScale: 1.5 };
    }
    if (id === 'ghost') {
      const slide = this.mat('ghost-slide', '#2a2e36', 0.4);
      const frame = this.mat('ghost-frame', '#6f7f95', 0.2);
      this.part(root, 'box', [0.034, 0.04, 0.18], [0, 0.015, 0.04], slide);
      this.part(root, 'box', [0.032, 0.03, 0.15], [0, -0.012, 0.04], frame);
      this.part(root, 'cyl', [0.036, 0, 0.14], [0, 0.015, 0.2], dark); // suppressor
      this.part(root, 'box', [0.032, 0.1, 0.045], [0, -0.065, -0.03], frame, [-0.3, 0, 0]);
      this.part(root, 'box', [0.008, 0.015, 0.008], [0, 0.04, 0.12], dark);
      const m = new TransformNode('vm-mag', this.scene);
      m.parent = root;
      m.position.set(0, -0.11, -0.04);
      this.part(m, 'box', [0.026, 0.02, 0.035], [0, 0, 0], dark);
      mag = m;
      this.hands(root, null, [0.004, -0.065, -0.035]);
      muzzle.position.set(0, 0.015, 0.275);
      return { root, mag, magBase: mag.position.y, muzzle, hip: [0.15, -0.165, 0.48], adsPos: [0, -0.068, 0.36], flashScale: 0.35 };
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
    const pistol = WEAPONS[id].slot === 'secondary';
    const root = new TransformNode(`vm-${id}`, this.scene);
    root.parent = this.holder;
    const grip = pistol ? new Vector3(0.004, -0.07, -0.085) : new Vector3(0.005, -0.075, -0.08);
    const placed = skin.place(root, skin.spec.viewLength ?? (pistol ? 0.34 : 0.92), grip);
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
    // Pistol skins are one joined mesh: a plain magazine hidden in the grip stands in for the reload.
    let magHidden = false;
    if (pistol && !mag && id !== 'sheriff') {
      mag = new TransformNode(`vm-${id}-mag`, this.scene);
      mag.parent = root;
      mag.position.set(grip.x, grip.y - 0.015, grip.z);
      this.part(mag, 'box', [0.022, 0.1, 0.032], [0, 0, 0], this.mat('dark', '#2e333b', 0.25), [-0.25, 0, 0]);
      mag.setEnabled(false);
      magHidden = true;
    }
    // Bolt: carried by a pivot on its axis, so it can turn about the axis and slide along it.
    let bolt: GunModel['bolt'];
    if (placed.bolt && placed.boltAxis) {
      const pivot = new TransformNode(`vm-${id}-bolt`, this.scene);
      pivot.parent = root;
      pivot.position.copyFrom(placed.boltAxis);
      for (const n of [root, pivot, placed.holder, ...placed.holder.getDescendants(false)]) (n as TransformNode).computeWorldMatrix?.(true);
      // the handle's tip: the bolt's vertex furthest from the axis
      const inv = root.getWorldMatrix().clone().invert();
      const handle = placed.boltAxis.clone();
      let far = 0;
      const v = new Vector3();
      for (const m of [placed.bolt, ...placed.bolt.getChildMeshes(false)]) {
        const pos = (m as Mesh).getVerticesData?.('position');
        if (!pos) continue;
        const toRoot = m.getWorldMatrix().multiply(inv);
        for (let i = 0; i < pos.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], toRoot, v);
          const d = Math.hypot(v.x - placed.boltAxis.x, v.y - placed.boltAxis.y);
          if (d > far) {
            far = d;
            handle.copyFrom(v);
          }
        }
      }
      placed.bolt.setParent(pivot);
      bolt = { pivot, rest: pivot.position.clone(), handle };
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
      magBase: mag?.position.y ?? 0,
      magHidden,
      muzzle,
      hip: pistol ? [0.15, -0.165, 0.48] : [0.17, -0.19, 0.6],
      adsPos: [0, adsY, pistol ? 0.34 : 0.4],
      flashScale: WEAPONS[id].suppressed ? 0.45 : pistol ? 0.9 : 1,
      skin: placed,
      cylinder,
      bolt,
    };
  }

  onShot() {
    if (this.currentId && WEAPONS[this.currentId].slot === 'secondary' && this.pistolArms) this.pistolArms.fire();
    else this.animArms?.fire();
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
    // sidearms have their own animated arms (a two-handed pistol hold); the rifle arms step aside for them
    const pistolRig = WEAPONS[id].slot === 'secondary' ? this.pistolArms : null;
    this.animArms?.setVisible(this.visible && !pistolRig);
    this.pistolArms?.setVisible(this.visible && !!pistolRig);
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
    const reload = ws.reloadAnimProgress; // lasts the whole reload; see WeaponSystem.reloadAnimProgress
    const reloadDip = ws.reloading ? Math.sin(Math.min(1, reload) * Math.PI) : 0;

    const pistol = WEAPONS[id].slot === 'secondary';
    // pistols have their own reload (the rifle dip would leave both hands on the gun)
    const pr = !pistol || !ws.reloading ? null : id === 'sheriff' ? revolverReload(reload) : magazineReload(reload, ws.slot.ammo === 0);
    const dip = pr ? 0 : reloadDip;
    if (ws.reloading && !this.wasReloading) this.reloadEmpty = ws.slot.ammo === 0;
    this.wasReloading = ws.reloading;

    // bolt action: after a shot the trigger hand works the bolt, the gun canted over to show it
    const bp = boltPose(ws.boltCycleAge, ws.weapon.fireRate);
    let rightReach: { to: Vector3; blend: number } | null = null;
    if (gun.bolt) {
      const b = gun.bolt;
      const side = b.handle.x >= b.rest.x ? 1 : -1;
      const ang = bp.lift * BOLT_LIFT * side;
      b.pivot.rotation.z = ang;
      b.pivot.position.z = b.rest.z - bp.back * BOLT_TRAVEL;
      if (bp.reach > 0) {
        // the handle's tip where the bolt is now, and the hand's grasp around it
        const dx = b.handle.x - b.rest.x + BOLT_GRASP.x * side;
        const dy = b.handle.y - b.rest.y + BOLT_GRASP.y;
        const to = new Vector3(
          b.rest.x + dx * Math.cos(ang) - dy * Math.sin(ang),
          b.rest.y + dx * Math.sin(ang) + dy * Math.cos(ang),
          b.handle.z + BOLT_GRASP.z - bp.back * BOLT_TRAVEL,
        );
        rightReach = { to, blend: bp.reach };
      }
    }
    const boltCant = bp.cant * (1 - ads);

    const rigGun = { root: gun.root, gripLocal: gun.gripLocal, supportLocal: gun.supportLocal, pistol, mag: gun.mag, gripBottom: gun.gripBottomLocal ?? null };
    if (pistolRig) {
      // the animated pistol arms carry the sidearm: Draw follows the equip, Reload the reload, Shoot each shot
      pistolRig.update(
        dt,
        { root: gun.root, gripLocal: gun.gripLocal, boreY: gun.muzzle.position.y, mag: gun.mag, magHidden: !!gun.magHidden },
        {
          equip,
          reload: ws.reloading ? reload : -1,
          ads,
          adsZ: gun.adsPos[2],
          sightY: -0.035 - gun.adsPos[1],
          offsetPos: new Vector3(
            (this.swayX * 0.012 + bobX * 0.6) * hipFactor,
            (this.swayY * 0.012 - bobY * 0.6) * hipFactor + this.kick * 0.002,
            -this.kick * 0.012,
          ),
          offsetRot: new Vector3(-this.kick * 0.02, this.swayX * 0.03 * hipFactor, this.swayX * 0.02 * hipFactor),
        },
      );
    } else if (this.animArms && !pistol) {
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
            (this.swayX * 0.012 + bobX * 0.6) * hipFactor - boltCant * 0.02,
            (this.swayY * 0.012 - bobY * 0.6) * hipFactor + this.kick * 0.003,
            -this.kick * 0.02,
          ),
          offsetRot: new Vector3(
            -this.kick * 0.025 + (pistol ? reloadDip * 0.3 : 0) - boltCant * 0.05,
            this.swayX * 0.03 * hipFactor,
            (pistol ? reloadDip * 0.35 : 0) + this.swayX * 0.02 * hipFactor + boltCant * 0.2,
          ),
          rightReach,
        },
      );
    } else {
      const p = gun.root.position;
      p.x = lerp(gun.hip[0], gun.adsPos[0]) + (this.swayX * 0.02 + bobX) * hipFactor;
      p.y = lerp(gun.hip[1], gun.adsPos[1]) + (this.swayY * 0.02 - bobY) * hipFactor - equipDrop - dip * 0.05 + this.kick * 0.006;
      p.z = lerp(gun.hip[2], gun.adsPos[2]) - this.kick * 0.035;
      const r = gun.root.rotation;
      r.x = -this.kick * 0.06 + equipDrop * 1.6 + dip * 0.35;
      r.y = (this.swayX * 0.05 - 0.05) * hipFactor;
      r.z = dip * 0.5 + this.swayX * 0.04 * hipFactor + boltCant * 0.2;
      if (pr) {
        p.addInPlace(pr.pos);
        r.addInPlace(pr.rot);
      }
      if (pistol && this.animArms) {
        // both hands are on the gun: hold it higher and nearer the middle so the lower hand is in view
        // on a wide screen too (not when aiming down the sights)
        p.x += PISTOL_TWO_HAND_LIFT[0] * (1 - ads);
        p.y += PISTOL_TWO_HAND_LIFT[1] * (1 - ads);
      }

      if (this.animArms) {
        // pistols: the gun is placed here and the animated arms are solved onto it
        (this.holder.parent as TransformNode).computeWorldMatrix(true);
        this.holder.computeWorldMatrix(true);
        gun.root.computeWorldMatrix(true);
        this.animArms.update(dt, rigGun, {
          equip,
          reload: -1,
          reloadEmpty: false,
          ads,
          adsPos: Vector3.Zero(),
          sightY: 0,
          offsetPos: Vector3.Zero(),
          offsetRot: Vector3.Zero(),
          leftOffset: pr?.hand ?? null,
        });
      } else if (this.arms) {
        // solve the arms onto this frame's gun pose
        (this.holder.parent as TransformNode).computeWorldMatrix(true);
        this.holder.computeWorldMatrix(true);
        const W = gun.root.computeWorldMatrix(true);
        // sidearms: the hands close round the middle of the short grip, not below it (as in AnimatedArms)
        const gripAt = pistol ? gun.gripLocal.add(new Vector3(0, PISTOL_HOLD_UP, 0)) : gun.gripLocal;
        this.arms.pose({
          grip: Vector3.TransformCoordinates(gripAt, W),
          support: gun.supportLocal ? Vector3.TransformCoordinates(gun.supportLocal, W) : null,
          right: Vector3.TransformNormal(Vector3.Right(), W).normalize(),
          up: Vector3.TransformNormal(Vector3.Up(), W).normalize(),
          forward: Vector3.TransformNormal(Vector3.Forward(), W).normalize(),
          pistol,
        });
      }

      if (gun.mag && pistol) {
        const m = pr?.mag;
        gun.magX ??= gun.mag.position.x;
        gun.mag.position.x = gun.magX + (m?.x ?? 0);
        gun.mag.position.y = gun.magBase - (m?.drop ?? 0);
        gun.mag.rotation.z = m?.spin ?? 0;
        if (gun.magHidden) gun.mag.setEnabled((m?.drop ?? 0) > 0.004);
      } else if (gun.mag) {
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
   * When the reload's sounds belong, in seconds from the start of the current weapon's reload: the
   * magazine coming out, the new one going in, and the bolt (rifles) or slide (a pistol run empty). They follow whichever
   * animation is shown: the animated arms' reload clip on a rifle, the pistol reload, or the simple
   * magazine drop.
   */
  reloadCueTimes(ws: WeaponSystem): { out: number; in: number; bolt: number | null } {
    const T = ws.weapon.reloadTime;
    if (ws.weapon.id === 'sheriff') return { out: REVOLVER_RELOAD.out * T, in: REVOLVER_RELOAD.in * T, bolt: null };
    if (ws.weapon.slot === 'secondary' && this.pistolArms) {
      // the clip is an empty reload: the slide is only heard going forward when the magazine ran dry
      const c = this.pistolArms.reloadCueTimes(T);
      return { out: c.out, in: c.in, bolt: ws.slot.ammo === 0 ? c.slide : null };
    }
    if (ws.weapon.slot === 'secondary') {
      return { out: PISTOL_RELOAD.out * T, in: PISTOL_RELOAD.in * T, bolt: ws.slot.ammo === 0 ? PISTOL_RELOAD.slide * T : null };
    }
    if (this.animArms) return this.animArms.reloadCueTimes(T, ws.slot.ammo === 0);
    return { out: 0.08 * T, in: 0.85 * T, bolt: 0.93 * T };
  }

  dispose() {
    this.animArms?.dispose();
    this.pistolArms?.dispose();
    this.arms?.dispose();
    for (const g of this.guns.values()) g.skin?.dispose();
    this.holder.dispose(false, true);
    this.flash.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}
