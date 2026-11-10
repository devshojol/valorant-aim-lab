/**
 * First-person arms. Two looks share one posing path:
 *  - the arm model (public/models/fp-arms.glb, skinned at load by ArmModel.ts): forearm, gloved
 *    hand, jointed fingers and thumb;
 *  - a built-in rig made from simple shapes (sleeved upper arm and forearm, a cuff, a gloved hand
 *    with segmented fingers and thumb), used when the model isn't available.
 * The shoulders sit below the camera's view; each frame both arms are solved with two-bone IK onto
 * the gun — the right hand on the pistol grip, the left hand under the handguard (or cupping the
 * right hand on pistols) — then the hands are turned to wrap the gun and the fingers curl. The
 * model has no upper arm, so its forearm is laid along the IK forearm and stretched just enough
 * that its cut-off elbow end stays outside the screen.
 *
 * Every segment points along its node's local +Z; palms face local −Y.
 */
import {
  Bone,
  Color3,
  CreateCapsule,
  CreateCylinder,
  CreateSphere,
  Matrix,
  Mesh,
  Quaternion,
  Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
  type AbstractMesh,
  type Camera,
  type Scene,
} from '../rendering/babylon';
import type { ArmModel, ArmSideData } from './ArmModel';
import type { ArmsRigTemplate } from './AnimatedArms';
import { BONE, boneLocalMatrix } from './armBones';

/**
 * Shoulder centre in camera space (metres) and segment lengths. The shoulders sit low and level
 * with the eye so the upper arms stay below the screen and the elbows drop out of view when aiming.
 */
const SHOULDER_CENTRE = new Vector3(0, -0.5, 0);
const SHOULDER_HALF_WIDTH = 0.2;
const UPPER_LEN = 0.45;
const FORE_LEN = 0.44;
const PALM_LEN = 0.085;
/** Left-hand finger bend on a handguard: knuckle, middle, end joint (radians). */
const SUPPORT_CURL = [1.25, 0.45, 0.5] as const;
/** Rough half-width of a pistol grip, so the palm rests against its side rather than inside it. */
const GRIP_HALF_WIDTH = 0.016;

/** Colours of the arm kit. */
const KIT = { sleeve: '#2f3a46', sleeveDark: '#232c36', cuff: '#ff4655', glove: '#2b3038', knuckle: '#3a414b' };

/** What the arms are built from: the loaded arm model, or nothing (the built-in rig). */
export class ArmsTemplate {
  /**
   * @param model the skinned glove-arm model (fp-arms.glb), for these posed arms
   * @param rig the animated arms pack (fp-arms-anim.glb), used instead of these arms when present
   */
  constructor(
    readonly model: ArmModel | null = null,
    readonly rig: ArmsRigTemplate | null = null,
  ) {}

  /** Load and skin the arm model (public/models/fp-arms.glb). Rejects if it's missing or unexpected. */
  static async load(scene: Scene): Promise<ArmsTemplate> {
    if (__LOCAL_MODELS__) {
      const { loadArmModel } = await import('./ArmModel');
      return new ArmsTemplate(await loadArmModel(scene));
    }
    throw new Error('the arm model is not part of this build');
  }

  /** Load the animated arms pack (public/models/fp-arms-anim.glb). Rejects if it's missing or unexpected. */
  static async loadAnimated(scene: Scene): Promise<ArmsTemplate> {
    if (__LOCAL_MODELS__) {
      const { ArmsRigTemplate } = await import('./AnimatedArms');
      return new ArmsTemplate(null, await ArmsRigTemplate.load(scene));
    }
    throw new Error('the animated arms are not part of this build');
  }

  dispose() {
    this.model?.container.dispose();
    this.rig?.dispose();
  }
}

/** Where the gun wants the hands, in world space. */
export interface ArmTargets {
  grip: Vector3;
  /** Underside centre of the handguard (rifles), or null for pistols. */
  support: Vector3 | null;
  /** Gun axes in world space. */
  right: Vector3;
  up: Vector3;
  forward: Vector3;
  pistol: boolean;
}

interface Arm {
  side: 1 | -1;
  /** IK chain. On the built-in rig the meshes hang from these. */
  shoulder: TransformNode;
  elbow: TransformNode;
  wrist: TransformNode;
  /** The palm and fingers hang from this (the wrist itself on the built-in rig, a bone on the model). */
  hand: TransformNode;
  /** Model only: forearm bones at the elbow end and wrist end, and the forearm's rest length. */
  forearm: { elbow: TransformNode; wrist: TransformNode; length: number } | null;
  /** Finger joints (curl about local X). On the model the thumb is posed separately. */
  joints: { node: TransformNode; thumb: boolean; index: boolean; seg: number }[];
  /** Model only: thumb chain and its rest direction in the hand frame. */
  thumb: { base: TransformNode; mid: TransformNode; tip: TransformNode; rest: Vector3 } | null;
}

const tA = new Matrix();
const tB = new Matrix();
const tR = new Matrix();
const tI = new Matrix();
const tT = new Matrix();
const tQ = new Quaternion();
const tS = new Vector3();
const tP = new Vector3();

export class FirstPersonArms {
  private readonly root: TransformNode;
  private readonly left: Arm;
  private readonly right: Arm;
  private readonly meshes: AbstractMesh[] = [];
  private readonly mats: StandardMaterial[] = [];
  private readonly skeletons: Skeleton[] = [];
  /** Wrist → palm centre along the fingers, and palm centre → palm surface (metres). */
  private readonly palmOffset: number;
  private readonly palmHalf: number;
  /** How far left of the handguard centre the left palm sits, so its knuckles line up with the right edge. */
  private readonly supportShift: number;

  constructor(
    template: ArmsTemplate,
    private readonly holder: TransformNode,
    private readonly renderingGroup: number,
  ) {
    const scene = holder.getScene();
    this.root = new TransformNode('fp-arms', scene);
    this.root.parent = holder;
    const model = template.model;
    if (model) {
      this.palmOffset = model.palmOffset;
      this.palmHalf = model.palmHalf;
      this.supportShift = model.knuckleReach - 0.022;
      this.right = this.buildModelArm(scene, 1, model, model.right);
      this.left = this.buildModelArm(scene, -1, model, model.left);
      return;
    }
    this.palmOffset = PALM_LEN * 0.5;
    this.palmHalf = 0.016;
    this.supportShift = PALM_LEN * 0.5 - 0.022;
    const mat = (name: string, hex: string, spec = 0.08) => {
      const m = new StandardMaterial(`fp-${name}`, scene);
      m.diffuseColor = Color3.FromHexString(hex);
      m.specularColor = new Color3(spec, spec, spec);
      m.emissiveColor = Color3.FromHexString(hex).scale(0.18);
      this.mats.push(m);
      return m;
    };
    const m = {
      sleeve: mat('sleeve', KIT.sleeve),
      sleeveDark: mat('sleeve-dark', KIT.sleeveDark),
      cuff: mat('cuff', KIT.cuff, 0.12),
      glove: mat('glove', KIT.glove, 0.12),
      knuckle: mat('knuckle', KIT.knuckle, 0.2),
    };
    this.right = this.buildArm(scene, 1, m);
    this.left = this.buildArm(scene, -1, m);
  }

  private buildArm(scene: Scene, side: 1 | -1, m: Record<string, StandardMaterial>): Arm {
    const tag = side > 0 ? 'R' : 'L';
    const node = (name: string, parent: TransformNode, z: number, x = 0, y = 0) => {
      const n = new TransformNode(`fp-${tag}-${name}`, scene);
      n.parent = parent;
      n.position.set(x, y, z);
      n.rotationQuaternion = Quaternion.Identity();
      return n;
    };
    const add = (mesh: Mesh, parent: TransformNode, mtl: StandardMaterial) => {
      mesh.parent = parent;
      mesh.material = mtl;
      mesh.renderingGroupId = this.renderingGroup;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      this.meshes.push(mesh);
      return mesh;
    };
    /** Tapered segment along +Z from z=0 to z=len. */
    const limb = (name: string, parent: TransformNode, len: number, d0: number, d1: number, mtl: StandardMaterial) => {
      const c = CreateCylinder(`fp-${tag}-${name}`, { height: len, diameterBottom: d0, diameterTop: d1, tessellation: 12 }, scene);
      c.rotation.x = Math.PI / 2;
      c.position.z = len / 2;
      return add(c, parent, mtl);
    };

    const shoulder = node('shoulder', this.root, 0);
    shoulder.position.set(side * SHOULDER_HALF_WIDTH, SHOULDER_CENTRE.y, SHOULDER_CENTRE.z);
    limb('upper', shoulder, UPPER_LEN, 0.115, 0.095, m.sleeve);
    const elbow = node('elbow', shoulder, UPPER_LEN);
    add(CreateSphere(`fp-${tag}-elbow-pad`, { diameter: 0.1, segments: 8 }, scene), elbow, m.sleeveDark);
    limb('fore', elbow, FORE_LEN, 0.092, 0.07, m.sleeve);
    const cuff = CreateCylinder(`fp-${tag}-cuff`, { height: 0.018, diameter: 0.076, tessellation: 12 }, scene);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = FORE_LEN - 0.035;
    add(cuff, elbow, m.cuff);
    const hand = node('hand', elbow, FORE_LEN);
    // palm (faces −Y) with a rounded knuckle ridge and a padded back
    const palm = CreateSphere(`fp-${tag}-palm`, { diameterX: 0.086, diameterY: 0.036, diameterZ: PALM_LEN * 1.2, segments: 10 }, scene);
    palm.position.z = PALM_LEN / 2;
    add(palm, hand, m.glove);
    const ridge = (name: string, len: number, r: number, x: number, y: number, z: number, axis: Vector3, mtl: StandardMaterial) => {
      const c = CreateCapsule(`fp-${tag}-${name}`, { height: len, radius: r, orientation: axis, tessellation: 10, capSubdivisions: 3 }, scene);
      c.position.set(x, y, z);
      return add(c, hand, mtl);
    };
    ridge('knuckles', 0.086, 0.017, 0, 0.002, PALM_LEN - 0.012, Vector3.Right(), m.glove);
    const pad = CreateSphere(`fp-${tag}-back-pad`, { diameterX: 0.058, diameterY: 0.016, diameterZ: 0.056, segments: 8 }, scene);
    pad.position.set(0, 0.015, PALM_LEN * 0.55);
    add(pad, hand, m.knuckle);
    ridge('heel', 0.07, 0.019, 0, -0.004, 0.012, Vector3.Right(), m.glove);

    const joints: Arm['joints'] = [];
    // fingers: with the palm down and fingers forward, the thumb side is −X on a right hand, +X on a left
    const spread = [0.029, 0.01, -0.009, -0.027];
    const lens = [
      [0.042, 0.028, 0.022],
      [0.046, 0.03, 0.024],
      [0.044, 0.028, 0.022],
      [0.036, 0.024, 0.02],
    ];
    /** Rounded finger segment along +Z from z=0 to z=len. */
    const seg = (name: string, parent: TransformNode, len: number, r: number) => {
      const c = CreateCapsule(`fp-${tag}-${name}`, { height: len + r * 1.2, radius: r, orientation: Vector3.Forward(), tessellation: 8, capSubdivisions: 2 }, scene);
      c.position.z = len / 2;
      return add(c, parent, m.glove);
    };
    spread.forEach((x, fi) => {
      let parent = node(`f${fi}-base`, hand, PALM_LEN - 0.006, -side * x, -0.002);
      lens[fi].forEach((len, si) => {
        const j = si === 0 ? parent : node(`f${fi}-${si}`, parent, lens[fi][si - 1]);
        seg(`f${fi}-${si}-seg`, j, len, si === 2 ? 0.0085 : 0.0095);
        joints.push({ node: j, thumb: false, index: fi === 0, seg: si });
        parent = j;
      });
    });
    // thumb: from the palm's thumb edge, angled forward and across the palm
    const thumbBase = node('thumb', hand, 0.024, -side * 0.04, -0.01);
    Quaternion.RotationYawPitchRollToRef(side * 0.75, 0.35, 0, thumbBase.rotationQuaternion!);
    seg('thumb-0', thumbBase, 0.04, 0.011);
    const thumbTip = node('thumb-1', thumbBase, 0.04);
    seg('thumb-1-seg', thumbTip, 0.03, 0.0095);
    joints.push({ node: thumbBase, thumb: true, index: false, seg: 0 }, { node: thumbTip, thumb: true, index: false, seg: 1 });

    return { side, shoulder, elbow, wrist: hand, hand, forearm: null, joints, thumb: null };
  }

  /** IK chain without meshes (the model has no upper arm). */
  private chain(scene: Scene, tag: string, side: 1 | -1) {
    const node = (name: string, parent: TransformNode, z: number) => {
      const n = new TransformNode(`fp-${tag}-${name}`, scene);
      n.parent = parent;
      n.position.set(0, 0, z);
      n.rotationQuaternion = Quaternion.Identity();
      return n;
    };
    const shoulder = node('shoulder', this.root, 0);
    shoulder.position.set(side * SHOULDER_HALF_WIDTH, SHOULDER_CENTRE.y, SHOULDER_CENTRE.z);
    const elbow = node('elbow', shoulder, UPPER_LEN);
    const wrist = node('wrist', elbow, FORE_LEN);
    return { shoulder, elbow, wrist };
  }

  private buildModelArm(scene: Scene, side: 1 | -1, model: ArmModel, data: ArmSideData): Arm {
    const tag = side > 0 ? 'R' : 'L';
    const { shoulder, elbow, wrist } = this.chain(scene, tag, side);

    const vd = new VertexData();
    vd.positions = data.positions;
    vd.normals = data.normals;
    if (data.tangents) vd.tangents = data.tangents;
    vd.uvs = data.uvs;
    vd.indices = data.indices;
    vd.matricesIndices = data.matricesIndices;
    vd.matricesWeights = data.matricesWeights;
    const mesh = new Mesh(`fp-${tag}-arm`, scene);
    vd.applyToMesh(mesh, false);
    mesh.parent = this.root;
    mesh.material = model.material;
    mesh.renderingGroupId = this.renderingGroup;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.numBoneInfluencers = 4;
    this.meshes.push(mesh);

    // skeleton: each bone driven by a transform node with the same local transform (roots under this.root,
    // which is also the mesh's parent, so bone space = mesh space)
    const skeleton = new Skeleton(`fp-${tag}-skeleton`, `fp-${tag}-skeleton`, scene);
    this.skeletons.push(skeleton);
    const bones: Bone[] = [];
    const nodes: TransformNode[] = [];
    data.bones.forEach((def, i) => {
      const bone = new Bone(`fp-${tag}-${def.name}`, skeleton, def.parent >= 0 ? bones[def.parent] : null, boneLocalMatrix(def), null, null, i);
      const node = new TransformNode(`fp-${tag}-${def.name}-node`, scene);
      node.parent = def.parent >= 0 ? nodes[def.parent] : this.root;
      node.position.copyFrom(def.local);
      node.rotationQuaternion = Quaternion.Identity();
      bone.linkTransformNode(node);
      bones.push(bone);
      nodes.push(node);
    });
    mesh.skeleton = skeleton;

    const joints: Arm['joints'] = [];
    for (let f = 0; f < 4; f++) for (let s = 0; s < 3; s++) joints.push({ node: nodes[BONE.finger(f, s)], thumb: false, index: f === 0, seg: s });
    return {
      side,
      shoulder,
      elbow,
      wrist,
      hand: nodes[BONE.hand],
      forearm: { elbow: nodes[BONE.elbow], wrist: nodes[BONE.wristFore], length: model.forearmLength },
      joints,
      thumb: { base: nodes[BONE.thumb(0)], mid: nodes[BONE.thumb(1)], tip: nodes[BONE.thumb(2)], rest: data.thumbRest.clone() },
    };
  }

  setVisible(v: boolean) {
    this.root.setEnabled(v);
  }

  dispose() {
    this.root.dispose(false, false);
    for (const m of this.mats) m.dispose();
    for (const s of this.skeletons) s.dispose();
  }

  /* ---------------- posing ---------------- */

  private refresh(node: TransformNode) {
    const chain: TransformNode[] = [];
    for (let p: TransformNode | null = node; p && p !== this.holder; p = p.parent as TransformNode | null) chain.push(p);
    for (let i = chain.length - 1; i >= 0; i--) chain[i].computeWorldMatrix(true);
  }

  private pos(node: TransformNode): Vector3 {
    return node.getWorldMatrix().getTranslation();
  }

  /** Rotate `node` by the world rotation `q` about its own pivot. */
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
  }

  /** Place `node` (a child of the arms root) at a world position with a world rotation. */
  private setWorld(node: TransformNode, pos: Vector3, rot: Quaternion) {
    Matrix.ComposeToRef(Vector3.OneReadOnly, rot, pos, tA);
    this.root.getWorldMatrix().invertToRef(tI);
    tA.multiplyToRef(tI, tB);
    tB.decompose(tS, tQ, tP);
    node.rotationQuaternion!.copyFrom(tQ);
    node.position.copyFrom(tP);
  }

  private aim(node: TransformNode, from: Vector3, to: Vector3) {
    if (from.lengthSquared() < 1e-10 || to.lengthSquared() < 1e-10) return;
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(from.normalizeToNew(), to.normalizeToNew(), q);
    this.rotateWorld(node, q);
  }

  private axis(node: TransformNode, local: Vector3): Vector3 {
    return Vector3.TransformNormal(local, node.getWorldMatrix()).normalize();
  }

  private ik(arm: Arm, target: Vector3, pole: Vector3) {
    const A = this.pos(arm.shoulder);
    const AT = target.subtract(A);
    const dist = AT.length();
    if (dist < 1e-4) return;
    const l1 = UPPER_LEN;
    const l2 = FORE_LEN;
    const d = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999);
    const u = AT.scale(1 / dist);
    const nrm = pole.subtract(A);
    nrm.subtractInPlace(u.scale(Vector3.Dot(nrm, u)));
    if (nrm.lengthSquared() < 1e-8) nrm.set(0, -1, 0);
    nrm.normalize();
    const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const E = A.add(u.scale(l1 * cosA)).addInPlace(nrm.scale(l1 * Math.sqrt(1 - cosA * cosA)));
    // upper arm: point +Z at the elbow, and roll so the elbow bends towards the pole
    this.aim(arm.shoulder, this.axis(arm.shoulder, Vector3.Forward()), E.subtract(A));
    this.refresh(arm.wrist);
    const B = this.pos(arm.elbow);
    this.aim(arm.elbow, this.axis(arm.elbow, Vector3.Forward()), A.add(u.scale(d)).subtract(B));
    this.refresh(arm.wrist);
    if (arm.hand !== arm.wrist) {
      // model: the hand bone starts each frame at the wrist, unrotated
      this.setWorld(arm.hand, this.pos(arm.wrist), Quaternion.Identity());
      this.refresh(arm.hand);
    }
  }

  /** Turn a hand so its fingers point along `fingers` and its palm faces `palm` (world). */
  private orientHand(arm: Arm, fingers: Vector3, palm: Vector3) {
    this.aim(arm.hand, this.axis(arm.hand, Vector3.Forward()), fingers);
    this.refresh(arm.hand);
    const f = this.axis(arm.hand, Vector3.Forward());
    const cur = this.axis(arm.hand, new Vector3(0, -1, 0));
    const want = palm.subtract(f.scale(Vector3.Dot(palm, f))).normalize();
    const c = cur.subtract(f.scale(Vector3.Dot(cur, f))).normalize();
    let ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(c, want))));
    if (Vector3.Dot(Vector3.Cross(c, want), f) < 0) ang = -ang;
    Quaternion.RotationAxisToRef(f, ang, tQ);
    this.rotateWorld(arm.hand, tQ.clone());
    this.refresh(arm.hand);
  }

  /**
   * Model forearm: lay it from the wrist back along the IK forearm, rolled with the hand, and
   * long enough (stretching up to 1.85×) that its open elbow end is outside the screen.
   */
  private placeForearm(arm: Arm) {
    const fa = arm.forearm;
    if (!fa) return;
    const W = this.pos(arm.hand);
    const back = this.pos(arm.elbow).subtract(W).normalize();
    const Z = back.scale(-1);
    const palm = this.axis(arm.hand, new Vector3(0, -1, 0));
    const Y = palm.subtract(Z.scale(Vector3.Dot(palm, Z))).scaleInPlace(-1);
    if (Y.lengthSquared() < 1e-6) Y.copyFrom(this.axis(arm.hand, Vector3.Up()));
    Y.normalize();
    const X = Vector3.Cross(Y, Z).normalize();
    const rot = Quaternion.RotationQuaternionFromAxis(X, Y, Z);
    const len = this.offscreenLength(W, back, fa.length, fa.length * 1.85);
    this.setWorld(fa.wrist, W, rot);
    this.setWorld(fa.elbow, W.add(back.scale(len)), rot);
  }

  /** Shortest length in [min, max] that puts the point `from + dir·len` (plus a sleeve radius) off-screen. */
  private offscreenLength(from: Vector3, dir: Vector3, min: number, max: number): number {
    const cam = this.holder.parent as Camera | null;
    if (!cam) return min;
    const view = cam.getViewMatrix();
    const tanH = Math.tan(cam.fov / 2);
    const tanV = tanH / Math.max(0.1, cam.getEngine().getAspectRatio(cam));
    const r = 0.075;
    const p = new Vector3();
    for (let i = 0; i <= 10; i++) {
      const len = min + ((max - min) * i) / 10;
      Vector3.TransformCoordinatesToRef(from.add(dir.scale(len)), view, p);
      if (p.z < 0.05 || p.y + r < -tanV * p.z || Math.abs(p.x) - r > tanH * p.z) return len;
    }
    return max;
  }

  /**
   * Bend every finger joint towards the palm. `profile` scales the bend per joint (knuckle, middle,
   * end), e.g. a big knuckle bend and small outer bends to hug the side of a handguard.
   */
  private curl(arm: Arm, amount: number, thumb: number, index: number, profile: readonly number[] = [1, 1, 1]) {
    for (const j of arm.joints) {
      const a = (j.thumb ? thumb : j.index ? index : amount) * (j.thumb ? 1 : profile[j.seg] ?? 1);
      // rest rotation for the thumb base keeps its splay; curl adds a bend about local X (towards the palm)
      if (j.thumb && j.node.name.endsWith('thumb')) {
        Quaternion.RotationYawPitchRollToRef((j.node.name.includes('-R-') ? 1 : -1) * 0.75, 0.35 + a, 0, j.node.rotationQuaternion!);
      } else Quaternion.RotationAxisToRef(Vector3.Right(), a, j.node.rotationQuaternion!);
    }
  }

  /**
   * Model thumb: swing it from its rest direction to `dir` (hand frame; X is given for a right hand
   * and mirrored for the left), then bend the two outer joints towards the fingers.
   */
  private poseThumb(arm: Arm, dir: Vector3, bend: number) {
    const th = arm.thumb;
    if (!th) return;
    const want = new Vector3(dir.x * arm.side, dir.y, dir.z).normalize();
    Quaternion.FromUnitVectorsToRef(th.rest, want, th.base.rotationQuaternion!);
    // bend axis: perpendicular to the thumb, turning it towards the index side of the palm
    const towards = new Vector3(arm.side, -0.4, 0.2);
    const ax = Vector3.Cross(th.rest, towards).normalize();
    Quaternion.RotationAxisToRef(ax, bend, th.mid.rotationQuaternion!);
    Quaternion.RotationAxisToRef(ax, bend * 1.2, th.tip.rotationQuaternion!);
  }

  /**
   * Put a hand so its palm centre sits at `palm`, fingers (before curling) along `fingers` and the
   * palm facing `facing`: IK the wrist into place, then turn the hand.
   */
  private place(arm: Arm, palm: Vector3, fingers: Vector3, facing: Vector3, pole: Vector3) {
    const f = fingers.normalizeToNew();
    this.ik(arm, palm.subtract(f.scale(this.palmOffset)), pole);
    this.orientHand(arm, f, facing);
    this.placeForearm(arm);
  }

  pose(t: ArmTargets) {
    for (const arm of [this.left, this.right]) {
      arm.shoulder.rotationQuaternion!.copyFromFloats(0, 0, 0, 1);
      arm.elbow.rotationQuaternion!.copyFromFloats(0, 0, 0, 1);
      arm.wrist.rotationQuaternion!.copyFromFloats(0, 0, 0, 1);
      arm.hand.rotationQuaternion!.copyFromFloats(0, 0, 0, 1);
    }
    (this.holder.parent as TransformNode | null)?.computeWorldMatrix(true);
    this.holder.computeWorldMatrix(true);
    this.root.computeWorldMatrix(true);
    const W = this.holder.getWorldMatrix();
    const camRight = Vector3.TransformNormal(Vector3.Right(), W).normalize();
    const camUp = Vector3.TransformNormal(Vector3.Up(), W).normalize();
    const camFwd = Vector3.TransformNormal(Vector3.Forward(), W).normalize();
    const { right: R, up: U, forward: F } = t;
    const ph = this.palmHalf;

    // right hand: palm against the right side of the grip, fingers wrapping round its front
    this.refresh(this.right.wrist);
    const sR = this.pos(this.right.shoulder);
    const poleR = sR.add(camUp.scale(-0.6)).addInPlace(camRight.scale(0.5)).addInPlace(camFwd.scale(0.1));
    const palmR = t.grip.add(R.scale(GRIP_HALF_WIDTH + ph)).addInPlace(F.scale(-0.012));
    this.place(this.right, palmR, F.add(U.scale(-0.22)).addInPlace(R.scale(-0.08)), R.scale(-1), poleR);
    this.curl(this.right, 1.05, 0.25, 0.45);
    this.poseThumb(this.right, new Vector3(0.05, -0.75, 0.66), 0.35);

    // left hand: handguard resting in the palm (rifles), or cupping the right hand (pistols)
    this.refresh(this.left.wrist);
    const sL = this.pos(this.left.shoulder);
    const poleL = sL.add(camUp.scale(-0.7)).addInPlace(camRight.scale(-0.35));
    if (t.support) {
      // `support` is the handguard's underside centre: the palm rests against it, a little to the left so
      // the fingers reach across and wrap up the right side while the thumb lies along the left side
      // knuckles end up at the handguard's right edge: the fingers then rise up its side and tip over the top
      const palmL = t.support.add(U.scale(-ph)).addInPlace(R.scale(-this.supportShift)).addInPlace(F.scale(-0.01));
      this.place(this.left, palmL, R.scale(0.8).addInPlace(F.scale(0.45)).addInPlace(U.scale(0.08)), U.add(R.scale(-0.1)), poleL);
      this.curl(this.left, 1, 0.35, 0.95, SUPPORT_CURL);
      this.poseThumb(this.left, new Vector3(-0.85, -0.12, 0.5), 0.12);
    } else {
      const palmL = t.grip.add(R.scale(-(0.019 + ph))).addInPlace(U.scale(-0.035)).addInPlace(F.scale(0.008));
      this.place(this.left, palmL, F.scale(0.65).addInPlace(R.scale(0.6)).addInPlace(U.scale(-0.2)), R.scale(0.75).addInPlace(U.scale(0.65)), poleL);
      this.curl(this.left, 0.95, 0.3, 0.95);
      this.poseThumb(this.left, new Vector3(-0.35, -0.45, 0.82), 0.2);
    }
  }
}
