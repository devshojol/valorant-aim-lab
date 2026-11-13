/**
 * Shrink the GLB models in public/models in place (download size and GPU memory).
 *
 * Run from a scratch folder that has the tools installed, pointing at this repository:
 *   npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
 *   node /path/to/repo/scripts/compress-models.mjs /path/to/repo/public/models
 *
 * Per file:
 *  - duplicate accessors/materials/textures merged, unused data pruned;
 *  - vertices welded and stored quantized (KHR_mesh_quantization: 8-bit normals, 16-bit UVs, 8-bit
 *    joints/weights, and 16-bit positions on unskinned models) with 16-bit indices where they fit;
 *  - animation keyframes that add nothing removed (fp-arms-anim.glb);
 *  - the Phantom skin simplified further (it is by far the densest model);
 *  - textures re-encoded as WebP only when that makes them smaller.
 *
 * Safe to run again: an already compressed file comes out the same size.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node compress-models.mjs <public/models>');

/** Extra per-file steps. `simplify` is the share of triangles to keep. */
const EXTRA = { 'weapons/phantom.glb': { simplify: 0.45, error: 0.002 } };

const files = [];
(function walk(d, rel) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p, rel + name + '/');
    else if (name.endsWith('.glb')) files.push(rel + name);
  }
})(dir, '');

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let before = 0;
let after = 0;
for (const rel of files) {
  const path = join(dir, rel);
  const size0 = statSync(path).size;
  const doc = await io.read(path);
  const extra = EXTRA[rel] ?? {};
  const steps = [dedup(), resample(), weld()];
  if (extra.simplify) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: extra.simplify, error: extra.error }));
  // Quantizing positions moves a scale/offset onto the mesh node and, for skinned meshes, gives every
  // mesh its own skin. The game poses one shared skeleton in code, so skinned files keep float positions.
  const skinned = doc.getRoot().listSkins().length > 0;
  steps.push(
    quantize({
      pattern: skinned ? /^(NORMAL|TANGENT|TEXCOORD|COLOR|JOINTS|WEIGHTS)(_\d+)?$/ : /.*/,
      quantizePosition: 16,
      quantizeNormal: 8,
      quantizeTexcoord: 16,
      quantizeColor: 8,
      quantizeWeight: 8,
      quantizeGeneric: 16,
    }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, effort: 6 }),
    prune(),
  );
  await doc.transform(...steps);
  const out = await io.writeBinary(doc);
  if (out.byteLength < size0) await io.write(path, doc);
  const size1 = Math.min(out.byteLength, size0);
  before += size0;
  after += size1;
  console.log(`${rel.padEnd(24)} ${(size0 / 1024).toFixed(0).padStart(6)} KB → ${(size1 / 1024).toFixed(0).padStart(6)} KB`);
}
console.log(`${'total'.padEnd(24)} ${(before / 1024).toFixed(0).padStart(6)} KB → ${(after / 1024).toFixed(0).padStart(6)} KB`);
