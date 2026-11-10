/**
 * Automatic enemy peek-spot finder.
 *
 * For a player spawn, scans every walkable cell that sits against tall cover (walls, crates,
 * stacks, pillars, ledges) and tests standing positions along the cover face. A candidate is
 * accepted when the bot is fully hidden at its anchor and becomes visible after a short strafe
 * along the cover (a real corner/box peek), it lies in front of the player and the distance is
 * sensible. The results are named after the nearest callout and written to JSON by
 * `tests/tools/gen-spots.test.ts`, so maps ship with deterministic, validated spots.
 */

import type { EnemySpot, SpawnPoint, Vec2 } from '../../types';
import { analysePeekLine, BOT_HEIGHT, BOT_RADIUS, isHumanoidVisible } from '../bots/perception/visibility';
import { STAND_EYE } from '../player/PlayerController';
import { CELL, shapeOf } from './GridMap';
import type { MapData } from './MapData';

export interface SpotCandidate {
  spot: EnemySpot;
  exposeAt: number;
  dist: number;
  score: number;
}

export interface FinderOptions {
  minDist: number;
  maxDist: number;
  /** Half-angle (degrees) of the cone in front of the spawn that spots must lie in. */
  fov: number;
  maxExpose: number;
  perSpawn: number;
  minSeparation: number;
}

const DEFAULTS: FinderOptions = { minDist: 7, maxDist: 38, fov: 62, maxExpose: 2.2, perSpawn: 4, minSeparation: 3.5 };

const DIRS: Vec2[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function coverLabel(ch: string): string {
  switch (ch) {
    case 'C':
    case 'c':
      return 'box';
    case 'D':
      return 'stack';
    case 'P':
      return 'pillar';
    case 'r':
      return 'ledge';
    default:
      return Number(ch) > 0 ? 'ledge' : 'corner';
  }
}

/** Candidates visible-on-peek from one spawn. */
export function findCandidates(data: MapData, spawn: SpawnPoint, opts: Partial<FinderOptions> = {}): SpotCandidate[] {
  const o = { ...DEFAULTS, ...opts };
  const { def, space, world } = data;
  const grid = def.grid;
  const rows = grid.length;
  const cols = grid[0].length;
  const eye: [number, number, number] = [spawn.pos[0], spawn.pos[1] + STAND_EYE, spawn.pos[2]];
  const yaw = (spawn.yaw * Math.PI) / 180;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const cosFov = Math.cos((o.fov * Math.PI) / 180);
  const out: SpotCandidate[] = [];

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const here = shapeOf(grid[r][c]);
      if (!here.walkable) continue;
      // enemies peek from the contested map, not from inside a spawn room
      if (def.zoneOf(c, r).includes('spawn')) continue;
      const h = here.floor;
      const cx = space.x(c);
      const cz = space.z(r);
      const dx0 = cx - eye[0];
      const dz0 = cz - eye[2];
      const d0 = Math.hypot(dx0, dz0);
      if (d0 < o.minDist - 2 || d0 > o.maxDist + 2) continue;
      if ((dx0 * fx + dz0 * fz) / (d0 || 1) < cosFov) continue;

      for (const n of DIRS) {
        // n points from the cell towards the neighbour that provides cover (+x = east, +z = north)
        const nc = c + n[0];
        const nr = r - n[1];
        const nb = grid[nr]?.[nc];
        if (nb === undefined) continue;
        const ns = shapeOf(nb);
        const coverTop = ns.walkable ? ns.floor : Math.max(...ns.solids.map((s) => s.y1));
        if (coverTop < h + 2.0) continue;
        const inset = CELL / 2 - BOT_RADIUS - 0.14;
        const bx = cx + n[0] * inset;
        const bz = cz + n[1] * inset;
        const t: Vec2 = [-n[1], n[0]];
        for (const off of [-0.65, -0.2, 0.25, 0.7]) {
          const ax = bx + t[0] * off;
          const az = bz + t[1] * off;
          if (world.overlap(ax, h + 0.05, az, BOT_RADIUS, BOT_HEIGHT)) continue;
          const dist = Math.hypot(ax - eye[0], az - eye[2]);
          if (dist < o.minDist || dist > o.maxDist) continue;
          // must be completely hidden at the anchor
          if (isHumanoidVisible(world, eye[0], eye[1], eye[2], ax, h, az, 0)) continue;
          for (const sgn of [1, -1]) {
            const dir: Vec2 = [t[0] * sgn, t[1] * sgn];
            const visAt = (d: number) => isHumanoidVisible(world, eye[0], eye[1], eye[2], ax + dir[0] * d, h, az + dir[1] * d, 0);
            const free = (d: number) => !world.overlap(ax + dir[0] * d, h + 0.05, az + dir[1] * d, BOT_RADIUS, BOT_HEIGHT);
            // coarse scan for first exposure, then refine
            let exposeAt: number | null = null;
            let prev = 0;
            for (let d = 0.25; d <= o.maxExpose + 1e-6; d += 0.25) {
              if (!free(d)) break;
              if (visAt(d)) {
                exposeAt = d;
                for (let f = prev + 0.05; f < d; f += 0.05) {
                  if (visAt(f)) {
                    exposeAt = f;
                    break;
                  }
                }
                break;
              }
              prev = d;
            }
            if (exposeAt === null || exposeAt < 0.08) continue;
            let reach = exposeAt;
            while (reach < exposeAt + 2.5 && free(reach + 0.1)) reach += 0.1;
            if (reach < exposeAt + 0.8) continue;
            const info = { exposeAt, reach };
            // prefer tight corner peeks at mid-range distances
            const score = (o.maxExpose - info.exposeAt) * 2 + (1 - Math.abs(dist - 20) / 25) + (coverTop - h > 3 ? 0.3 : 0);
            out.push({
              spot: {
                id: '',
                name: coverLabel(nb),
                cover: [round(ax), h, round(az)],
                peekDir: dir,
                maxPeek: Math.min(5, round(info.reach)),
              },
              exposeAt: info.exposeAt,
              dist,
              score,
            });
          }
        }
      }
    }
  }
  return out;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Pick diverse spots for a set of spawns (union of per-spawn picks), named by nearest callout. */
export function pickSpots(data: MapData, spawns: SpawnPoint[], idPrefix: string, opts: Partial<FinderOptions> = {}): EnemySpot[] {
  const o = { ...DEFAULTS, ...opts };
  const chosen: EnemySpot[] = [];
  const far = (s: EnemySpot) => chosen.every((x) => Math.hypot(x.cover[0] - s.cover[0], x.cover[2] - s.cover[2]) >= o.minSeparation);
  // A spot that works from every spawn of this side is worth much more than one that works from a single spawn.
  const worksFromAll = (s: EnemySpot) =>
    spawns.every((sp) => {
      const eye: [number, number, number] = [sp.pos[0], sp.pos[1] + STAND_EYE, sp.pos[2]];
      const info = analysePeekLine(data.world, eye, s.cover[0], s.cover[1], s.cover[2], s.peekDir[0], s.peekDir[1], s.maxPeek);
      return info.hideAt !== null && info.exposeAt !== null;
    });
  for (const sp of spawns) {
    const cands = findCandidates(data, sp, o);
    for (const c of cands) if (spawns.length > 1 && worksFromAll(c.spot)) c.score += 3;
    cands.sort((a, b) => b.score - a.score);
    let n = 0;
    for (const cnd of cands) {
      if (n >= o.perSpawn) break;
      if (!far(cnd.spot)) continue;
      chosen.push(cnd.spot);
      n++;
    }
  }
  // name + id
  const { def, space } = data;
  const used = new Map<string, number>();
  const ref = spawns[0];
  const refYaw = ref ? (ref.yaw * Math.PI) / 180 : 0;
  return chosen.map((s, i) => {
    let best = def.callouts[0];
    let bd = Infinity;
    for (const c of def.callouts) {
      if (c.name.includes('Spawn')) continue;
      const d = Math.hypot(space.x(c.c) - s.cover[0], space.z(c.r) - s.cover[2]);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    let side = '';
    if (ref) {
      let a = Math.atan2(s.cover[0] - ref.pos[0], s.cover[2] - ref.pos[2]) - refYaw;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      side = a < -0.2 ? ' (left)' : a > 0.2 ? ' (right)' : '';
    }
    let name = `${best.name} ${s.name}${side}`;
    const k = (used.get(name) ?? 0) + 1;
    used.set(name, k);
    if (k > 1) name += ` ${k}`;
    return { ...s, id: `${idPrefix}-${i + 1}`, name };
  });
}
