/**
 * Prepare a Sketchfab agent GLB for use as a bot model (public/models/sage.glb).
 *
 * Steps (run in a scratch folder with `npm i @gltf-transform/cli@4 @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4`):
 *   npx gltf-transform center   sage.glb a.glb --pivot below          # feet on the origin
 *   npx gltf-transform resize   a.glb b.glb --width 1024 --height 1024
 *   npx gltf-transform simplify b.glb c.glb --ratio 0.5 --error 0.0008
 *   npx gltf-transform webp     c.glb d.glb --quality 82
 *   npx gltf-transform prune    d.glb e.glb
 *   node prepare-agent-model.mjs e.glb sage.glb                       # this script: shrink the skeleton
 *
 * This script collapses the game rig to the joints the bot posing uses (src/game/bots/AgentVisual.ts).
 * In this asset the rest pose equals the bind pose, so moving a removed joint's skin weights onto its
 * nearest kept ancestor leaves the rest shape unchanged.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
const KEEP = new Set(['GLTF_created_0_rootJoint', 'Skeleton_1', 'Root_2', 'Splitter_3', 'Spine1_4', 'Spine2_5', 'Spine3_6', 'Spine4_7', 'Neck_8', 'Head_10',
  'L_Eyeball_35', 'R_Eyeball_36', 'L_Clavicle_134', 'L_Shoulder_135', 'L_Elbow_136', 'L_Hand_137', 'L_Middle1_142',
  'R_Clavicle_169', 'R_Shoulder_170', 'R_Elbow_171', 'R_Hand_172', 'R_Middle1_180', 'Pelvis_213',
  'L_Hip_214', 'L_Knee_215', 'L_Foot_217', 'L_Toe_218', 'R_Hip_225', 'R_Knee_226', 'R_Foot_228', 'R_Toe_229']);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const keptAncestor = (j) => { let n = j; while (n && !KEEP.has(n.getName())) n = parentOf.get(n); if (!n) throw new Error('no kept ancestor for ' + j.getName()); return n; };
const keptJoints = joints.filter((j) => KEEP.has(j.getName()));
if (keptJoints.length !== KEEP.size) throw new Error('missing joints: ' + [...KEEP].filter((k) => !keptJoints.some((j) => j.getName() === k)));
const newIndex = new Map(keptJoints.map((j, i) => [j, i]));
const remap = joints.map((j) => newIndex.get(keptAncestor(j)));
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  if (!J || !W) continue;
  const ja = J.getArray(), wa = W.getArray();
  for (let v = 0; v < J.getCount(); v++) {
    const acc = new Map();
    for (let k = 0; k < 4; k++) { const w = wa[v * 4 + k]; if (w <= 0) continue; const nj = remap[ja[v * 4 + k]]; acc.set(nj, (acc.get(nj) ?? 0) + w); }
    const list = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((s, [, w]) => s + w, 0) || 1;
    for (let k = 0; k < 4; k++) { ja[v * 4 + k] = list[k] ? list[k][0] : 0; wa[v * 4 + k] = list[k] ? list[k][1] / sum : 0; }
  }
  J.setArray(ja); W.setArray(wa);
}
const oldIbm = skin.getInverseBindMatrices().getArray();
const ibm = new Float32Array(keptJoints.length * 16);
keptJoints.forEach((j, i) => ibm.set(oldIbm.subarray(joints.indexOf(j) * 16, joints.indexOf(j) * 16 + 16), i * 16));
skin.getInverseBindMatrices().setArray(ibm);
for (const j of joints) skin.removeJoint(j);
for (const j of keptJoints) skin.addJoint(j);
// drop removed joint nodes (deepest first)
const removed = joints.filter((j) => !KEEP.has(j.getName()));
for (const j of removed) { const p = parentOf.get(j); if (p) p.removeChild(j); }
for (const j of removed) j.dispose();
await doc.transform(prune());
await io.write(process.argv[3], doc);
console.log('joints', joints.length, '->', keptJoints.length, 'nodes now', root.listNodes().length);
