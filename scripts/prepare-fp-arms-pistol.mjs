/**
 * Prepare the "Mark 23 Animated (Free)" GLB (BarcodeGames) for use as the first-person arms that hold
 * the sidearms (public/models/fp-arms-pistol.glb).
 *
 * Run in a scratch folder with
 * `npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp`:
 *   node prepare-fp-arms-pistol.mjs mark_23__animated_free.glb fp-arms-pistol.glb
 *
 * Steps:
 *  - the Mark 23 pistol (frame, slide, magazine) loses its meshes: the game attaches its own sidearms
 *    to the weapon joint; every joint, and so every animation, is kept;
 *  - textures resized to at most 1024 px and converted to WebP;
 *  - duplicate data merged, keyframes that add nothing removed, unused data pruned.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: node prepare-fp-arms-pistol.mjs <in.glb> <out.glb>');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);

// Drop every mesh that isn't the hand or glove (the pistol's frame, slide and magazine).
let removed = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const mats = mesh.listPrimitives().map((p) => p.getMaterial()?.getName() ?? '');
  if (!mats.some((m) => m.startsWith('Hand') || m.startsWith('Glove'))) {
    node.setMesh(null);
    removed++;
  }
}

await doc.transform(
  prune(),
  dedup(),
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
  prune(),
);
await io.write(output, doc);
console.log(`removed ${removed} weapon meshes → ${output}`);
