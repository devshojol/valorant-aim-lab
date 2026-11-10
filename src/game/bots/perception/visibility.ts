import { COL_SIGHT, type CollisionWorld } from '../../physics/CollisionWorld';

export const BOT_RADIUS = 0.3;
export const BOT_HEIGHT = 1.8;

/** Sample points on a humanoid used for visibility tests (world space). */
export function humanoidSamples(
  x: number,
  y: number,
  z: number,
  crouch: number,
  /** Unit vector perpendicular to the viewer direction (for shoulder samples). */
  sideX: number,
  sideZ: number,
  out: number[] = [],
): number[] {
  const legH = 0.86 - 0.55 * crouch;
  const head = y + legH + 0.75;
  const chest = y + legH + 0.32;
  const shoulder = 0.26;
  out.length = 0;
  out.push(x, head, z);
  out.push(x, chest, z);
  out.push(x + sideX * shoulder, chest, z + sideZ * shoulder);
  out.push(x - sideX * shoulder, chest, z - sideZ * shoulder);
  out.push(x + sideX * 0.12, head, z + sideZ * 0.12);
  out.push(x - sideX * 0.12, head, z - sideZ * 0.12);
  out.push(x, y + legH * 0.5, z);
  return out;
}

const tmp: number[] = [];

/** Number of visible sample points of a humanoid from an eye position. */
export function visibleSampleCount(
  world: CollisionWorld,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  x: number,
  y: number,
  z: number,
  crouch: number,
): number {
  let dx = x - eyeX;
  let dz = z - eyeZ;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  // perpendicular
  const sx = -dz;
  const sz = dx;
  const pts = humanoidSamples(x, y, z, crouch, sx, sz, tmp);
  let count = 0;
  for (let i = 0; i < pts.length; i += 3) {
    if (world.segmentClear(eyeX, eyeY, eyeZ, pts[i], pts[i + 1], pts[i + 2], COL_SIGHT)) count++;
  }
  return count;
}

export function isHumanoidVisible(
  world: CollisionWorld,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  x: number,
  y: number,
  z: number,
  crouch: number,
): boolean {
  return visibleSampleCount(world, eyeX, eyeY, eyeZ, x, y, z, crouch) > 0;
}

export interface ExposureInfo {
  /** Distance along peekDir from the anchor at which the bot first becomes visible (null = never). */
  exposeAt: number | null;
  /** Offset along peekDir (≤ 0) where the bot is fully hidden (null = no hidden point found). */
  hideAt: number | null;
  /** Max reachable distance along peekDir without hitting geometry. */
  reach: number;
}

/**
 * Analyse a peek line: starting at the anchor, walk along the peek direction until the bot
 * becomes visible from the eye; also search backwards for a hidden anchor if the anchor itself
 * is exposed.
 */
export function analysePeekLine(
  world: CollisionWorld,
  eye: [number, number, number],
  ax: number,
  ay: number,
  az: number,
  dirX: number,
  dirZ: number,
  maxPeek: number,
  crouch = 0,
): ExposureInfo {
  const step = 0.05;
  const visibleAt = (d: number) =>
    isHumanoidVisible(world, eye[0], eye[1], eye[2], ax + dirX * d, ay, az + dirZ * d, crouch);
  const blockedAt = (d: number) => world.overlap(ax + dirX * d, ay + 0.05, az + dirZ * d, BOT_RADIUS, BOT_HEIGHT) !== null;

  let hideAt: number | null = null;
  if (!visibleAt(0)) hideAt = 0;
  else {
    for (let d = -step; d >= -3; d -= step) {
      if (blockedAt(d)) break;
      if (!visibleAt(d)) {
        hideAt = d - 0.15;
        if (blockedAt(hideAt)) hideAt = d;
        break;
      }
    }
  }

  let reach = 0;
  let exposeAt: number | null = null;
  const start = hideAt ?? 0;
  for (let d = start; d <= maxPeek + 1e-6; d += step) {
    if (blockedAt(d)) break;
    reach = d;
    if (exposeAt === null && visibleAt(d)) exposeAt = d;
  }
  return { exposeAt, hideAt, reach };
}
