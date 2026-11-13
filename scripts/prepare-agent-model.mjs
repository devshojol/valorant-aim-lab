/**
 * Prepare a Sketchfab Valorant agent GLB for use as the bot model (public/models/miks.glb).
 *
 * Run from a scratch folder that has the tools installed:
 *   npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
 *   node prepare-agent-model.mjs <downloaded.glb> <out.glb> [triangle ratio = 0.5]
 * then run scripts/compress-models.mjs over public/models.
 *
 * Steps:
 *  - mesh welded and simplified (the model must already stand on the origin), textures resized to 1024 px WebP;
 *  - the game rig (hundreds of face, finger, twist and cloth joints) collapsed to the joints the bot
 *    posing uses (src/game/bots/AgentVisual.ts). Joints are matched by name without the numeric
 *    suffix the exporter adds, so any agent on the same rig works. In these assets the rest pose
 *    equals the bind pose, so moving a removed joint's skin weights onto its nearest kept ancestor
 *    leaves the rest shape unchanged. The bind matrices are rebuilt from the rest pose.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , input, output, ratioArg] = process.argv;
if (!input || !output) throw new Error('usage: node prepare-agent-model.mjs <in.glb> <out.glb> [ratio]');
const ratio = Number(ratioArg ?? 0.5);

/** Joint name without the exporter's numeric suffix ("L_Hand_0201" → "L_Hand"). */
const base = (name) => (name.endsWith('rootJoint') ? '_rootJoint' : name.replace(/_\d+$/, ''));
const KEEP = new Set(['_rootJoint', 'Skeleton', 'Root', 'Splitter', 'Spine1', 'Spine2', 'Spine3', 'Spine4', 'Neck', 'Head',
  'L_Eyeball', 'R_Eyeball', 'L_Clavicle', 'L_Shoulder', 'L_Elbow', 'L_Hand', 'L_Middle1',
  'R_Clavicle', 'R_Shoulder', 'R_Elbow', 'R_Hand', 'R_Middle1', 'Pelvis',
  'L_Hip', 'L_Knee', 'L_Foot', 'L_Toe', 'R_Hip', 'R_Knee', 'R_Foot', 'R_Toe']);
/** Removed joints that must follow a kept joint which is not their ancestor (the face rig hangs off a twin of the head). */
const ALIAS = { Head_CS: 'Head' };

/** Inverse of a column-major 4×4 matrix. */
function invert(m) {
  const a = Array.from({ length: 4 }, (_, r) => [m[r], m[4 + r], m[8 + r], m[12 + r], ...[0, 1, 2, 3].map((c) => (c === r ? 1 : 0))]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('singular joint matrix');
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k];
    }
  }
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = a[r][4 + c];
  return out;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
await MeshoptSimplifier.ready;
await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0008 }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [1024, 1024] }),
);

const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const keptJoints = joints.filter((j) => KEEP.has(base(j.getName())));
const missing = [...KEEP].filter((k) => !keptJoints.some((j) => base(j.getName()) === k));
if (missing.length) throw new Error('missing joints: ' + missing);
if (keptJoints.length !== KEEP.size) throw new Error('ambiguous joint names: ' + keptJoints.map((j) => j.getName()));
const byBase = new Map(keptJoints.map((j) => [base(j.getName()), j]));
const keptFor = (j) => {
  for (let n = j; n; n = parentOf.get(n)) {
    const b = base(n.getName());
    if (KEEP.has(b)) return n;
    if (ALIAS[b]) return byBase.get(ALIAS[b]);
  }
  throw new Error('no kept ancestor for ' + j.getName());
};
const newIndex = new Map(keptJoints.map((j, i) => [j, i]));
const remap = joints.map((j) => newIndex.get(keptFor(j)));
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  if (!J || !W) continue;
  const ja = J.getArray(), wa = W.getArray();
  for (let v = 0; v < J.getCount(); v++) {
    const acc = new Map();
    for (let k = 0; k < 4; k++) { const w = wa[v * 4 + k]; if (w <= 0) continue; const nj = remap[ja[v * 4 + k]]; acc.set(nj, (acc.get(nj) ?? 0) + w); }
    const list = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((s, [, w]) => s + w, 0) || 1;
    const full = W.getNormalized() ? (wa instanceof Uint8Array ? 255 : 65535) : 1;
    for (let k = 0; k < 4; k++) { ja[v * 4 + k] = list[k] ? list[k][0] : 0; wa[v * 4 + k] = list[k] ? (list[k][1] / sum) * full : 0; }
  }
  J.setArray(ja); W.setArray(wa);
}
// Bind matrices are rebuilt from the rest pose (rest pose = bind pose). The exporter leaves a
// placeholder matrix on joints that had no skin weights of their own, and those joints now carry
// the weights of the twist and helper joints below them.
const ibm = new Float32Array(keptJoints.length * 16);
keptJoints.forEach((j, i) => ibm.set(invert(j.getWorldMatrix()), i * 16));
skin.getInverseBindMatrices().setArray(ibm);
for (const j of joints) skin.removeJoint(j);
for (const j of keptJoints) skin.addJoint(j);
// drop the removed joint nodes
const removed = joints.filter((j) => !KEEP.has(base(j.getName())));
for (const j of removed) { const p = parentOf.get(j); if (p) p.removeChild(j); }
for (const j of removed) j.dispose();
await doc.transform(prune());
await io.write(output, doc);
const tris = root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
console.log('joints', joints.length, '->', keptJoints.length, '| triangles', tris, '| nodes', root.listNodes().length);
