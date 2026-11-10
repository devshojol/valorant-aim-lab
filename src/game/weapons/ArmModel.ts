/**
 * The optional first-person arm model (public/models/fp-arms.glb, "First-Person Arm & Hand -
 * Fingerless Gloves" by Exactly, CC BY 4.0 — see public/models/README.md).
 *
 * The file is a static, unrigged mesh: a left and a right forearm with open hands, fingers up.
 * At load time each arm is cut out, turned into the arm frame the posing code uses (fingers along
 * +Z, palm facing −Y, wrist at the origin, metres) and given a skeleton built here: two forearm
 * bones (elbow end and wrist end, so the forearm can stretch), the hand, three bones per finger and
 * three for the thumb. Skin weights come from each vertex's distance to the bone segments.
 *
 * The joint positions below were measured on this particular file (scratch analysis of its
 * vertices). A different file won't match, so the vertex count is checked and loading fails —
 * the game then uses the built-in arms.
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Material } from '@babylonjs/core/Materials/material';
import { Vector3, VertexBuffer, type AbstractMesh, type Scene } from '../rendering/babylon';
import { loadContainer } from '../rendering/gltf';
import { BONE, type ArmBoneDef } from './armBones';

export const ARM_MODEL_URL = 'models/fp-arms.glb';
const EXPECTED_VERTICES = 9198;

/** Model units → metres (wrist to middle fingertip ≈ 0.21 m). */
const SCALE = 0.42;
/** Forearm → hand skin blend runs from this far behind the wrist to this far into the hand (metres). */
const WRIST_BLEND = [-0.05, 0.025] as const;

/**
 * Joints of the RIGHT arm in the model's arm frame, before centring and scaling
 * (X = −z, Y = −x, Z = y of the loaded model; the left arm is the mirror image, X → −X).
 */
const RAW = {
  wrist: [0.33, 0.02, 0] as const,
  elbowZ: -0.5,
  /** index, middle, ring, little: knuckle, middle joint, end joint, tip. */
  fingers: [
    [[0.252, 0.02, 0.29], [0.25, 0.024, 0.37], [0.242, 0.022, 0.425], [0.242, 0.021, 0.471]],
    [[0.319, 0.026, 0.3], [0.316, 0.026, 0.385], [0.315, 0.031, 0.445], [0.315, 0.032, 0.5]],
    [[0.373, 0.02, 0.29], [0.381, 0.025, 0.37], [0.39, 0.022, 0.425], [0.39, 0.022, 0.469]],
    [[0.432, 0.01, 0.27], [0.442, 0.007, 0.33], [0.446, 0.006, 0.37], [0.446, 0.007, 0.405]],
  ] as const,
  /** base (CMC), knuckle (MCP), joint (IP), tip. */
  thumb: [[0.24, -0.02, 0.06], [0.198, -0.05, 0.165], [0.175, -0.095, 0.232], [0.13, -0.15, 0.283]] as const,
};


export interface ArmSideData {
  positions: Float32Array;
  normals: Float32Array;
  tangents: Float32Array | null;
  uvs: Float32Array;
  indices: Uint32Array;
  matricesIndices: Float32Array;
  matricesWeights: Float32Array;
  bones: ArmBoneDef[];
  /** Rest direction of the thumb (base → tip) in the hand frame. */
  thumbRest: Vector3;
}

export interface ArmModel {
  container: AssetContainer;
  material: Material;
  right: ArmSideData;
  left: ArmSideData;
  /** Wrist → elbow end of the forearm at rest (metres). */
  forearmLength: number;
  /** Wrist → palm centre along the fingers, and palm centre → palm surface (metres). */
  palmOffset: number;
  palmHalf: number;
  /** Palm centre → knuckle line along the fingers (metres). */
  knuckleReach: number;
}

/** Joint position of the given arm in the centred, scaled arm frame (side 1 = right, −1 = left). */
function joint(p: readonly number[], side: 1 | -1): Vector3 {
  return new Vector3(side * (p[0] - RAW.wrist[0]) * SCALE, (p[1] - RAW.wrist[1]) * SCALE, (p[2] - RAW.wrist[2]) * SCALE);
}

function boneDefs(side: 1 | -1): ArmBoneDef[] {
  const defs: ArmBoneDef[] = [
    { name: 'elbow', parent: -1, local: new Vector3(0, 0, RAW.elbowZ * SCALE) },
    { name: 'wrist-fore', parent: -1, local: Vector3.Zero() },
    { name: 'hand', parent: -1, local: Vector3.Zero() },
  ];
  RAW.fingers.forEach((f, fi) => {
    for (let s = 0; s < 3; s++) {
      const a = joint(f[s], side);
      const local = s === 0 ? a : a.subtract(joint(f[s - 1], side));
      defs.push({ name: `f${fi}-${s}`, parent: s === 0 ? BONE.hand : BONE.finger(fi, s - 1), local });
    }
  });
  for (let s = 0; s < 3; s++) {
    const a = joint(RAW.thumb[s], side);
    defs.push({ name: `thumb-${s}`, parent: s === 0 ? BONE.hand : BONE.thumb(s - 1), local: s === 0 ? a : a.subtract(joint(RAW.thumb[s - 1], side)) });
  }
  return defs;
}

/** Segments (bone, from, to) used to weight the skin. Bone −1 = the forearm (split later). */
function segments(side: 1 | -1): [number, Vector3, Vector3][] {
  const w = Vector3.Zero();
  const segs: [number, Vector3, Vector3][] = [[-1, new Vector3(0, 0, RAW.elbowZ * SCALE), w]];
  RAW.fingers.forEach((f, fi) => {
    segs.push([BONE.hand, w, joint(f[0], side)]);
    for (let s = 0; s < 3; s++) segs.push([BONE.finger(fi, s), joint(f[s], side), joint(f[s + 1], side)]);
  });
  segs.push([BONE.hand, w, joint(RAW.thumb[0], side)]);
  for (let s = 0; s < 3; s++) segs.push([BONE.thumb(s), joint(RAW.thumb[s], side), joint(RAW.thumb[s + 1], side)]);
  return segs;
}

function segDist(p: Vector3, a: Vector3, b: Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a.x + abx * t), dy = p.y - (a.y + aby * t), dz = p.z - (a.z + abz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Skin weights: the two nearest bones by segment distance (sharp falloff), forearm split by length. */
function weigh(pos: Float32Array, side: 1 | -1): { idx: Float32Array; wts: Float32Array } {
  const n = pos.length / 3;
  const idx = new Float32Array(n * 4);
  const wts = new Float32Array(n * 4);
  const segs = segments(side);
  const elbowZ = RAW.elbowZ * SCALE;
  const p = new Vector3();
  const best = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    best.clear();
    for (const [bone, a, b] of segs) {
      const d = segDist(p, a, b);
      const cur = best.get(bone);
      if (cur === undefined || d < cur) best.set(bone, d);
    }
    const ranked = [...best.entries()].sort((x, y) => x[1] - y[1]).slice(0, 2);
    let ws = ranked.map(([, d]) => 1 / Math.pow(d + 0.002, 8));
    const sum = ws.reduce((s, x) => s + x, 0);
    ws = ws.map((x) => x / sum);
    // wrist: blend forearm → hand smoothly over a few centimetres (a sharp switch pinches when the wrist bends)
    if (ranked.length === 2 && ranked.every(([bone]) => bone === -1 || bone === BONE.hand) && ranked[0][0] !== ranked[1][0]) {
      const x = Math.max(0, Math.min(1, (p.z - WRIST_BLEND[0]) / (WRIST_BLEND[1] - WRIST_BLEND[0])));
      const hand = x * x * (3 - 2 * x);
      ws = ranked.map(([bone]) => (bone === BONE.hand ? hand : 1 - hand));
    }
    const out: [number, number][] = [];
    ranked.forEach(([bone, ], i) => {
      if (ws[i] < 0.04) return;
      if (bone === -1) {
        // forearm: blend the elbow-end and wrist-end bones by position along the forearm, so moving them apart stretches it evenly
        const t = Math.max(0, Math.min(1, (p.z - elbowZ) / -elbowZ));
        out.push([BONE.elbow, ws[i] * (1 - t)], [BONE.wristFore, ws[i] * t]);
      } else out.push([bone, ws[i]]);
    });
    const total = out.reduce((s, [, w]) => s + w, 0) || 1;
    out.slice(0, 4).forEach(([bone, w], k) => {
      idx[v * 4 + k] = bone;
      wts[v * 4 + k] = w / total;
    });
  }
  return { idx, wts };
}

export async function loadArmModel(scene: Scene, url = ARM_MODEL_URL): Promise<ArmModel> {
  const container = await loadContainer(scene, url);
  try {
    const mesh = container.meshes.find((m) => m.getTotalVertices() > 0) as AbstractMesh | undefined;
    const material = mesh?.material;
    if (!mesh || !material || mesh.getTotalVertices() !== EXPECTED_VERTICES) throw new Error('unexpected arm model');
    for (const m of container.meshes) m.computeWorldMatrix(true);
    const W = mesh.computeWorldMatrix(true);
    const flip = W.determinant() < 0;
    const P = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const N = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    const T = mesh.getVerticesData(VertexBuffer.TangentKind);
    const UV = mesh.getVerticesData(VertexBuffer.UVKind)!;
    const I = mesh.getIndices()!;
    const n = P.length / 3;

    // loaded model → arm frame: X = −z, Y = −x, Z = y (a proper rotation)
    const toArm = (v: Vector3) => v.set(-v.z, -v.x, v.y);
    const wp = new Float32Array(n * 3);
    const wn = new Float32Array(n * 3);
    const wt = T ? new Float32Array(n * 4) : null;
    const sideOf = new Int8Array(n);
    const t = new Vector3();
    for (let i = 0; i < n; i++) {
      Vector3.TransformCoordinatesFromFloatsToRef(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], W, t);
      sideOf[i] = t.z < 0 ? 1 : -1; // z < 0 is the right arm
      toArm(t);
      wp.set([t.x, t.y, t.z], i * 3);
      Vector3.TransformNormalFromFloatsToRef(N[i * 3], N[i * 3 + 1], N[i * 3 + 2], W, t);
      toArm(t.normalize());
      wn.set([t.x, t.y, t.z], i * 3);
      if (T && wt) {
        Vector3.TransformNormalFromFloatsToRef(T[i * 4], T[i * 4 + 1], T[i * 4 + 2], W, t);
        toArm(t.normalize());
        wt.set([t.x, t.y, t.z, flip ? -T[i * 4 + 3] : T[i * 4 + 3]], i * 4);
      }
    }

    const build = (side: 1 | -1): ArmSideData => {
      const map = new Int32Array(n).fill(-1);
      let count = 0;
      for (let i = 0; i < n; i++) if (sideOf[i] === side) map[i] = count++;
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const tangents = wt ? new Float32Array(count * 4) : null;
      const uvs = new Float32Array(count * 2);
      const cx = side * RAW.wrist[0];
      for (let i = 0; i < n; i++) {
        const j = map[i];
        if (j < 0) continue;
        positions[j * 3] = (wp[i * 3] - cx) * SCALE;
        positions[j * 3 + 1] = (wp[i * 3 + 1] - RAW.wrist[1]) * SCALE;
        positions[j * 3 + 2] = (wp[i * 3 + 2] - RAW.wrist[2]) * SCALE;
        normals.set(wn.subarray(i * 3, i * 3 + 3), j * 3);
        if (tangents && wt) tangents.set(wt.subarray(i * 4, i * 4 + 4), j * 4);
        uvs[j * 2] = UV[i * 2];
        uvs[j * 2 + 1] = UV[i * 2 + 1];
      }
      const tri: number[] = [];
      for (let k = 0; k < I.length; k += 3) {
        const a = map[I[k]], b = map[I[k + 1]], c = map[I[k + 2]];
        if (a < 0 || b < 0 || c < 0) continue;
        // a mirroring transform reverses the winding; swap to keep front faces in front
        if (flip) tri.push(a, c, b);
        else tri.push(a, b, c);
      }
      const { idx, wts } = weigh(positions, side);
      const th = RAW.thumb;
      const thumbRest = new Vector3(side * (th[3][0] - th[0][0]), th[3][1] - th[0][1], th[3][2] - th[0][2]).normalize();
      return { positions, normals, tangents, uvs, indices: Uint32Array.from(tri), matricesIndices: idx, matricesWeights: wts, bones: boneDefs(side), thumbRest };
    };

    return {
      container,
      material,
      right: build(1),
      left: build(-1),
      forearmLength: -RAW.elbowZ * SCALE,
      palmOffset: 0.15 * SCALE,
      palmHalf: 0.055 * SCALE,
      knuckleReach: (0.295 - 0.15) * SCALE,
    };
  } catch (err) {
    container.dispose();
    throw err;
  }
}
