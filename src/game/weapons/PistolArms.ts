/**
 * Animated first-person arms for the sidearms: "Mark 23 Animated (Free)" by BarcodeGames, prepared by
 * scripts/prepare-fp-arms-pistol.mjs into public/models/fp-arms-pistol.glb — a rigged pair of gloved
 * forearms in a two-handed pistol hold (the right hand round the grip, the left wrapped over it), with
 * clips authored around a Mark 23: Draw, Shoot, Reload (and Hide, unused).
 *
 * The pack's pistol meshes were stripped. The game's own sidearm rides the pack's weapon joint: every
 * frame it is placed so its grip sits where the Mark 23's grip was, pointing the same way, and scaled
 * so the grip is the size the hands were posed around. The magazine follows the pack's magazine joint.
 *
 * Clips are evaluated directly (goToFrame) from game state each frame, like AnimatedArms does for the
 * rifles: Draw follows the equip timer, Reload the reload, Shoot restarts on every shot, and the first
 * Shoot frame is the idle pose.
 */
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Matrix, Quaternion, TransformNode, Vector3, type AbstractMesh, type Scene } from '../rendering/babylon';
import { loadContainer } from '../rendering/gltf';

const PISTOL_ARMS_URL = 'models/fp-arms-pistol.glb';

/** Joints used here (names as in the pack). */
const JOINTS = { main: 'main_j_050', mag: 'Mag_j_052' } as const;
type JointKey = keyof typeof JOINTS;

/**
 * Measured on the pack's Mark 23, in the weapon joint's space (centimetres; +Z = muzzle, +Y = up):
 * the middle of the grip, where the right hand closes, and the height of the bore above it.
 */
const MARK23 = { grip: new Vector3(0.35, 0.5, -3), boreAboveGrip: 8.1, cm: 0.01 };

/**
 * Framing: where the middle of the grip is held at the hip (camera space, metres). The rig is turned
 * about that point so the barrel runs parallel to the view axis and aims at the crosshair.
 */
const HIP_GRIP = new Vector3(0.1, -0.115, 0.32);
/** Limits on how much a gun is scaled to fit the hands. */
const MIN_GUN_SCALE = 0.6;
const MAX_GUN_SCALE = 1.1;

type ClipName = 'draw' | 'shoot' | 'reload';
const CLIP_NAMES: Record<ClipName, string> = { draw: 'Draw', shoot: 'Shoot', reload: 'Reload' };
/** Where each clip sits on the pack's shared timeline (seconds). */
const CLIP_RANGE: Record<ClipName, [number, number]> = {
  reload: [0.0333, 3.7667],
  shoot: [3.7667, 4.1],
  draw: [4.5, 5.3333],
};
/**
 * Moments in the reload clip (seconds from its start): the magazine leaves the gun, the new one is
 * seated, and the slide is released.
 */
const RELOAD_EVENTS = { out: 0.6, in: 2.3, slide: 3.12 };

interface Clip {
  group: AnimationGroup;
  from: number;
  to: number;
  fps: number;
}

/** The loaded pack (one per session). */
export class PistolRigTemplate {
  private constructor(readonly container: AssetContainer) {}

  static async load(scene: Scene): Promise<PistolRigTemplate> {
    const container = await loadContainer(scene, PISTOL_ARMS_URL);
    const names = new Set(container.transformNodes.map((n) => n.name));
    const groups = new Set(container.animationGroups.map((g) => g.name));
    const missing = [...Object.values(JOINTS).filter((n) => !names.has(n)), ...Object.values(CLIP_NAMES).filter((n) => !groups.has(n))];
    if (missing.length) {
      container.dispose();
      throw new Error(`pistol arms pack: missing ${missing.join(', ')}`);
    }
    return new PistolRigTemplate(container);
  }

  /** A set of arms for one view model (the container stays shared). */
  createArms(holder: TransformNode, renderingGroup: number): PistolArms {
    return new PistolArms(this, holder, renderingGroup);
  }

  dispose() {
    this.container.dispose();
  }
}

/** A sidearm as the rig needs it (gun-root space, metres). */
export interface PistolRigGun {
  root: TransformNode;
  gripLocal: Vector3;
  /** Height of the bore (the muzzle) above the gun's root. */
  boreY: number;
  mag: TransformNode | null;
  /** The magazine is a stand-in hidden inside the grip: shown only while it is out of the gun. */
  magHidden: boolean;
}

export interface PistolRigState {
  /** 0 → 1 while equipping, 1 when done. */
  equip: number;
  /** Reload progress 0 → 1, or −1 when not reloading. */
  reload: number;
  /** Aim-down-sights blend 0 → 1, the depth the gun is held at when aiming, and its sight line's height above its root. */
  ads: number;
  adsZ: number;
  sightY: number;
  /** Extra offset in camera space (sway, bob, kick). */
  offsetPos: Vector3;
  offsetRot: Vector3;
}

interface GunCache {
  scale: number;
  /** Anchor that puts the idle gun's sights on the view axis. */
  ads: Matrix | null;
  magRest: Matrix | null;
}

const tA = new Matrix();
const tB = new Matrix();
const tI = new Matrix();
const tS = new Vector3();
const tP = new Vector3();
const tQ = new Quaternion();

export class PistolArms {
  private readonly anchor: TransformNode;
  private readonly inst: InstantiatedEntries;
  private readonly j: Record<JointKey, TransformNode>;
  /** Every node of the rig, parents first (for refreshing world matrices). */
  private readonly nodes: TransformNode[];
  private readonly clips: Record<ClipName, Clip>;
  /** Anchor at the hip (holder space). */
  private readonly hip: Matrix;
  private readonly hipPos = new Vector3();
  private readonly hipRot = new Quaternion();
  private readonly magRest: Matrix;
  private readonly guns = new Map<TransformNode, GunCache>();
  private shootT = -1;

  constructor(template: PistolRigTemplate, holder: TransformNode, renderingGroup: number) {
    const scene = holder.getScene();
    this.anchor = new TransformNode('fpp-anchor', scene);
    this.anchor.parent = holder;
    this.anchor.rotationQuaternion = Quaternion.Identity();

    this.inst = template.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    // the pack is modelled in centimetres
    const unit = new TransformNode('fpp-unit', scene);
    unit.parent = this.anchor;
    unit.scaling.setAll(MARK23.cm);
    for (const r of this.inst.rootNodes) r.parent = unit;
    const all: TransformNode[] = [unit];
    const walk = (n: TransformNode) => {
      all.push(n);
      for (const c of n.getChildren()) if (c instanceof TransformNode) walk(c);
    };
    for (const r of this.inst.rootNodes) walk(r as TransformNode);
    this.nodes = all;
    const meshes: AbstractMesh[] = unit.getChildMeshes(false);
    for (const m of meshes) {
      m.renderingGroupId = renderingGroup;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true; // skinned bounds don't follow the animation
      m.receiveShadows = false;
    }
    const byName = new Map(all.map((n) => [n.name, n]));
    this.j = Object.fromEntries(Object.entries(JOINTS).map(([k, name]) => [k, byName.get(name)!])) as Record<JointKey, TransformNode>;

    this.clips = Object.fromEntries(
      (Object.entries(CLIP_NAMES) as [ClipName, string][]).map(([key, name]) => {
        const group = this.inst.animationGroups.find((g) => g.name === name)!;
        const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
        const from = CLIP_RANGE[key][0] * fps;
        const to = CLIP_RANGE[key][1] * fps;
        group.start(false, 1, from, to);
        group.pause();
        return [key, { group, from, to, fps }];
      }),
    ) as Record<ClipName, Clip>;
    for (const g of this.inst.animationGroups) if (!Object.values(this.clips).some((c) => c.group === g)) g.stop();

    // idle pose: turn the rig about the grip so the barrel points down the view axis, and carry the grip to its place
    this.show('reload', this.clips.reload.to);
    this.show('shoot', this.clips.shoot.from);
    this.refresh();
    holder.computeWorldMatrix(true).invertToRef(tI);
    const J = this.j.main.getWorldMatrix().multiply(tI);
    const grip = Vector3.TransformCoordinates(MARK23.grip, J);
    const fwd = Vector3.TransformNormal(Vector3.Forward(), J).normalize();
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(fwd, Vector3.Forward(), q);
    this.hip = Matrix.Translation(-grip.x, -grip.y, -grip.z)
      .multiply(Matrix.FromQuaternionToRef(q, new Matrix()))
      .multiply(Matrix.Translation(HIP_GRIP.x, HIP_GRIP.y, HIP_GRIP.z));
    this.hip.decompose(tS, this.hipRot, this.hipPos);
    this.magRest = this.j.mag.getWorldMatrix().multiply(this.j.main.getWorldMatrix().clone().invert());
  }

  setVisible(v: boolean) {
    this.anchor.setEnabled(v);
  }

  fire() {
    this.shootT = 0;
  }

  /** When the reload clip's sound cues fall, in seconds from the start of a reload of `reloadTime` seconds. */
  reloadCueTimes(reloadTime: number): { out: number; in: number; slide: number } {
    const c = this.clips.reload;
    const k = reloadTime / ((c.to - c.from) / c.fps);
    return { out: RELOAD_EVENTS.out * k, in: RELOAD_EVENTS.in * k, slide: RELOAD_EVENTS.slide * k };
  }

  dispose() {
    this.inst.dispose();
    this.anchor.dispose();
  }

  /* ---------------- per frame ---------------- */

  update(dt: number, gun: PistolRigGun, s: PistolRigState) {
    const cache = this.cacheFor(gun);
    // 1. pose the arms from the right clip. The clips don't all move the same joints (Reload moves every
    // one, Shoot and Draw a few), so the others are first put back to the hold the reload ends in:
    // a reload cut short by a weapon swap would otherwise leave the left arm wherever it was.
    if (s.equip < 1 || s.reload < 0) this.show('reload', this.clips.reload.to);
    if (s.equip < 1) this.showAt('draw', s.equip);
    else if (s.reload >= 0) this.showAt('reload', s.reload);
    else if (this.shootT >= 0) {
      const c = this.clips.shoot;
      const f = c.from + this.shootT * c.fps;
      if (f >= c.to) {
        this.shootT = -1;
        this.show('shoot', c.from);
      } else this.show('shoot', f);
    } else this.show('shoot', this.clips.shoot.from);
    if (this.shootT >= 0) this.shootT += dt;

    // 2. place the rig: the hip hold, blended towards aiming down the sights, plus sway/bob/kick
    const rot = this.anchor.rotationQuaternion!;
    rot.copyFrom(this.hipRot);
    this.anchor.position.copyFrom(this.hipPos);
    if (s.ads > 0.001) {
      cache.ads ??= this.adsAnchor(gun, cache, s);
      cache.ads.decompose(tS, tQ, tP);
      Quaternion.SlerpToRef(rot.clone(), tQ, s.ads, rot);
      Vector3.LerpToRef(this.anchor.position.clone(), tP, s.ads, this.anchor.position);
    }
    const extra = Quaternion.RotationYawPitchRoll(s.offsetRot.y, s.offsetRot.x, s.offsetRot.z);
    extra.multiplyToRef(rot, rot);
    this.anchor.position.addInPlace(s.offsetPos);
    this.refresh();

    // 3. the gun rides the weapon joint, its magazine the magazine joint
    this.placeGun(gun, cache);
    if (gun.mag && cache.magRest) this.placeMag(gun, cache.magRest);
  }

  private show(name: ClipName, frame: number) {
    const c = this.clips[name];
    c.group.goToFrame(Math.max(c.from, Math.min(c.to, frame)));
  }

  private showAt(name: ClipName, t: number) {
    const c = this.clips[name];
    this.show(name, c.from + (c.to - c.from) * Math.max(0, Math.min(1, t)));
  }

  private refresh() {
    this.anchor.computeWorldMatrix(true);
    for (const n of this.nodes) n.computeWorldMatrix(true);
  }

  private cacheFor(gun: PistolRigGun): GunCache {
    let c = this.guns.get(gun.root);
    if (!c) {
      // scale the gun so its bore sits as far above the grip as the Mark 23's: the grip then fills the hands
      const have = gun.boreY - gun.gripLocal.y;
      const scale = have > 0.01 ? Math.min(MAX_GUN_SCALE, Math.max(MIN_GUN_SCALE, (MARK23.boreAboveGrip * MARK23.cm) / have)) : 1;
      gun.root.computeWorldMatrix(true);
      c = {
        scale,
        ads: null,
        magRest: gun.mag ? gun.mag.computeWorldMatrix(true).multiply(gun.root.getWorldMatrix().clone().invert()) : null,
      };
      this.guns.set(gun.root, c);
    }
    return c;
  }

  /**
   * World matrix of the gun root (unscaled) that puts its grip on the Mark 23's grip, aligned with the
   * weapon joint. Built from the joint's directions, so a mirrored parent can't flip the gun.
   */
  private gunWorld(gun: PistolRigGun, c: GunCache): Matrix {
    const W = this.j.main.getWorldMatrix();
    const fwd = Vector3.TransformNormal(Vector3.Forward(), W).normalize();
    let up = Vector3.TransformNormal(Vector3.Up(), W).normalize();
    up = up.subtract(fwd.scale(Vector3.Dot(up, fwd))).normalize();
    const right = Vector3.Cross(up, fwd).normalize();
    const grip = Vector3.TransformCoordinates(MARK23.grip, W);
    const g = gun.gripLocal;
    const k = c.scale;
    const pos = grip.subtract(right.scale(g.x * k)).subtract(up.scale(g.y * k)).subtract(fwd.scale(g.z * k));
    return Matrix.FromValues(right.x, right.y, right.z, 0, up.x, up.y, up.z, 0, fwd.x, fwd.y, fwd.z, 0, pos.x, pos.y, pos.z, 1);
  }

  /** The anchor that holds the idle gun with its sights just under the screen centre, `adsZ` away. */
  private adsAnchor(gun: PistolRigGun, c: GunCache, s: PistolRigState): Matrix {
    this.show('reload', this.clips.reload.to);
    this.show('shoot', this.clips.shoot.from);
    this.anchor.rotationQuaternion!.copyFrom(this.hipRot);
    this.anchor.position.copyFrom(this.hipPos);
    this.refresh();
    const holder = this.anchor.parent as TransformNode;
    const idle = this.gunWorld(gun, c).multiply(holder.getWorldMatrix().clone().invert());
    const want = Matrix.Translation(0, -0.035 - s.sightY * c.scale, s.adsZ);
    return this.hip.multiply(idle.invert()).multiply(want);
  }

  private placeGun(gun: PistolRigGun, c: GunCache) {
    const W = this.gunWorld(gun, c);
    (gun.root.parent as TransformNode).getWorldMatrix().invertToRef(tI);
    W.multiplyToRef(tI, tA);
    tA.decompose(tS, tQ, tP);
    gun.root.rotationQuaternion ??= Quaternion.Identity();
    gun.root.rotationQuaternion.copyFrom(tQ);
    gun.root.position.copyFrom(tP);
    gun.root.scaling.setAll(c.scale);
    gun.root.computeWorldMatrix(true);
  }

  private placeMag(gun: PistolRigGun, magRest: Matrix) {
    const main = this.j.main.getWorldMatrix();
    const cur = this.j.mag.getWorldMatrix().multiply(main.clone().invert());
    // delta in weapon-joint space, carried over to gun space: Dg = inv(C) · Dm · C, with C = main → gun root
    const Dm = this.magRest.clone().invert().multiply(cur);
    const C = main.multiply(gun.root.getWorldMatrix().clone().invert());
    const Dg = C.clone().invert().multiply(Dm).multiply(C);
    magRest.multiplyToRef(Dg, tB);
    const mag = gun.mag!;
    tB.decompose(tS, tQ, tP);
    mag.rotationQuaternion ??= Quaternion.Identity();
    mag.rotationQuaternion.copyFrom(tQ);
    mag.position.copyFrom(tP);
    // out of the gun by more than half a centimetre (joint space is in centimetres)
    if (gun.magHidden) mag.setEnabled(Dm.getTranslation().length() > 0.5);
  }
}
