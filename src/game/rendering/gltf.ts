/**
 * glTF/GLB loading for the optional local models in public/models (agent bots, weapon skins).
 * Registers only the loader extensions those files use, and keeps each file's bytes in memory
 * so later sessions don't download it again.
 */
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_ior';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Scene } from './babylon';

const bytes = new Map<string, Promise<Uint8Array>>();

function fetchBytes(url: string): Promise<Uint8Array> {
  let p = bytes.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => new Uint8Array(b));
    p.catch(() => bytes.delete(url));
    bytes.set(url, p);
  }
  return p;
}

/** Load a GLB into an asset container (not added to the scene; instantiate copies from it). */
export async function loadContainer(scene: Scene, url: string): Promise<AssetContainer> {
  const data = await fetchBytes(url);
  return LoadAssetContainerAsync(data, scene, { pluginExtension: '.glb', name: url.split('/').pop() });
}
