/**
 * Turn a downloaded gun (Sketchfab .glb / unzipped glTF folder, or one or more .stl files) into a weapon skin
 * for public/models/weapons.
 *
 * Run from a scratch folder with the tools installed:
 *   npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
 *   node /path/to/repo/scripts/prepare-weapon-skin.mjs <weapon> <scene.gltf|model.glb|a.stl,b.stl> <out.glb> [points.bin]
 *
 * Steps:
 *  - STL parts (no materials in the format) get one flat material (`color`, `metal`, `rough`) and smooth normals;
 *  - skinned meshes are baked in their bind pose, then animations and skins dropped (the game animates guns
 *    itself), listed parts removed;
 *  - every mesh baked into one space, then turned so the barrel runs along +Z with +Y up, centred, and
 *    scaled to the gun's real length in metres. After this the skin needs no yaw and its grip, muzzle
 *    and sight points (src/game/weapons/WeaponSkins.ts) can be read straight off a side view;
 *  - meshes joined per material, welded, simplified to a triangle budget;
 *  - textures resized to 1024 px WebP; material extensions the game's loader doesn't register removed.
 *
 * `points.bin` (optional) gets the final vertex positions as float32 x,y,z for drawing that side view.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, getBounds, join, normals, prune, simplify, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/**
 * length: real length in metres. flipZ / flipY: set when the automatic alignment (longest side = barrel,
 * middle = height) leaves the muzzle pointing backwards or the gun upside down. tris: triangle budget.
 * error: simplifier error allowance (share of the model size, default 0.004). drop: mesh-node name fragments
 * to remove. opaque: materials wrongly exported as blended. color / metal / rough: material for STL input.
 * parts: pieces kept as their own named node instead of being joined into the gun: `nodes` = mesh-node name
 * fragments, `joints` = joints of a skinned mesh whose triangles are cut out (the pivot printed at the end is
 * the first joint's position in the final space).
 */
const CONFIG = {
  // Valorant skins from Sketchfab / Thingiverse (credits in public/models/README.md)
  classic: { length: 0.21, tris: 8000 },
  ghost: { length: 0.4, tris: 7000, drop: ['Object_11'] }, // Object_11: ground plane
  spectre: { length: 0.66, tris: 10000 },
  // offset: the magazine STL is exported at the print origin; this moves it into the mag well (STL units)
  guardian: { length: 1.15, tris: 14000, color: [0.16, 0.17, 0.18], metal: 0.6, rough: 0.45, offset: { guardian_magazine: [0.209, -0.01, 0.022] } },
  // Kuronami Operator: the magazine (separate meshes) and the bolt (the triangles skinned to the bolt joints)
  // stay separate nodes so the game can move them
  operator: { length: 1.25, tris: 16000, parts: { mag: { nodes: ['Magazine'] }, bolt: { joints: ['Bolt_08', 'BoltHead_09'] } } },
  // untextured (an STL conversion, plain white): repainted gunmetal like the Guardian
  sheriff: { length: 0.34, tris: 14000, error: 0.02, color: [0.16, 0.17, 0.18], metal: 0.6, rough: 0.45 },
};

const [weapon, input, output, pointsOut] = process.argv.slice(2);
const cfg = CONFIG[weapon];
if (!cfg || !input || !output) throw new Error('usage: node prepare-weapon-skin.mjs <weapon> <scene.gltf|model.glb|a.stl,b.stl> <out.glb> [points.bin]');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Binary STL files → one glTF document, a mesh node per file, one shared material. */
function readStl(paths) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const mat = doc
    .createMaterial(weapon)
    .setBaseColorFactor([...(cfg.color ?? [0.5, 0.5, 0.5]), 1])
    .setMetallicFactor(cfg.metal ?? 0)
    .setRoughnessFactor(cfg.rough ?? 0.6);
  for (const path of paths) {
    const b = readFileSync(path);
    const n = b.readUInt32LE(80);
    if (84 + n * 50 !== b.length) throw new Error(`${path}: not a binary STL`);
    const name = path.split('/').pop().replace(/\.stl$/i, '');
    const off = cfg.offset?.[name] ?? [0, 0, 0];
    const pos = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) pos[i * 9 + k] = b.readFloatLE(84 + i * 50 + 12 + k * 4) + off[k % 3];
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setMaterial(mat);
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }
  return doc;
}

const stl = input.toLowerCase().endsWith('.stl');
const doc = stl ? readStl(input.split(',')) : await io.read(input);
const root = doc.getRoot();
if (stl) await doc.transform(weld(), normals({ overwrite: true }));

/** Multiply two column-major 4×4 matrices. */
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
/** A new primitive holding only the given triangles of `prim` (own, compact copies of every attribute). */
function subPrimitive(prim, tris) {
  const idx = prim.getIndices();
  const remap = new Map();
  const out = [];
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const v = idx ? idx.getScalar(t * 3 + k) : t * 3 + k;
      if (!remap.has(v)) remap.set(v, remap.size);
      out.push(remap.get(v));
    }
  const np = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
  const buffer = root.listBuffers()[0];
  for (const sem of prim.listSemantics()) {
    const src = prim.getAttribute(sem);
    const n = src.getElementSize();
    const arr = new (src.getArray().constructor)(remap.size * n);
    const el = [];
    for (const [from, to] of remap) {
      src.getElement(from, el);
      for (let k = 0; k < n; k++) arr[to * n + k] = el[k];
    }
    np.setAttribute(sem, doc.createAccessor().setType(src.getType()).setNormalized(src.getNormalized()).setArray(arr).setBuffer(buffer));
  }
  np.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(out)).setBuffer(buffer));
  return np;
}
const partNodes = new Map(); // part name → node
const partPivots = new Map(); // part name → [x, y, z] (before alignment)
const partNode = (name) => {
  if (!partNodes.has(name)) {
    const n = doc.createNode(name).setMesh(doc.createMesh(name));
    root.listScenes()[0].addChild(n);
    partNodes.set(name, n);
  }
  return partNodes.get(name);
};

/** Bake each skinned mesh in its bind pose (joint world × inverse bind, blended per vertex) into world space. */
for (const node of root.listNodes()) {
  const skin = node.getSkin();
  const mesh = node.getMesh();
  if (!skin || !mesh) continue;
  const ibm = skin.getInverseBindMatrices();
  const jm = skin.listJoints().map((j, i) => mul(j.getWorldMatrix(), ibm ? ibm.getElement(i, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0');
    const W = prim.getAttribute('WEIGHTS_0');
    if (!J || !W) continue;
    for (const sem of ['POSITION', 'NORMAL']) {
      const acc = prim.getAttribute(sem);
      if (!acc) continue;
      const w0 = sem === 'POSITION' ? 1 : 0;
      const v = [];
      const j = [];
      const w = [];
      for (let i = 0; i < acc.getCount(); i++) {
        acc.getElement(i, v);
        J.getElement(i, j);
        W.getElement(i, w);
        const out = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
          if (!w[k]) continue;
          const m = jm[j[k]];
          for (let r = 0; r < 3; r++) out[r] += w[k] * (m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w0);
        }
        if (sem === 'NORMAL') {
          const l = Math.hypot(...out) || 1;
          for (let r = 0; r < 3; r++) out[r] /= l;
        }
        acc.setElement(i, out);
      }
    }
  }
  // cut out the triangles that belong to a part's joints (two or more corners mostly weighted to them)
  for (const [name, part] of Object.entries(cfg.parts ?? {})) {
    if (!part.joints) continue;
    const joints = skin.listJoints();
    const set = new Set(part.joints.map((jn) => joints.findIndex((j) => j.getName() === jn)).filter((i) => i >= 0));
    if (!set.size) continue;
    if (!partPivots.has(name)) partPivots.set(name, joints.find((j) => j.getName() === part.joints[0]).getWorldTranslation());
    for (const prim of mesh.listPrimitives()) {
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      const idx = prim.getIndices();
      if (!J || !W) continue;
      const j = [];
      const w = [];
      const inPart = (v) => {
        J.getElement(v, j);
        W.getElement(v, w);
        let a = 0;
        for (let k = 0; k < 4; k++) if (set.has(j[k])) a += w[k];
        return a > 0.5;
      };
      const count = (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
      const mine = [];
      const rest = [];
      for (let t = 0; t < count; t++) {
        let n = 0;
        for (let k = 0; k < 3; k++) if (inPart(idx ? idx.getScalar(t * 3 + k) : t * 3 + k)) n++;
        (n >= 2 ? mine : rest).push(t);
      }
      if (!mine.length) continue;
      partNode(name).getMesh().addPrimitive(subPrimitive(prim, mine));
      mesh.addPrimitive(subPrimitive(prim, rest));
      mesh.removePrimitive(prim);
    }
  }
  // now in world space: move the node to the scene root with no transform
  for (const p of node.listParents()) if (p.propertyType === 'Node') p.removeChild(node);
  root.listScenes()[0].addChild(node);
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  node.setExtras({ ...node.getExtras(), baked: true });
}

for (const a of root.listAnimations()) a.dispose();
for (const n of root.listNodes()) {
  n.setSkin(null);
  if (n.getMesh() && (cfg.drop ?? []).some((d) => n.getName().toLowerCase().includes(d.toLowerCase()))) n.setMesh(null);
}
for (const s of root.listSkins()) s.dispose();
for (const m of root.listMeshes())
  for (const p of m.listPrimitives()) for (const sem of p.listSemantics()) if (/^(JOINTS|WEIGHTS)_/.test(sem)) p.setAttribute(sem, null);
for (const m of root.listMaterials()) {
  if ((cfg.opaque ?? []).includes(m.getName())) m.setAlphaMode('OPAQUE');
  if (!stl && cfg.color)
    m.setBaseColorFactor([...cfg.color, 1])
      .setMetallicFactor(cfg.metal ?? 0)
      .setRoughnessFactor(cfg.rough ?? 0.6);
  for (const name of ['KHR_materials_transmission', 'KHR_materials_volume']) m.setExtension(name, null);
}

await doc.transform(dedup(), flatten());
// bake every node transform into its mesh, so the whole gun lives in one space
for (const n of root.listNodes()) {
  const mesh = n.getMesh();
  if (!mesh) continue;
  transformMesh(mesh, n.getWorldMatrix());
  for (const p of n.listParents()) if (p.propertyType === 'Node') p.removeChild(n);
  root.listScenes()[0].addChild(n);
  n.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
// parts made of whole mesh nodes: their primitives move to the part's node
for (const [name, part] of Object.entries(cfg.parts ?? {})) {
  if (!part.nodes) continue;
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    if (!mesh || partNodes.get(name) === n || !part.nodes.some((f) => n.getName().toLowerCase().includes(f.toLowerCase()))) continue;
    for (const p of mesh.listPrimitives()) {
      mesh.removePrimitive(p);
      partNode(name).getMesh().addPrimitive(p);
    }
    n.setMesh(null);
  }
}
await doc.transform(prune());

// barrel = longest side → +Z, height = middle → +Y, thickness → X; centre and scale to real length
const b = getBounds(root.listScenes()[0]);
const size = b.max.map((v, i) => v - b.min[i]);
const order = [0, 1, 2].sort((i, j) => size[i] - size[j]); // [thin, tall, long]
const c = b.max.map((v, i) => (v + b.min[i]) / 2);
const s = cfg.length / size[order[2]];
const fz = cfg.flipZ ? -1 : 1;
const fy = cfg.flipY ? -1 : 1;
// keep it a rotation (no mirroring): the X sign follows from the other two
const perm = [order[0], order[1], order[2]];
const parity = (perm[0] === 0 && perm[1] === 1) || (perm[0] === 1 && perm[1] === 2) || (perm[0] === 2 && perm[1] === 0) ? 1 : -1;
const fx = parity * fy * fz;
const M = new Array(16).fill(0);
const row = (outAxis, srcAxis, sign) => {
  M[srcAxis * 4 + outAxis] = sign * s; // column-major: out[outAxis] += src[srcAxis] * sign * s
  M[12 + outAxis] = -c[srcAxis] * sign * s;
};
row(0, order[0], fx);
row(1, order[1], fy);
row(2, order[2], fz);
M[15] = 1;
for (const mesh of root.listMeshes()) transformMesh(mesh, M);

await MeshoptSimplifier.ready;
// parts sit out the join: only they keep a name
const parts = new Set(partNodes.values());
for (const n of root.listNodes()) {
  if (parts.has(n)) continue;
  n.setName('');
  n.getMesh()?.setName('');
}
await doc.transform(join({ keepNamed: parts.size > 0 }), weld());
for (const [name, p] of partPivots) {
  const q = [0, 1, 2].map((r) => M[r] * p[0] + M[4 + r] * p[1] + M[8 + r] * p[2] + M[12 + r]);
  console.log(`${name} pivot`, q.map((v) => +v.toFixed(4)));
}
const count = () => root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0);
const before = count();
if (before > cfg.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: cfg.tris / before, error: cfg.error ?? 0.004 }));
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }), prune());
for (const name of ['KHR_materials_transmission', 'KHR_materials_volume']) root.listExtensionsUsed().find((e) => e.extensionName === name)?.dispose();

await io.write(output, doc);
const nb = getBounds(root.listScenes()[0]);
console.log(`${weapon}: ${Math.round(before)} → ${Math.round(count())} triangles, bounds`, nb.min.map((v) => +v.toFixed(3)), nb.max.map((v) => +v.toFixed(3)));
if (pointsOut) {
  const pts = [];
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) pts.push(...p.getAttribute('POSITION').getArray());
  writeFileSync(pointsOut, Buffer.from(new Float32Array(pts).buffer));
}
