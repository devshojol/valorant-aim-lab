/**
 * Optional weapon skins: GLB models in public/models/weapons that replace the blocky
 * first-person guns (and the bots' rifle).
 *
 * Each model is described by a few points measured on it (after `yaw` turns the barrel to +Z,
 * with +Y up and the model centred on X): the trigger-hand grip, the support-hand handguard,
 * the muzzle and the top of the sight line. The game scales the model to a target length and
 * places it so the grip lands where the first-person hand (or the bot's IK target) is.
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { WeaponId } from '../../types';
import { TransformNode, Vector3, type AbstractMesh, type Scene } from '../rendering/babylon';
import { loadContainer } from '../rendering/gltf';

/** A [y, z] point on the model (model units, barrel along +Z). */
type YZ = [number, number];

export interface SkinSpec {
  file: string;
  /** Yaw that points the barrel along +Z. */
  yaw: number;
  /** Model length along the barrel (stock to muzzle), in model units. */
  length: number;
  grip: YZ;
  handguard: YZ | null;
  muzzle: YZ;
  /** Height of the top of the gun along the sight line (aim-down-sights alignment). */
  sightY: number;
  /** Node holding the detachable magazine (drops out on reload). */
  magNode?: string;
  /** Revolver cylinder node: turns around its local Z axis after each shot. */
  cylinderNode?: string;
  /** Turn per shot = full circle / chambers. */
  chambers?: number;
}

const SKIN_SPECS: Partial<Record<WeaponId, SkinSpec>> = {
  vandal: {
    file: 'models/weapons/vandal.glb',
    yaw: Math.PI / 2,
    length: 1.318,
    grip: [-0.02, -0.24],
    handguard: [0.055, 0.32],
    muzzle: [0.105, 0.66],
    sightY: 0.16,
    magNode: 'Gaia-Vandal-Orange-Main-Mag_0',
  },
  phantom: {
    file: 'models/weapons/phantom.glb',
    yaw: 0,
    length: 0.997,
    grip: [-0.04, -0.2],
    handguard: [0.02, 0.14],
    muzzle: [0.075, 0.5],
    sightY: 0.115,
  },
  sheriff: {
    file: 'models/weapons/sheriff.glb',
    yaw: Math.PI / 2,
    length: 0.427,
    grip: [-0.025, -0.15],
    handguard: null,
    muzzle: [0.06, 0.205],
    sightY: 0.105,
    cylinderNode: 'Mag_Rotator_15',
    // This rig turns the whole front assembly (cylinder cage, barrel and top sight) together, so a
    // one-chamber step would leave the sight off-centre: spin a full turn per shot instead.
    chambers: 1,
  },
};

/** One placed copy of a skin. Points are in the parent's space. */
export interface PlacedSkin {
  holder: TransformNode;
  meshes: AbstractMesh[];
  scale: number;
  muzzle: Vector3;
  handguard: Vector3 | null;
  sightY: number;
  mag: TransformNode | null;
  cylinder: TransformNode | null;
  dispose(): void;
}

export class WeaponSkin {
  constructor(
    readonly id: WeaponId,
    readonly spec: SkinSpec,
    private readonly container: AssetContainer,
  ) {}

  /** Instantiate under `parent`, scaled to `length` metres, with the trigger grip at `gripAt`. */
  place(parent: TransformNode, length: number, gripAt: Vector3): PlacedSkin {
    const spec = this.spec;
    const s = length / spec.length;
    const holder = new TransformNode(`skin-${this.id}`, parent.getScene());
    holder.parent = parent;
    holder.rotation.y = spec.yaw;
    holder.scaling.setAll(s);
    holder.position.set(gripAt.x, gripAt.y - spec.grip[0] * s, gripAt.z - spec.grip[1] * s);
    const entries = this.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    for (const r of entries.rootNodes) r.parent = holder;
    const at = ([y, z]: YZ) => new Vector3(gripAt.x, holder.position.y + y * s, holder.position.z + z * s);
    const find = (name?: string) =>
      name ? ((holder.getDescendants(false).find((n) => n.name === name) as TransformNode | undefined) ?? null) : null;
    const skeletons: Skeleton[] = entries.skeletons;
    return {
      holder,
      meshes: holder.getChildMeshes(false),
      scale: s,
      muzzle: at(spec.muzzle),
      handguard: spec.handguard ? at(spec.handguard) : null,
      sightY: holder.position.y + spec.sightY * s,
      mag: find(spec.magNode),
      cylinder: find(spec.cylinderNode),
      dispose() {
        holder.dispose(false, false); // materials belong to the shared template
        for (const k of skeletons) k.dispose();
      },
    };
  }

  dispose() {
    this.container.dispose();
  }
}

/** Load the skins for the given weapons (missing or broken files are skipped). */
export async function loadWeaponSkins(scene: Scene, ids: WeaponId[]): Promise<Map<WeaponId, WeaponSkin>> {
  const out = new Map<WeaponId, WeaponSkin>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const spec = SKIN_SPECS[id];
      if (!spec) return;
      try {
        out.set(id, new WeaponSkin(id, spec, await loadContainer(scene, spec.file)));
      } catch (err) {
        console.warn(`[weapons] ${id} skin unavailable — using the simple model`, err);
      }
    }),
  );
  return out;
}
