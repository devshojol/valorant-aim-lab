/**
 * Prepare the "M4 - FPS Weapon Animations Pack (v.1)" GLB (BarcodeGames, CC BY 4.0) for use as the
 * first-person arms (public/models/fp-arms-anim.glb).
 *
 * Run in a scratch folder with `npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4`:
 *   node prepare-fp-arms.mjs m4_-_fps_weapon_animations_pack_v.1.glb fp-arms-anim.glb
 *
 * Steps:
 *  - spec/gloss materials → metal/rough (the game's loader doesn't register the spec/gloss extension);
 *  - the M4 rifle and its parts lose their meshes (the game attaches its own guns to the weapon joint;
 *    every joint, and so every animation, is kept);
 *  - textures resized to at most 1024 px and converted to WebP;
 *  - unused data pruned.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough, prune, textureCompress } from '@gltf-transform/functions';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: node prepare-fp-arms.mjs <in.glb> <out.glb>');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
await doc.transform(metalRough());

// Drop every mesh that isn't the hand or glove (the rifle, magazines, bullets, bolt, trigger, safety).
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
  textureCompress({ targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
  prune(),
);
await io.write(output, doc);
console.log(`removed ${removed} weapon meshes → ${output}`);
