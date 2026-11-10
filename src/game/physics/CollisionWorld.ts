/**
 * Static axis-aligned collision world.
 *
 * The tactical maps are authored from boxes, so every static collider is an AABB.
 * This gives deterministic, allocation-free character movement and fast hitscan /
 * line-of-sight raycasts that do not depend on rendering meshes.
 */

export const COL_MOVE = 1;
export const COL_BULLET = 2;
export const COL_SIGHT = 4;
export const COL_ALL = COL_MOVE | COL_BULLET | COL_SIGHT;

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  flags: number;
  /** Optional material tag used for impact effects / sounds. */
  surface: string;
}

export interface RayHit {
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  box: Box;
}

export interface Body {
  x: number;
  y: number;
  z: number;
}

export interface MoveResult {
  grounded: boolean;
  hitCeiling: boolean;
  blockedX: boolean;
  blockedZ: boolean;
  steppedUp: number;
}

const SKIN = 0.001;
const EPS = 1e-4;

export class CollisionWorld {
  readonly boxes: Box[] = [];

  add(box: Box): void {
    this.boxes.push(box);
  }

  clear(): void {
    this.boxes.length = 0;
  }

  /**
   * Ray vs all boxes (slab method). Direction must be normalized.
   * Returns the closest hit within maxDist or null.
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    mask = COL_BULLET,
  ): RayHit | null {
    let bestT = maxDist;
    let best: Box | null = null;
    let bnx = 0;
    let bny = 0;
    let bnz = 0;
    const boxes = this.boxes;
    const ix = dx !== 0 ? 1 / dx : Infinity;
    const iy = dy !== 0 ? 1 / dy : Infinity;
    const iz = dz !== 0 ? 1 / dz : Infinity;

    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if ((b.flags & mask) === 0) continue;
      let tmin = 0;
      let tmax = bestT;
      let axis = -1;
      let sign = 0;

      // X slab
      if (dx === 0) {
        if (ox < b.minX || ox > b.maxX) continue;
      } else {
        let t1 = (b.minX - ox) * ix;
        let t2 = (b.maxX - ox) * ix;
        let s = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = 0;
          sign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Y slab
      if (dy === 0) {
        if (oy < b.minY || oy > b.maxY) continue;
      } else {
        let t1 = (b.minY - oy) * iy;
        let t2 = (b.maxY - oy) * iy;
        let s = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = 1;
          sign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      // Z slab
      if (dz === 0) {
        if (oz < b.minZ || oz > b.maxZ) continue;
      } else {
        let t1 = (b.minZ - oz) * iz;
        let t2 = (b.maxZ - oz) * iz;
        let s = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = 2;
          sign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }
      if (tmin < bestT) {
        bestT = tmin;
        best = b;
        bnx = axis === 0 ? sign : 0;
        bny = axis === 1 ? sign : 0;
        bnz = axis === 2 ? sign : 0;
      }
    }
    if (!best) return null;
    return {
      t: bestT,
      x: ox + dx * bestT,
      y: oy + dy * bestT,
      z: oz + dz * bestT,
      nx: bnx,
      ny: bny,
      nz: bnz,
      box: best,
    };
  }

  /** True when nothing with `mask` blocks the segment a→b. */
  segmentClear(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    mask = COL_SIGHT,
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.01, mask) === null;
  }

  /** Returns first box overlapping the body AABB, or null. */
  overlap(x: number, y: number, z: number, r: number, h: number, mask = COL_MOVE): Box | null {
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if ((b.flags & mask) === 0) continue;
      if (
        b.minX < x + r - EPS &&
        b.maxX > x - r + EPS &&
        b.minY < y + h - EPS &&
        b.maxY > y + EPS &&
        b.minZ < z + r - EPS &&
        b.maxZ > z - r + EPS
      ) {
        return b;
      }
    }
    return null;
  }

  /** Height of the highest walkable surface under the footprint within [y - maxDrop, y + EPS]. */
  groundBelow(x: number, y: number, z: number, r: number, maxDrop: number): number | null {
    let best: number | null = null;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if ((b.flags & COL_MOVE) === 0) continue;
      if (b.minX < x + r - EPS && b.maxX > x - r + EPS && b.minZ < z + r - EPS && b.maxZ > z - r + EPS) {
        if (b.maxY <= y + 0.01 && b.maxY >= y - maxDrop) {
          if (best === null || b.maxY > best) best = b.maxY;
        }
      }
    }
    return best;
  }

  /**
   * Kinematic character move with per-axis resolution, step-up and ground snapping.
   * `body` is the feet position and is mutated in place.
   */
  moveBody(
    body: Body,
    r: number,
    h: number,
    dx: number,
    dy: number,
    dz: number,
    stepHeight: number,
    wasGrounded: boolean,
  ): MoveResult {
    const res: MoveResult = { grounded: false, hitCeiling: false, blockedX: false, blockedZ: false, steppedUp: 0 };

    // --- vertical
    if (dy !== 0) {
      body.y += dy;
      for (let iter = 0; iter < 4; iter++) {
        const b = this.overlap(body.x, body.y, body.z, r, h);
        if (!b) break;
        if (dy < 0) {
          body.y = b.maxY;
          res.grounded = true;
        } else {
          body.y = b.minY - h - SKIN;
          res.hitCeiling = true;
        }
      }
    }

    const canStep = wasGrounded || res.grounded;

    // --- horizontal X
    if (dx !== 0) {
      body.x += dx;
      for (let iter = 0; iter < 4; iter++) {
        const b = this.overlap(body.x, body.y, body.z, r, h);
        if (!b) break;
        const rise = b.maxY - body.y;
        if (canStep && rise > 0 && rise <= stepHeight && !this.overlap(body.x, b.maxY + SKIN, body.z, r, h)) {
          body.y = b.maxY;
          res.steppedUp += rise;
          continue;
        }
        body.x = dx > 0 ? b.minX - r - SKIN : b.maxX + r + SKIN;
        res.blockedX = true;
      }
    }

    // --- horizontal Z
    if (dz !== 0) {
      body.z += dz;
      for (let iter = 0; iter < 4; iter++) {
        const b = this.overlap(body.x, body.y, body.z, r, h);
        if (!b) break;
        const rise = b.maxY - body.y;
        if (canStep && rise > 0 && rise <= stepHeight && !this.overlap(body.x, b.maxY + SKIN, body.z, r, h)) {
          body.y = b.maxY;
          res.steppedUp += rise;
          continue;
        }
        body.z = dz > 0 ? b.minZ - r - SKIN : b.maxZ + r + SKIN;
        res.blockedZ = true;
      }
    }

    // --- ground snap (walking down stairs / small ledges)
    if (!res.grounded && wasGrounded && dy <= 0) {
      const g = this.groundBelow(body.x, body.y, body.z, r, stepHeight + 0.05);
      if (g !== null) {
        body.y = g;
        res.grounded = true;
      }
    }
    if (!res.grounded && dy <= 0) {
      // Standing exactly on a surface.
      const g = this.groundBelow(body.x, body.y, body.z, r, 0.002);
      if (g !== null) res.grounded = true;
    }
    return res;
  }
}

/* ------------------------------------------------------------------ */
/* Oriented hitbox helpers (bots/players only rotate around Y)         */
/* ------------------------------------------------------------------ */

export interface LocalBox {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
}

/**
 * Ray vs a box defined in a frame rotated by `yaw` around Y and translated to (px,py,pz).
 * Returns t or -1.
 */
export function rayYawBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  px: number,
  py: number,
  pz: number,
  yaw: number,
  box: LocalBox,
  maxDist: number,
): number {
  // Transform ray into local frame (inverse rotation by yaw).
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const rx = ox - px;
  const rz = oz - pz;
  // Rotation used for local->world: x' = x*c + z*s ; z' = -x*s + z*c  (yaw about +Y, 0 = +Z forward)
  // Inverse: x = x'*c - z'*s ; z = x'*s + z'*c
  const lox = rx * c - rz * s;
  const loz = rx * s + rz * c;
  const ldx = dx * c - dz * s;
  const ldz = dx * s + dz * c;
  const loy = oy - py;

  const minX = box.cx - box.hx;
  const maxX = box.cx + box.hx;
  const minY = box.cy - box.hy;
  const maxY = box.cy + box.hy;
  const minZ = box.cz - box.hz;
  const maxZ = box.cz + box.hz;

  let tmin = 0;
  let tmax = maxDist;
  if (Math.abs(ldx) < 1e-9) {
    if (lox < minX || lox > maxX) return -1;
  } else {
    let t1 = (minX - lox) / ldx;
    let t2 = (maxX - lox) / ldx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (loy < minY || loy > maxY) return -1;
  } else {
    let t1 = (minY - loy) / dy;
    let t2 = (maxY - loy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(ldz) < 1e-9) {
    if (loz < minZ || loz > maxZ) return -1;
  } else {
    let t1 = (minZ - loz) / ldz;
    let t2 = (maxZ - loz) / ldz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export type HitZone = 'head' | 'body' | 'legs';

/**
 * Humanoid hitboxes for a given crouch factor (0 standing → 1 crouched).
 * Shared by bots and the player so damage rules are symmetrical.
 */
export function humanoidHitboxes(crouch: number): Record<HitZone, LocalBox> {
  const legH = 0.86 - 0.55 * crouch;
  return {
    legs: { cx: 0, cy: legH / 2, cz: 0, hx: 0.2, hy: legH / 2, hz: 0.14 },
    body: { cx: 0, cy: legH + 0.3, cz: 0, hx: 0.27, hy: 0.3, hz: 0.17 },
    head: { cx: 0, cy: legH + 0.75, cz: 0.02, hx: 0.135, hy: 0.15, hz: 0.14 },
  };
}

/** Ray vs a humanoid at (px,py,pz) rotated by yaw. Returns nearest zone hit. */
export function rayHumanoid(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  px: number,
  py: number,
  pz: number,
  yaw: number,
  crouch: number,
  maxDist: number,
): { t: number; zone: HitZone } | null {
  // Broad phase: bounding cylinder check.
  const qx = px - ox;
  const qz = pz - oz;
  const proj = qx * dx + qz * dz;
  const horizLen2 = dx * dx + dz * dz;
  if (horizLen2 > 1e-6) {
    const tClosest = proj / horizLen2;
    const cx = ox + dx * tClosest - px;
    const cz = oz + dz * tClosest - pz;
    if (cx * cx + cz * cz > 0.8 * 0.8) return null;
  }
  const boxes = humanoidHitboxes(crouch);
  let best: { t: number; zone: HitZone } | null = null;
  for (const zone of ['head', 'body', 'legs'] as HitZone[]) {
    const t = rayYawBox(ox, oy, oz, dx, dy, dz, px, py, pz, yaw, boxes[zone], maxDist);
    if (t >= 0 && (!best || t < best.t)) best = { t, zone };
  }
  return best;
}
