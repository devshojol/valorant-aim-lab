/**
 * Bone layout of the skinned arm model (see ArmModel.ts). Kept apart from the loader so the
 * posing code can use it without pulling the glTF loader into the main bundle.
 */
import { Matrix, type Vector3 } from '../rendering/babylon';

/** Bone indices: forearm (elbow end, wrist end), hand, fingers index→little × 3 joints, thumb × 3. */
export const BONE = { elbow: 0, wristFore: 1, hand: 2, finger: (f: number, s: number) => 3 + f * 3 + s, thumb: (s: number) => 15 + s } as const;

export interface ArmBoneDef {
  name: string;
  parent: number;
  /** Bind position relative to the parent bone (or to the arm frame for roots), metres. */
  local: Vector3;
}

/** Bind matrix of a bone def (translation only). */
export function boneLocalMatrix(def: ArmBoneDef): Matrix {
  return Matrix.Translation(def.local.x, def.local.y, def.local.z);
}
