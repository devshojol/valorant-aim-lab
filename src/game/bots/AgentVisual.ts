/**
 * Rigged agent model for bots (public/models/sage.glb), posed procedurally.
 *
 * The model ships without animations, so each frame we start from the rest pose and:
 *  - drop the pelvis for crouching and bob it while walking,
 *  - bend / twist the spine and tilt the head to follow the bot's aim pitch,
 *  - place a rifle in front of the right shoulder and solve two-bone IK so both hands hold it,
 *  - solve two-bone IK for the legs so the feet stay planted (crouch) or step (walk cycle).
 * Death reuses the dummy's "tip over" on the whole body.
 *
 * All posing is done on the glTF TransformNodes (which drive the skeleton's bones), in world
 * space, with full matrices so the loader's handedness flip (a mirrored root) can't invert
 * rotations. Posing runs once per rendered frame, not per simulation step.
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import {
  Color3,
  CreateBox,
  CreateDisc,
  CreatePlane,
  Matrix,
  Mesh,
  Quaternion,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type Scene,
} from '../rendering/babylon';
import { loadContainer } from '../rendering/gltf';
import type { PlacedSkin, WeaponSkin } from '../weapons/WeaponSkins';
import type { BotAssets, BotView } from './BotVisual';
import { BOT_SCALE } from './perception/visibility';

const ENEMY_RED = Color3.FromHexString('#ff3b4e');
/** Eye height of a standing bot, matching the head hitbox (legs 0.86 + head centre 0.75, × BOT_SCALE). */
const EYE_HEIGHT = 1.63 * BOT_SCALE;
/** Pelvis drop at full crouch — the hitboxes drop 0.55 m × BOT_SCALE, so the head stays inside its box. */
const CROUCH_DROP = 0.55 * BOT_SCALE;
/** Body-sized offsets below are for a 1.8 m person; bots are BOT_SCALE larger. */
const S = BOT_SCALE;
/** Length of the bots' rifle when a weapon skin is used (shorter than first person so both hands reach). */
const BOT_RIFLE_LENGTH = 0.8;

/** glTF node names in the agent rig. */
const N = {
  pelvis: 'Splitter_3',
  spine2: 'Spine2_5',
  spine3: 'Spine3_6',
  spine4: 'Spine4_7',
  neck: 'Neck_8',
  head: 'Head_10',
  eyeL: 'L_Eyeball_35',
  eyeR: 'R_Eyeball_36',
  shoulderL: 'L_Shoulder_135',
  elbowL: 'L_Elbow_136',
  handL: 'L_Hand_137',
  fingerL: 'L_Middle1_142',
  shoulderR: 'R_Shoulder_170',
  elbowR: 'R_Elbow_171',
  handR: 'R_Hand_172',
  fingerR: 'R_Middle1_180',
  hipL: 'L_Hip_214',
  kneeL: 'L_Knee_215',
  footL: 'L_Foot_217',
  hipR: 'R_Hip_225',
  kneeR: 'R_Knee_226',
  footR: 'R_Foot_228',
} as const;
type NodeKey = keyof typeof N;

// scratch objects (posing is single-threaded)
const tmpA = new Matrix();
const tmpB = new Matrix();
const tmpRot = new Matrix();
const tmpInv = new Matrix();
const tmpT = new Matrix();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();
const vA = new Vector3();
const vB = new Vector3();
const vC = new Vector3();
const vD = new Vector3();
const vE = new Vector3();
const vU = new Vector3();
const vN = new Vector3();

/** Per-session agent template: the loaded model plus measurements of its rest pose. */
export class AgentAssets {
  private constructor(
    readonly scene: Scene,
    private readonly container: AssetContainer,
    readonly bot: BotAssets,
    /** Model scale so the eyes sit at EYE_HEIGHT. */
    readonly scale: number,
    /** Yaw that turns the model to face +Z. */
    readonly yawFix: number,
  ) {}

  /** Weapon skin the bots carry (null = blocky rifle). */
  rifle: WeaponSkin | null = null;

  static async load(scene: Scene, url: string, bot: BotAssets): Promise<AgentAssets> {
    const container = await loadContainer(scene, url);
    // Measure the rest pose on a throw-away instance.
    const probe = container.instantiateModelsToScene((n) => n, false, {
      doNotInstantiate: true,
    });
    const holder = new TransformNode('agent-probe', scene);
    for (const r of probe.rootNodes) r.parent = holder;
    const nodes = findNodes(holder);
    holder.computeWorldMatrix(true);
    for (const n of holder.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
    const eye = nodes.eyeL.getAbsolutePosition().add(nodes.eyeR.getAbsolutePosition()).scale(0.5);
    const head = nodes.head.getAbsolutePosition();
    const fwd = eye.subtract(head);
    const yawFix = -Math.atan2(fwd.x, fwd.z);
    let minY = Infinity;
    for (const m of holder.getChildMeshes(false)) {
      m.refreshBoundingInfo({});
      minY = Math.min(minY, m.getBoundingInfo().boundingBox.minimumWorld.y);
    }
    if (!Number.isFinite(minY)) minY = 0;
    const scale = EYE_HEIGHT / Math.max(0.5, eye.y - minY);
    for (const r of probe.rootNodes) r.dispose(false, false); // materials are shared with the template
    for (const s of probe.skeletons) s.dispose();
    holder.dispose();
    return new AgentAssets(scene, container, bot, scale, yawFix);
  }

  create(id: number, outline: boolean): AgentVisual {
    const entries = this.container.instantiateModelsToScene((n) => n, false, {
      doNotInstantiate: true,
    });
    return new AgentVisual(this, id, outline, entries.rootNodes as TransformNode[], entries.skeletons);
  }

  dispose() {
    this.container.dispose();
  }
}

function findNodes(root: TransformNode): Record<NodeKey, TransformNode> {
  const byName = new Map<string, TransformNode>();
  for (const n of root.getDescendants(false)) if (n instanceof TransformNode) byName.set(n.name, n);
  const out = {} as Record<NodeKey, TransformNode>;
  for (const [key, name] of Object.entries(N) as [NodeKey, string][]) {
    const n = byName.get(name);
    if (!n) throw new Error(`agent model: missing rig node ${name}`);
    n.rotationQuaternion ??= Quaternion.FromEulerVector(n.rotation);
    out[key] = n;
  }
  return out;
}

/** Ancestors of `node` below (and including) `stop`'s child, top-down, plus the node itself. */
function chainBelow(node: TransformNode, stop: TransformNode): TransformNode[] {
  const out: TransformNode[] = [];
  let n: TransformNode | null = node;
  while (n && n !== stop) {
    out.push(n);
    n = n.parent as TransformNode | null;
  }
  return out.reverse();
}

class AgentVisual implements BotView {
  private readonly root: TransformNode;
  private readonly model: TransformNode;
  private readonly nodes: Record<NodeKey, TransformNode>;
  private readonly meshes: AbstractMesh[];
  private readonly gun: TransformNode;
  private readonly muzzle: TransformNode;
  private readonly flash: Mesh;
  private readonly shadow: Mesh;
  private readonly rest = new Map<TransformNode, { p: Vector3; q: Quaternion }>();
  /** Nodes above the pelvis: recomputed with Babylon once per pose. */
  private readonly upperChain: TransformNode[];
  /**
   * Mini rig: the pelvis and everything below it, with our own world matrices. Babylon's
   * computeWorldMatrix is far too heavy to call ~200 times per bot per frame while solving.
   */
  private readonly rig: TransformNode[];
  private readonly rigIndex = new Map<TransformNode, number>();
  private readonly rigParent: Int16Array;
  private readonly rigLocal: Matrix[];
  private readonly rigWorld: Matrix[];
  private readonly rigChain = new Map<TransformNode, number[]>();
  /** World matrix of the pelvis' parent (from Babylon). */
  private readonly baseWorld = new Matrix();
  private readonly observer: Observer<Scene>;
  private readonly armLen: { l: [number, number]; r: [number, number] };
  private readonly legLen: { l: [number, number]; r: [number, number] };

  // latest simulation state (posing reads it once per frame)
  private x = 0;
  private y = 0;
  private z = 0;
  private yaw = 0;
  private aimPitch = 0;
  private crouch = 0;
  private moveX = 0;
  private moveZ = 0;
  private walkPhase = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private flashTime = 0;
  private hitFlash = 0;
  private deathT = -1;
  private visible = true;
  /** Inputs of the last full pose — the IK only re-runs when they change. */
  private poseKey = '';
  private frameNo = 0;
  private readonly body: AbstractMesh;
  private rifleSkin: PlacedSkin | null = null;
  /** Support-hand point on the rifle, relative to the grip (metres along / above the barrel). */
  private handguardFwd = 0.27;
  private handguardUp = -0.035;

  constructor(
    private readonly assets: AgentAssets,
    id: number,
    outline: boolean,
    rootNodes: TransformNode[],
    private readonly skeletons: Skeleton[],
  ) {
    const scene = assets.scene;
    this.root = new TransformNode(`agent-${id}`, scene);
    this.model = new TransformNode(`agent-${id}-model`, scene);
    this.model.parent = this.root;
    this.model.scaling.setAll(assets.scale);
    this.model.rotation.y = assets.yawFix;
    for (const r of rootNodes) r.parent = this.model;
    this.nodes = findNodes(this.model);

    this.meshes = this.model.getChildMeshes(false);
    this.body = this.meshes.reduce((a, b) => (b.getTotalVertices() > a.getTotalVertices() ? b : a));
    for (const m of this.meshes) {
      m.isPickable = false;
      m.receiveShadows = true;
      const eyes = m.material?.name?.includes('Eye');
      if (outline && !eyes) {
        m.renderOutline = true;
        m.outlineColor = ENEMY_RED;
        m.outlineWidth = 0.012;
      }
      m.overlayColor = new Color3(1, 1, 1);
      m.overlayAlpha = 0.55;
    }

    for (const key of Object.keys(N) as NodeKey[]) {
      const n = this.nodes[key];
      this.rest.set(n, {
        p: n.position.clone(),
        q: n.rotationQuaternion!.clone(),
      });
    }
    this.upperChain = chainBelow(this.nodes.pelvis.parent as TransformNode, this.root);
    this.upperChain.unshift(this.root);
    // mini rig (pre-order, so parents always come before children)
    const pelvis = this.nodes.pelvis;
    this.rig = [pelvis, ...pelvis.getDescendants(false).filter((d): d is TransformNode => d instanceof TransformNode && !(d instanceof Mesh))];
    this.rig.forEach((r, i) => {
      r.rotationQuaternion ??= Quaternion.FromEulerVector(r.rotation);
      this.rigIndex.set(r, i);
    });
    this.rigParent = new Int16Array(this.rig.map((r) => (r === pelvis ? -1 : (this.rigIndex.get(r.parent as TransformNode) ?? -1))));
    this.rigLocal = this.rig.map(() => new Matrix());
    this.rigWorld = this.rig.map(() => new Matrix());
    for (const key of Object.keys(N) as NodeKey[]) {
      const i = this.rigIndex.get(this.nodes[key]);
      if (i === undefined) continue;
      const chain: number[] = [];
      for (let k = i; k >= 0; k = this.rigParent[k]) chain.push(k);
      this.rigChain.set(this.nodes[key], chain.reverse());
    }

    // rifle (world-space; placed every frame in front of the right shoulder)
    const a = assets.bot;
    this.gun = new TransformNode(`agent-${id}-gun`, scene);
    this.gun.rotationQuaternion = new Quaternion();
    this.muzzle = new TransformNode(`agent-${id}-muzzle`, scene);
    this.muzzle.parent = this.gun;
    if (assets.rifle) {
      // weapon skin: grip at the gun origin, barrel along +Z
      this.rifleSkin = assets.rifle.place(this.gun, BOT_RIFLE_LENGTH, Vector3.Zero());
      for (const m of this.rifleSkin.meshes) {
        m.isPickable = false;
        if (outline) {
          m.renderOutline = true;
          m.outlineColor = ENEMY_RED;
          m.outlineWidth = 0.01;
        }
        m.overlayColor = new Color3(1, 1, 1);
        m.overlayAlpha = 0.55;
        this.meshes.push(m);
      }
      this.muzzle.position.copyFrom(this.rifleSkin.muzzle);
      const hg = this.rifleSkin.handguard;
      if (hg) {
        this.handguardFwd = hg.z;
        this.handguardUp = hg.y - 0.03;
      }
    }
    const box = (w: number, h: number, d: number, px: number, py: number, pz: number, dark = false) => {
      const m = CreateBox(`agent-${id}-gun-p`, { width: w, height: h, depth: d }, scene);
      m.parent = this.gun;
      m.position.set(px, py, pz);
      m.material = dark ? a.darkMat : a.gunMat;
      m.isPickable = false;
      if (outline) {
        m.renderOutline = true;
        m.outlineColor = ENEMY_RED;
        m.outlineWidth = 0.008;
      }
      this.meshes.push(m);
    };
    if (!this.rifleSkin) {
      box(0.06, 0.09, 0.56, 0, 0.02, 0.1); // receiver + handguard
      box(0.035, 0.035, 0.24, 0, 0.035, 0.48, true); // barrel
      box(0.05, 0.11, 0.2, 0, 0.0, -0.24, true); // stock
      box(0.04, 0.12, 0.06, 0, -0.07, 0.08); // magazine
      box(0.035, 0.08, 0.04, 0, -0.06, -0.04, true); // grip
      this.muzzle.position.set(0, 0.035, 0.62);
    }
    this.flash = CreatePlane(`agent-${id}-flash`, { size: 0.45 }, scene);
    this.flash.parent = this.muzzle;
    this.flash.material = a.flashMat;
    this.flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.flash.isPickable = false;
    this.flash.setEnabled(false);

    this.shadow = CreateDisc(`agent-${id}-blob`, { radius: 0.42, tessellation: 18 }, scene);
    this.shadow.rotation.x = Math.PI / 2;
    this.shadow.material = a.shadowMat;
    this.shadow.isPickable = false;

    // limb lengths from the rest pose (world units after scaling)
    this.refreshUpper();
    const len = (p: TransformNode, c: TransformNode) => {
      this.refresh(c);
      return Vector3.Distance(this.pos(p, new Vector3()), this.pos(c, new Vector3()));
    };
    const n = this.nodes;
    this.armLen = {
      l: [len(n.shoulderL, n.elbowL), len(n.elbowL, n.handL)],
      r: [len(n.shoulderR, n.elbowR), len(n.elbowR, n.handR)],
    };
    this.legLen = {
      l: [len(n.hipL, n.kneeL), len(n.kneeL, n.footL)],
      r: [len(n.hipR, n.kneeR), len(n.kneeR, n.footR)],
    };

    this.observer = scene.onBeforeRenderObservable.add(() => this.pose());
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.root.setEnabled(v);
    this.gun.setEnabled(v);
    this.shadow.setEnabled(v);
  }

  muzzleFlash() {
    this.flashTime = 0.05;
  }

  hit() {
    this.hitFlash = 0.09;
  }

  die() {
    this.deathT = 0;
  }

  revive() {
    this.deathT = -1;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.lastX = NaN;
    this.poseKey = '';
  }

  update(dt: number, x: number, y: number, z: number, yaw: number, aimPitch: number, crouch: number, speed: number, groundY: number) {
    // velocity from position deltas (bots strafe, so the walk cycle needs a direction)
    if (Number.isFinite(this.lastX) && dt > 0) {
      const vx = (x - this.lastX) / dt;
      const vz = (z - this.lastZ) / dt;
      const k = Math.min(1, dt * 12);
      this.moveX += (vx - this.moveX) * k;
      this.moveZ += (vz - this.moveZ) * k;
    }
    this.lastX = x;
    this.lastZ = z;
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.aimPitch = aimPitch;
    this.crouch = crouch;
    const moving = Math.min(1, Math.hypot(this.moveX, this.moveZ) / 5.4);
    this.walkPhase += dt * (4 + speed * 1.6) * (moving > 0.05 ? 1 : 0);
    if (this.deathT >= 0) this.deathT += dt;
    if (this.flashTime > 0) this.flashTime -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.shadow.position.set(x, groundY + 0.015, z);
  }

  muzzleWorld(): [number, number, number] {
    this.gun.computeWorldMatrix(true);
    const p = this.muzzle.getAbsolutePosition();
    return [p.x, p.y, p.z];
  }

  dispose() {
    this.assets.scene.onBeforeRenderObservable.remove(this.observer);
    this.flash.dispose();
    this.shadow.dispose();
    this.rifleSkin?.dispose();
    this.gun.dispose(false, false);
    for (const s of this.skeletons) s.dispose();
    this.root.dispose(false, false);
  }

  /* ------------------------------------------------------------------ */
  /* Posing                                                              */
  /* ------------------------------------------------------------------ */

  private refreshUpper() {
    for (const n of this.upperChain) n.computeWorldMatrix(true);
    this.baseWorld.copyFrom(this.upperChain[this.upperChain.length - 1].getWorldMatrix());
  }

  private rigWorldOf(node: TransformNode): Matrix {
    return this.rigWorld[this.rigIndex.get(node)!];
  }

  private rigParentWorldOf(node: TransformNode): Matrix {
    const p = this.rigParent[this.rigIndex.get(node)!];
    return p < 0 ? this.baseWorld : this.rigWorld[p];
  }

  /** Recompute world matrices from the pelvis down to `node`. */
  private refresh(node: TransformNode) {
    for (const i of this.rigChain.get(node)!) {
      const r = this.rig[i];
      Matrix.ComposeToRef(r.scaling, r.rotationQuaternion!, r.position, this.rigLocal[i]);
      const p = this.rigParent[i];
      this.rigLocal[i].multiplyToRef(p < 0 ? this.baseWorld : this.rigWorld[p], this.rigWorld[i]);
    }
  }

  private pos(node: TransformNode, out: Vector3): Vector3 {
    this.rigWorldOf(node).getTranslationToRef(out);
    return out;
  }

  /** Rotate `node` by the world-space rotation `q` about its own pivot. */
  private rotateWorld(node: TransformNode, q: Quaternion) {
    const W = this.rigWorldOf(node);
    W.getTranslationToRef(tmpP);
    Matrix.TranslationToRef(-tmpP.x, -tmpP.y, -tmpP.z, tmpT);
    W.multiplyToRef(tmpT, tmpA);
    Matrix.FromQuaternionToRef(q, tmpRot);
    tmpA.multiplyToRef(tmpRot, tmpB);
    Matrix.TranslationToRef(tmpP.x, tmpP.y, tmpP.z, tmpT);
    tmpB.multiplyToRef(tmpT, tmpA); // new world matrix
    this.rigParentWorldOf(node).invertToRef(tmpInv);
    tmpA.multiplyToRef(tmpInv, tmpB); // new local matrix
    tmpB.decompose(tmpS, tmpQ, tmpP);
    node.rotationQuaternion!.copyFrom(tmpQ);
    node.position.copyFrom(tmpP);
  }

  /** Rotate `node` about a world axis. */
  private rotateAxis(node: TransformNode, axis: Vector3, angle: number) {
    if (Math.abs(angle) < 1e-5) return;
    Quaternion.RotationAxisToRef(axis.clone(), angle, tmpQ);
    this.rotateWorld(node, tmpQ.clone());
  }

  /** Rotate `node` so the world direction `from` turns into `to`. */
  private aim(node: TransformNode, from: Vector3, to: Vector3) {
    const lf = from.length();
    const lt = to.length();
    if (lf < 1e-6 || lt < 1e-6) return;
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(from.scale(1 / lf), to.scale(1 / lt), q);
    this.rotateWorld(node, q);
  }

  /** Move `node` by a world-space offset. */
  private translateWorld(node: TransformNode, delta: Vector3) {
    this.rigParentWorldOf(node).invertToRef(tmpInv);
    Vector3.TransformNormalToRef(delta, tmpInv, tmpP);
    node.position.addInPlace(tmpP);
  }

  /** Two-bone IK: bend upper/lower so `end` reaches `target`, elbow/knee towards `pole`. */
  private ik(upper: TransformNode, lower: TransformNode, end: TransformNode, lens: [number, number], target: Vector3, pole: Vector3) {
    const [l1, l2] = lens;
    this.refresh(end);
    const A = this.pos(upper, vA);
    const AT = target.subtract(A);
    const dist = AT.length();
    if (dist < 1e-4) return;
    const d = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999);
    AT.scaleToRef(1 / dist, vU);
    pole.subtractToRef(A, vN);
    vN.subtractInPlace(vU.scale(Vector3.Dot(vN, vU)));
    if (vN.lengthSquared() < 1e-8) vN.set(0, -1, 0);
    vN.normalize();
    const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const E = A.add(vU.scale(l1 * cosA)).addInPlace(vN.scale(l1 * sinA));
    const B = this.pos(lower, vB);
    this.aim(upper, B.subtract(A), E.subtract(A));
    this.refresh(end);
    const B2 = this.pos(lower, vB);
    const C2 = this.pos(end, vC);
    const T2 = A.add(vU.scale(d));
    this.aim(lower, C2.subtract(B2), T2.subtract(B2));
    this.refresh(end);
  }

  private pose() {
    if (!this.visible) return;

    // flash / hit overlay
    if (this.flashTime > 0) {
      this.flash.setEnabled(true);
      this.flash.rotation.z = Math.random() * 6.28;
      const s = 0.8 + Math.random() * 0.5;
      this.flash.scaling.set(s, s, s);
    } else this.flash.setEnabled(false);
    const flashOn = this.hitFlash > 0;
    for (const m of this.meshes) m.renderOverlay = flashOn;

    // root: position, facing, death tilt
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.yaw;
    if (this.deathT >= 0) {
      const t = Math.min(1, this.deathT / 0.35);
      this.root.rotation.x = -t * 1.35;
      this.root.position.y = this.y - t * 0.15;
    }

    // The pose is relative to the root, so it only needs solving again when its inputs change.
    // Off-screen bots keep their last pose; far ones re-pose at a third of the frame rate.
    const cam = this.assets.scene.activeCamera;
    if (cam && !cam.isInFrustum(this.body)) return;
    const moving0 = Math.min(1, Math.hypot(this.moveX, this.moveZ) / 5.4);
    const localMove = Math.atan2(this.moveX, this.moveZ) - this.yaw;
    const key =
      this.deathT >= 0
        ? `dead${Math.min(1, this.deathT / 0.35).toFixed(2)}`
        : `${this.crouch.toFixed(2)}|${this.aimPitch.toFixed(3)}|${moving0 > 0.05 ? `${this.walkPhase.toFixed(2)}|${moving0.toFixed(2)}|${localMove.toFixed(2)}` : 'idle'}`;
    if (key === this.poseKey) return;
    this.frameNo++;
    if (this.poseKey && cam && this.frameNo % 3 !== 0 && Vector3.DistanceSquared(cam.globalPosition, this.root.position) > 30 * 30) return;
    this.poseKey = key;

    // back to the rest pose
    for (const [n, r] of this.rest) {
      n.position.copyFrom(r.p);
      n.rotationQuaternion!.copyFrom(r.q);
    }
    this.refreshUpper();
    const n = this.nodes;

    // bot frame in world space
    const up = Vector3.Up();
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fwd = new Vector3(sinY, 0, cosY);
    const right = new Vector3(cosY, 0, -sinY);
    if (this.deathT >= 0) {
      // dead: keep the rest pose with the gun lowered, tipped over with the root
      this.refresh(n.shoulderR);
      this.placeGun(this.pos(n.shoulderR, new Vector3()), fwd, right, up, -0.9);
      return;
    }

    const moving = Math.min(1, Math.hypot(this.moveX, this.moveZ) / 5.4);
    const c = this.crouch;
    const ph = this.walkPhase;

    // feet rest positions (before the pelvis moves)
    this.refresh(n.footL);
    this.refresh(n.footR);
    const footL = this.pos(n.footL, new Vector3());
    const footR = this.pos(n.footR, new Vector3());

    // pelvis: crouch drop + walk bob + slight forward shift when crouched
    const drop = CROUCH_DROP * c + Math.abs(Math.sin(ph)) * 0.035 * S * moving;
    this.refresh(n.pelvis);
    this.translateWorld(n.pelvis, up.scale(-drop).addInPlace(fwd.scale(-0.08 * S * c)));
    this.refresh(n.pelvis);

    // spine: lean forward when crouched, blade the rifle (turn right), follow aim pitch
    const pitch = Math.max(-1.2, Math.min(1.2, this.aimPitch));
    this.refresh(n.spine2);
    this.rotateAxis(n.spine2, right, 0.32 * c);
    this.refresh(n.spine3);
    this.rotateAxis(n.spine3, up, 0.22);
    this.rotateAxis(n.spine3, right, -pitch * 0.3);
    this.refresh(n.spine4);
    this.rotateAxis(n.spine4, right, -pitch * 0.3);
    this.refresh(n.neck);
    this.rotateAxis(n.neck, up, -0.22);
    this.rotateAxis(n.neck, right, -0.28 * c);
    this.refresh(n.head);
    this.rotateAxis(n.head, right, -pitch * 0.4);

    // rifle in front of the right shoulder, pitched with the aim
    this.refresh(n.shoulderR);
    this.refresh(n.shoulderL);
    const shR = this.pos(n.shoulderR, new Vector3());
    const grip = this.placeGun(shR, fwd, right, up, pitch);
    const gunDir = this.gunDir;
    const gunUp = this.gunUp;

    // arms
    const handguard = grip.add(gunDir.scale(this.handguardFwd)).addInPlace(gunUp.scale(this.handguardUp));
    const poleR = shR.add(up.scale(-0.6)).addInPlace(right.scale(0.45)).addInPlace(fwd.scale(-0.15));
    this.ik(n.shoulderR, n.elbowR, n.handR, this.armLen.r, grip.add(gunUp.scale(-0.02)), poleR);
    this.refresh(n.fingerR);
    this.aim(n.handR, this.pos(n.fingerR, vD).subtract(this.pos(n.handR, vE)), gunDir);
    const shL = this.pos(n.shoulderL, new Vector3());
    const poleL = shL.add(up.scale(-0.7)).addInPlace(right.scale(-0.25));
    this.ik(n.shoulderL, n.elbowL, n.handL, this.armLen.l, handguard, poleL);
    this.refresh(n.fingerL);
    this.aim(n.handL, this.pos(n.fingerL, vD).subtract(this.pos(n.handL, vE)), gunDir);

    // legs: planted feet, stepping along the movement direction when walking
    const mlen = Math.hypot(this.moveX, this.moveZ);
    const mdir = mlen > 0.01 ? new Vector3(this.moveX / mlen, 0, this.moveZ / mlen) : fwd;
    const stride = 0.22 * S * moving;
    const lift = 0.09 * S * moving;
    const s = Math.sin(ph);
    const cph = Math.cos(ph);
    const spread = right.scale(0.05 * S * c);
    const tL = footL
      .add(mdir.scale(stride * s))
      .addInPlace(up.scale(Math.max(0, cph) * lift))
      .subtractInPlace(spread);
    const tR = footR
      .add(mdir.scale(-stride * s))
      .addInPlace(up.scale(Math.max(0, -cph) * lift))
      .addInPlace(spread);
    for (const [hip, knee, foot, target, lens] of [
      [n.hipL, n.kneeL, n.footL, tL, this.legLen.l],
      [n.hipR, n.kneeR, n.footR, tR, this.legLen.r],
    ] as const) {
      this.refresh(knee);
      const pole = this.pos(knee, new Vector3()).addInPlace(fwd.scale(0.8)).addInPlace(up.scale(0.2));
      this.refresh(foot);
      this.ik(hip, knee, foot, lens as [number, number], target, pole);
    }
  }

  private gunDir = new Vector3(0, 0, 1);
  private gunUp = new Vector3(0, 1, 0);

  /** Place the rifle from the right shoulder; returns the grip point. */
  private placeGun(shoulderR: Vector3, fwd: Vector3, right: Vector3, up: Vector3, pitch: number): Vector3 {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const f = fwd.scale(cp).addInPlace(up.scale(sp));
    const u = up.scale(cp).subtractInPlace(fwd.scale(sp));
    this.gunDir.copyFrom(f);
    this.gunUp.copyFrom(u);
    const grip = shoulderR.add(f.scale(0.2 * S)).addInPlace(u.scale(-0.13 * S)).addInPlace(right.scale(-0.06 * S));
    this.gun.position.copyFrom(grip);
    // gun local axes: +X right, +Y up, +Z along the barrel
    Quaternion.RotationQuaternionFromAxisToRef(Vector3.Cross(u, f), u, f, this.gun.rotationQuaternion!);
    return grip;
  }
}
