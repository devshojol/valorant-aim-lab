/**
 * Animated first-person arms: "M4 - FPS Weapon Animations Pack (v.1)" by BarcodeGames (CC BY 4.0),
 * prepared by scripts/prepare-fp-arms.mjs into public/models/fp-arms-anim.glb — a rigged pair of
 * gloved forearms with clips authored around an M4: Draw, Fire, Reload, Reload_Empty (and Holster,
 * unused).
 *
 * The pack's rifle meshes were stripped. The game's own gun rides the pack's weapon joint instead:
 * every frame the gun is placed so its grip sits where the M4's grip was, pointing the same way
 * (pitched a few degrees so its handguard meets the left hand). Magazines follow the pack's
 * magazine joints, so the left hand really pulls the old one and seats the new one.
 *
 * Clips are evaluated directly (goToFrame) from game state each frame: Draw follows the equip timer,
 * Reload follows the reload, Fire restarts on every shot, and the first Fire frame is the idle pose.
 * There are no pistol clips: with a pistol the right arm keeps the rifle grip pose and the left arm
 * is solved with two-bone IK to cup the right hand.
 */
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Matrix, Quaternion, TransformNode, Vector3, type AbstractMesh, type Scene } from '../rendering/babylon';
import { loadContainer } from '../rendering/gltf';

const ARMS_ANIM_URL = 'models/fp-arms-anim.glb';

const DEG = Math.PI / 180;

/** Joints used here (names as in the pack). */
const JOINTS = {
  cam: 'FPS_Camera_j_01',
  spine: 'Spine_02',
  main: 'Main_j_049',
  mag1: 'Mag1_j_050',
  mag2: 'Mag2_j_051',
  lArm: 'LeftArm_026',
  lFore: 'LeftForeArm_027',
  lHand: 'LeftHand_028',
  lIndex: 'LeftHandIndex1_033',
  lMiddle: 'LeftHandMiddle1_037',
  lPinky: 'LeftHandPinky1_045',
  rArm: 'RightArm_03',
  rFore: 'RightForeArm_04',
  rHand: 'RightHand_05',
  rIndex: 'RightHandIndex1_010',
  rMiddle: 'RightHandMiddle1_014',
  rPinky: 'RightHandPinky1_022',
} as const;
type JointKey = keyof typeof JOINTS;

/** Measured on the pack's M4, in the weapon joint's space (centimetres; +Z = muzzle, +Y = up, X mirrored). */
const M4 = { grip: new Vector3(0.3, -10, -7.5), handguardBottomY: -1.19, cm: 0.01 };

/**
 * Framing: seen with this game's wide field of view the pack's camera shows the gun too low and too
 * central, so the rig is raised by pitching it about its spine (the cut-off forearm ends stay out of
 * view), turned to the right and pushed slightly forward.
 */
interface Framing {
  /** Raise (pitch up) and turn right about the rig's spine, radians. */
  pitch: number;
  yaw: number;
  /** Then shift (metres, camera space). */
  offset: Vector3;
}
const FRAMING: Framing = { pitch: 9 * DEG, yaw: 7 * DEG, offset: new Vector3(0.02, -0.01, 0.04) };
/** Fire clip playback speed, and the fastest the reload clip may be squeezed. */
const FIRE_SPEED = 1.15;
const MAX_RELOAD_SPEED = 2.2;

type ClipName = 'draw' | 'fire' | 'reload' | 'reloadEmpty';
const CLIP_NAMES: Record<ClipName, string> = { draw: 'Draw', fire: 'Fire', reload: 'Reload', reloadEmpty: 'Reload_Empty' };
/**
 * Where each clip sits on the pack's shared timeline (seconds). The loader pads every channel back to
 * frame 0, so the authored ranges can't be read from the keys.
 */
const CLIP_RANGE: Record<ClipName, [number, number]> = {
  reload: [0.0333, 3.6667],
  reloadEmpty: [3.7, 7.5],
  fire: [7.5333, 8.3333],
  draw: [8.9667, 10.0],
};

interface Clip {
  group: AnimationGroup;
  /** Key range in frames (the pack's clips share one timeline). */
  from: number;
  to: number;
  fps: number;
}

/** The loaded pack (one per session). */
export class ArmsRigTemplate {
  private constructor(readonly container: AssetContainer) {}

  static async load(scene: Scene): Promise<ArmsRigTemplate> {
    const container = await loadContainer(scene, ARMS_ANIM_URL);
    const names = new Set(container.transformNodes.map((n) => n.name));
    const groups = new Set(container.animationGroups.map((g) => g.name));
    const missing = [...Object.values(JOINTS).filter((n) => !names.has(n)), ...Object.values(CLIP_NAMES).filter((n) => !groups.has(n))];
    if (missing.length) {
      container.dispose();
      throw new Error(`arms pack: missing ${missing.join(', ')}`);
    }
    return new ArmsRigTemplate(container);
  }

  /** A set of arms for one view model (the container stays shared). */
  createArms(holder: TransformNode, renderingGroup: number): AnimatedArms {
    return new AnimatedArms(this, holder, renderingGroup);
  }

  dispose() {
    this.container.dispose();
  }
}

/** A gun as the rig needs it (gun-root space, metres). */
export interface RigGun {
  root: TransformNode;
  gripLocal: Vector3;
  /** Handguard underside centre (rifles). */
  supportLocal: Vector3 | null;
  pistol: boolean;
  mag: TransformNode | null;
}

export interface RigState {
  /** 0 → 1 while equipping, 1 when done. */
  equip: number;
  /** Reload clip progress 0 → 1, or −1 when not reloading. */
  reload: number;
  reloadEmpty: boolean;
  /** Aim-down-sights blend 0 → 1 and the gun-root position wanted when fully aimed (holder space). */
  ads: number;
  adsPos: Vector3;
  /** Height of the gun's sight line above its root (so the aimed sight lands on the same spot at another depth). */
  sightY: number;
  /** Extra offset in holder space (sway, bob, kick, pistol reload dip). */
  offsetPos: Vector3;
  offsetRot: Vector3;
}

interface GunCache {
  /** Rotation of the gun relative to the weapon joint frame (pitch so the handguard meets the hand). */
  pitch: number;
  /** Gun pose in anchor space at the idle frame (for aiming down sights). */
  idle: Matrix | null;
  /** Anchor at the hip: turns the rig about the gun so the barrel points at the crosshair. */
  hip: Matrix | null;
  magRest: Matrix | null;
}

const tA = new Matrix();
const tB = new Matrix();
const tI = new Matrix();
const tT = new Matrix();
const tR = new Matrix();
const tS = new Vector3();
const tP = new Vector3();
const tQ = new Quaternion();

export class AnimatedArms {
  private readonly anchor: TransformNode;
  private readonly frame: TransformNode;
  private readonly inst: InstantiatedEntries;
  private readonly j: Record<JointKey, TransformNode>;
  /** Every node of the rig, parents first (for refreshing world matrices). */
  private readonly nodes: TransformNode[];
  private readonly meshes: AbstractMesh[];
  private readonly clips: Record<ClipName, Clip>;
  private readonly mag1Rest: Matrix;
  private readonly guns = new Map<TransformNode, GunCache>();
  private fireT = -1;
  private readonly packCam: Vector3;
  private readonly packSpine: Vector3;
  private framed = false;
  /** Left-hand axes in its own space: towards the middle knuckle, and from little finger to index. */
  private readonly lFingers: Vector3;
  private readonly lSide: Vector3;
  private readonly rFingers: Vector3;
  private readonly rSide: Vector3;
  /** Right-hand joint relative to the M4 grip frame in the idle pose. */
  private readonly rightHold: Matrix;

  constructor(
    template: ArmsRigTemplate,
    holder: TransformNode,
    renderingGroup: number,
  ) {
    const scene = holder.getScene();
    this.anchor = new TransformNode('fpa-anchor', scene);
    this.anchor.parent = holder;
    this.anchor.rotationQuaternion = Quaternion.Identity();
    this.frame = new TransformNode('fpa-frame', scene);
    this.frame.parent = this.anchor;
    this.frame.rotationQuaternion = Quaternion.Identity();

    this.inst = template.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    for (const r of this.inst.rootNodes) r.parent = this.frame;
    const all: TransformNode[] = [];
    const walk = (n: TransformNode) => {
      all.push(n);
      for (const c of n.getChildren()) if (c instanceof TransformNode) walk(c);
    };
    for (const r of this.inst.rootNodes) walk(r as TransformNode);
    this.nodes = all;
    this.meshes = this.inst.rootNodes.flatMap((r) => r.getChildMeshes(false));
    for (const m of this.meshes) {
      m.renderingGroupId = renderingGroup;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true; // skinned bounds don't follow the animation
      m.receiveShadows = false;
    }
    const byName = new Map(all.map((n) => [n.name, n]));
    this.j = Object.fromEntries(
      Object.entries(JOINTS).map(([k, name]) => {
        const n = byName.get(name)!;
        n.rotationQuaternion ??= Quaternion.FromEulerVector(n.rotation);
        return [k, n];
      }),
    ) as Record<JointKey, TransformNode>;

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

    // idle pose; remember where the pack's camera and spine are, then frame the rig for rifles
    this.show('fire', this.clips.fire.from);
    this.refresh();
    this.frame.computeWorldMatrix(true).invertToRef(tI);
    this.packCam = this.j.cam.getWorldMatrix().multiply(tI).getTranslation();
    this.packSpine = this.j.spine.getWorldMatrix().multiply(tI).getTranslation();
    this.applyFraming();
    this.refresh();

    this.mag1Rest = this.localTo(this.j.mag1, this.j.main);
    const axes = (hand: TransformNode, middle: TransformNode, index: TransformNode, pinky: TransformNode) => {
      const inv = hand.getWorldMatrix().clone().invert();
      const loc = (n: TransformNode) => Vector3.TransformCoordinates(n.getAbsolutePosition(), inv);
      return [loc(middle).normalize(), loc(index).subtract(loc(pinky)).normalize()];
    };
    [this.lFingers, this.lSide] = axes(this.j.lHand, this.j.lMiddle, this.j.lIndex, this.j.lPinky);
    [this.rFingers, this.rSide] = axes(this.j.rHand, this.j.rMiddle, this.j.rIndex, this.j.rPinky);
    // the idle right-hand hold relative to the M4's grip frame (reused on pistols)
    this.rightHold = this.j.rHand.getWorldMatrix().multiply(this.m4GripFrame().invert());
  }

  /**
   * Frame the rig: rotate about the spine (cut-off forearm ends stay out of view), shift, and put the
   * pack's camera joint at the origin. frame = T(−spine)·R·T(spine − cam + offset).
   */
  private applyFraming() {
    const f = FRAMING;
    const sp = this.packSpine;
    const c = this.packCam;
    const R = Matrix.RotationYawPitchRoll(f.yaw, -f.pitch, 0);
    const F = Matrix.Translation(-sp.x, -sp.y, -sp.z)
      .multiply(R)
      .multiply(Matrix.Translation(sp.x - c.x + f.offset.x, sp.y - c.y + f.offset.y, sp.z - c.z + f.offset.z));
    F.decompose(tS, this.frame.rotationQuaternion!, this.frame.position);
    this.framed = true;
    this.guns.forEach((g) => (g.idle = null)); // the idle gun pose depends on the framing
  }

  setVisible(v: boolean) {
    this.anchor.setEnabled(v);
  }

  fire() {
    this.fireT = 0;
  }

  /** How long the reload clip takes for a reload of `reloadTime` seconds (faster than authored, never frantic). */
  reloadClipSeconds(reloadTime: number, empty: boolean): number {
    const c = this.clips[empty ? 'reloadEmpty' : 'reload'];
    const len = (c.to - c.from) / c.fps;
    return Math.min(len, Math.max(len / MAX_RELOAD_SPEED, reloadTime * 0.8));
  }

  dispose() {
    this.inst.dispose();
    this.frame.dispose();
    this.anchor.dispose();
  }

  /* ---------------- per frame ---------------- */

  update(dt: number, gun: RigGun, s: RigState) {
    if (!this.framed) this.applyFraming();
    if (gun.pistol) {
      // no pistol clips: the game places the pistol itself; both arms are solved onto it from the idle pose
      this.anchor.position.setAll(0);
      this.anchor.rotationQuaternion!.copyFromFloats(0, 0, 0, 1);
      this.show('fire', this.clips.fire.from);
      this.refresh();
      this.holdPistol(gun);
      return;
    }
    const cache = this.cacheFor(gun);
    // 1. pose the arms from the right clip
    if (s.equip < 1) this.showAt('draw', s.equip);
    else if (s.reload >= 0 && !gun.pistol) this.showAt(s.reloadEmpty ? 'reloadEmpty' : 'reload', s.reload);
    else if (this.fireT >= 0) {
      const c = this.clips.fire;
      const f = c.from + this.fireT * c.fps;
      if (f >= c.to) {
        this.fireT = -1;
        this.show('fire', c.from);
      } else this.show('fire', f);
    } else this.show('fire', this.clips.fire.from);
    if (this.fireT >= 0) this.fireT += dt * FIRE_SPEED;

    // 2. place the rig: hip framing, blended towards aiming down sights, plus sway/bob/kick
    // hip: barrel aimed at the crosshair (see cacheFor)
    cache.hip!.decompose(tS, this.anchor.rotationQuaternion!, this.anchor.position);
    if (s.ads > 0.001 && cache.idle) {
      // anchor_ads = inv(idle gun pose) · (gun pose wanted when aiming): keeps the idle depth, centres the sights
      // aim at the idle depth; the sights' drop below the eye scales with depth so they sit at the same spot on screen
      const z = cache.idle.getTranslation().z;
      const want = Matrix.Translation(s.adsPos.x, (s.adsPos.y + s.sightY) * (z / s.adsPos.z) - s.sightY, z);
      const ads = cache.idle.clone().invert().multiply(want);
      ads.decompose(tS, tQ, tP);
      Quaternion.SlerpToRef(this.anchor.rotationQuaternion!.clone(), tQ, s.ads, this.anchor.rotationQuaternion!);
      Vector3.LerpToRef(this.anchor.position.clone(), tP, s.ads, this.anchor.position);
    }
    const extra = Quaternion.RotationYawPitchRoll(s.offsetRot.y, s.offsetRot.x, s.offsetRot.z);
    extra.multiplyToRef(this.anchor.rotationQuaternion!, this.anchor.rotationQuaternion!);
    this.anchor.position.addInPlace(s.offsetPos);
    this.refresh();

    // 3. the gun rides the weapon joint
    this.placeGun(gun, cache);

    // 4. magazine follows whichever pack magazine is nearer the gun
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
    for (const n of this.nodes) n.computeWorldMatrix(true);
  }

  /** `node`'s transform relative to `ancestor`. */
  private localTo(node: TransformNode, ancestor: TransformNode): Matrix {
    return node.getWorldMatrix().multiply(ancestor.getWorldMatrix().clone().invert());
  }

  private cacheFor(gun: RigGun): GunCache {
    let c = this.guns.get(gun.root);
    if (!c) {
      // pitch the gun about its grip so its handguard underside meets the left hand (the M4's handguard height)
      let pitch = 0;
      if (gun.supportLocal && !gun.pistol) {
        const want = (M4.handguardBottomY - M4.grip.y) * M4.cm;
        const have = gun.supportLocal.y - gun.gripLocal.y;
        const dz = gun.supportLocal.z - gun.gripLocal.z;
        if (dz > 0.05) pitch = Math.atan2(want - have, dz);
      }
      c = { pitch, idle: null, hip: null, magRest: gun.mag ? gun.mag.computeWorldMatrix(true).multiply(gun.root.computeWorldMatrix(true).clone().invert()) : null };
      this.guns.set(gun.root, c);
    }
    if (c.idle) return c;
    // idle gun pose in anchor space (rig at the idle frame, anchor at rest)
    this.show('fire', this.clips.fire.from);
    this.anchor.position.setAll(0);
    this.anchor.rotationQuaternion!.copyFromFloats(0, 0, 0, 1);
    this.refresh();
    const W = this.gunWorld(gun, c);
    c.idle = W.multiply(this.anchor.getWorldMatrix().clone().invert());
    // hip: rotate the whole rig about the gun's root so the barrel runs parallel to the view axis — its
    // vanishing point, where it appears to aim, is then the screen centre (the crosshair)
    const fwd = Vector3.TransformNormal(Vector3.Forward(), c.idle).normalize();
    const pivot = c.idle.getTranslation();
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(fwd, Vector3.Forward(), q);
    c.hip = Matrix.Translation(-pivot.x, -pivot.y, -pivot.z).multiply(Matrix.FromQuaternionToRef(q, new Matrix())).multiply(Matrix.Translation(pivot.x, pivot.y, pivot.z));
    return c;
  }

  /** World matrix of the gun root that puts its grip on the M4's grip, aligned with the weapon joint. */
  private gunWorld(gun: RigGun, c: GunCache): Matrix {
    const W = this.j.main.getWorldMatrix();
    const fwd = Vector3.TransformNormal(Vector3.Forward(), W).normalize();
    let up = Vector3.TransformNormal(Vector3.Up(), W).normalize();
    up = up.subtract(fwd.scale(Vector3.Dot(up, fwd))).normalize();
    // pitch up about the right axis
    const cs = Math.cos(c.pitch);
    const sn = Math.sin(c.pitch);
    const f2 = fwd.scale(cs).add(up.scale(sn));
    const u2 = up.scale(cs).subtract(fwd.scale(sn));
    const right = Vector3.Cross(u2, f2).normalize();
    const grip = Vector3.TransformCoordinates(M4.grip, W);
    const g = gun.gripLocal;
    const pos = grip.subtract(right.scale(g.x)).subtract(u2.scale(g.y)).subtract(f2.scale(g.z));
    return Matrix.FromValues(right.x, right.y, right.z, 0, u2.x, u2.y, u2.z, 0, f2.x, f2.y, f2.z, 0, pos.x, pos.y, pos.z, 1);
  }

  private placeGun(gun: RigGun, c: GunCache) {
    const W = this.gunWorld(gun, c);
    (gun.root.parent as TransformNode).getWorldMatrix().invertToRef(tI);
    W.multiplyToRef(tI, tA);
    tA.decompose(tS, tQ, tP);
    gun.root.rotationQuaternion ??= Quaternion.Identity();
    gun.root.rotationQuaternion.copyFrom(tQ);
    gun.root.position.copyFrom(tP);
    gun.root.computeWorldMatrix(true);
  }

  private placeMag(gun: RigGun, magRest: Matrix) {
    const main = this.j.main;
    const l1 = this.localTo(this.j.mag1, main);
    const l2 = this.localTo(this.j.mag2, main);
    const rest = this.mag1Rest.getTranslation();
    const cur = Vector3.Distance(l2.getTranslation(), rest) < Vector3.Distance(l1.getTranslation(), rest) ? l2 : l1;
    // delta in weapon-joint space, carried over to gun space: Dg = inv(C) · Dm · C, with C = main → gun root
    const Dm = this.mag1Rest.clone().invert().multiply(cur);
    const C = main.getWorldMatrix().multiply(gun.root.getWorldMatrix().clone().invert());
    const Dg = C.clone().invert().multiply(Dm).multiply(C);
    magRest.multiplyToRef(Dg, tB);
    const mag = gun.mag!;
    tB.decompose(tS, tQ, tP);
    mag.rotationQuaternion ??= Quaternion.Identity();
    mag.rotationQuaternion.copyFrom(tQ);
    mag.position.copyFrom(tP);
  }

  /* ---------------- pistol: left hand cups the right ---------------- */

  /** Rotate `node` by the world rotation `q` about its own pivot (works through mirrored parents). */
  private rotateWorld(node: TransformNode, q: Quaternion) {
    const W = node.getWorldMatrix();
    W.getTranslationToRef(tP);
    Matrix.TranslationToRef(-tP.x, -tP.y, -tP.z, tT);
    W.multiplyToRef(tT, tA);
    Matrix.FromQuaternionToRef(q, tR);
    tA.multiplyToRef(tR, tB);
    Matrix.TranslationToRef(tP.x, tP.y, tP.z, tT);
    tB.multiplyToRef(tT, tA);
    (node.parent as TransformNode).getWorldMatrix().invertToRef(tI);
    tA.multiplyToRef(tI, tB);
    tB.decompose(tS, tQ, tP);
    node.rotationQuaternion!.copyFrom(tQ);
    node.position.copyFrom(tP);
    node.computeWorldMatrix(true);
  }

  private refreshFrom(node: TransformNode) {
    const i = this.nodes.indexOf(node);
    node.computeWorldMatrix(true);
    for (let k = i + 1; k < this.nodes.length; k++) {
      let p = this.nodes[k].parent;
      while (p && p !== node) p = p.parent;
      if (p) this.nodes[k].computeWorldMatrix(true);
    }
  }

  /** Unit axes of the M4's grip frame in world space (+Z muzzle, +Y up), from the weapon joint. */
  private m4GripFrame(): Matrix {
    const W = this.j.main.getWorldMatrix();
    const fwd = Vector3.TransformNormal(Vector3.Forward(), W).normalize();
    let up = Vector3.TransformNormal(Vector3.Up(), W).normalize();
    up = up.subtract(fwd.scale(Vector3.Dot(up, fwd))).normalize();
    const right = Vector3.Cross(up, fwd).normalize();
    const g = Vector3.TransformCoordinates(M4.grip, W);
    return Matrix.FromValues(right.x, right.y, right.z, 0, up.x, up.y, up.z, 0, fwd.x, fwd.y, fwd.z, 0, g.x, g.y, g.z, 1);
  }

  /**
   * Two-bone IK: bend `upper`/`fore` so the `hand` joint reaches `target` (the elbow keeps the side the
   * animation gave it), then turn the hand so its `fingers` axis points along `wantFingers` and its
   * `side` axis (towards the index finger) as close to `wantSide` as possible.
   */
  private solveArm(upper: TransformNode, fore: TransformNode, hand: TransformNode, target: Vector3, fingers: Vector3, side: Vector3, wantFingers: Vector3, wantSide: Vector3) {
    const A = upper.getAbsolutePosition().clone();
    const B = fore.getAbsolutePosition().clone();
    const C = hand.getAbsolutePosition().clone();
    const l1 = Vector3.Distance(A, B);
    const l2 = Vector3.Distance(B, C);
    const AT = target.subtract(A);
    const dist = AT.length();
    const d = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999);
    const u = AT.scale(1 / Math.max(dist, 1e-5));
    const nrm = B.subtract(A);
    nrm.subtractInPlace(u.scale(Vector3.Dot(nrm, u)));
    if (nrm.lengthSquared() < 1e-8) nrm.set(0, -1, 0);
    nrm.normalize();
    const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const E = A.add(u.scale(l1 * cosA)).addInPlace(nrm.scale(l1 * Math.sqrt(1 - cosA * cosA)));
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(B.subtract(A).normalize(), E.subtract(A).normalize(), q);
    this.rotateWorld(upper, q);
    this.refreshFrom(upper);
    const B2 = fore.getAbsolutePosition().clone();
    const C2 = hand.getAbsolutePosition().clone();
    Quaternion.FromUnitVectorsToRef(C2.subtract(B2).normalize(), A.add(u.scale(d)).subtract(B2).normalize(), q);
    this.rotateWorld(fore, q);
    this.refreshFrom(fore);

    const fNow = Vector3.TransformNormal(fingers, hand.getWorldMatrix()).normalize();
    Quaternion.FromUnitVectorsToRef(fNow, wantFingers.normalizeToNew(), q);
    this.rotateWorld(hand, q);
    const W2 = hand.getWorldMatrix();
    const f2 = Vector3.TransformNormal(fingers, W2).normalize();
    const sNow = Vector3.TransformNormal(side, W2).normalize();
    const want = wantSide.subtract(f2.scale(Vector3.Dot(wantSide, f2))).normalize();
    const have = sNow.subtract(f2.scale(Vector3.Dot(sNow, f2))).normalize();
    let ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(have, want))));
    if (Vector3.Dot(Vector3.Cross(have, want), f2) < 0) ang = -ang;
    Quaternion.RotationAxisToRef(f2, ang, q);
    this.rotateWorld(hand, q);
    this.refreshFrom(hand);
  }

  /**
   * Pistol: the right hand takes the same hold on the pistol's grip that the pack's idle pose has on the
   * M4's grip; the left hand cups it from below-left, fingers wrapped round the right hand.
   */
  private holdPistol(gun: RigGun) {
    const G = gun.root.computeWorldMatrix(true);
    const right = Vector3.TransformNormal(Vector3.Right(), G).normalize();
    const up = Vector3.TransformNormal(Vector3.Up(), G).normalize();
    const fwd = Vector3.TransformNormal(Vector3.Forward(), G).normalize();
    const grip = Vector3.TransformCoordinates(gun.gripLocal, G);
    const gripFrame = Matrix.FromValues(right.x, right.y, right.z, 0, up.x, up.y, up.z, 0, fwd.x, fwd.y, fwd.z, 0, grip.x, grip.y, grip.z, 1);

    // right hand: the idle hold, carried from the M4's grip frame to the pistol's
    const target = this.rightHold.multiply(gripFrame);
    const { rArm, rFore, rHand, lArm, lFore, lHand } = this.j;
    this.solveArm(
      rArm,
      rFore,
      rHand,
      target.getTranslation(),
      this.rFingers,
      this.rSide,
      Vector3.TransformNormal(this.rFingers, target),
      Vector3.TransformNormal(this.rSide, target),
    );

    // left hand: wrist below-left of the grip, fingers wrapping forward-right round the right hand, index side up
    const wantFingers = fwd.scale(0.55).addInPlace(right.scale(0.7)).addInPlace(up.scale(-0.15)).normalize();
    const palm = grip.add(right.scale(-0.04)).addInPlace(up.scale(-0.04)).addInPlace(fwd.scale(0.005));
    const wrist = palm.subtract(wantFingers.scale(0.06));
    this.solveArm(lArm, lFore, lHand, wrist, this.lFingers, this.lSide, wantFingers, up.scale(0.7).addInPlace(fwd.scale(0.6)));
  }
}
