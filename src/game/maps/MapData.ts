import type { MapLocation, Vec3 } from '../../types';
import { CollisionWorld, COL_ALL, COL_BULLET, COL_MOVE, COL_SIGHT } from '../physics/CollisionWorld';
import { CELL, GridSpace, greedyMerge, shapeOf, WALL_HEIGHT, type SolidKind } from './GridMap';

export interface Callout {
  name: string;
  c: number;
  r: number;
}

export interface MapPalette {
  sky: [string, string];
  fog: string;
  zones: Record<string, { wall: string; floor: string; accent: string }>;
}

export interface MapDefinition {
  id: string;
  name: string;
  inspiredBy: string;
  theme: string;
  description: string;
  grid: string[];
  zoneOf: (c: number, r: number) => string;
  callouts: Callout[];
  locations: MapLocation[];
  palette: MapPalette;
  /** Site letters painted on the ground. */
  siteMarks: { letter: string; c: number; r: number }[];
  /** Enemy spots were placed by hand (otherwise they come from the generated spot table). */
  handAuthoredSpots?: boolean;
}

export interface MapBox {
  min: Vec3;
  max: Vec3;
  kind: SolidKind | 'ground';
  zone: string;
}

export interface MapFloor {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  zone: string;
}

export interface NavGrid {
  cols: number;
  rows: number;
  walkable: Uint8Array;
  height: Float32Array;
}

export interface MapData {
  def: MapDefinition;
  space: GridSpace;
  /** Top of the solid in each cell (0 for open ground), row-major. */
  cellTop: Float32Array;
  boxes: MapBox[];
  floors: MapFloor[];
  nav: NavGrid;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  world: CollisionWorld;
}

export function buildMapData(def: MapDefinition): MapData {
  const rows = def.grid.length;
  const cols = def.grid[0].length;
  for (const row of def.grid) {
    if (row.length !== cols) throw new Error(`Map ${def.id}: ragged grid row`);
  }
  const space = new GridSpace(cols, rows);
  const ch = (c: number, r: number) => def.grid[r][c];
  const dress = dressMap(def, space);

  const boxes: MapBox[] = [];
  // Solids: merge by (kind, y0, y1, zone)
  const solidKey = (c: number, r: number, i: number): string | null => {
    const g = ch(c, r);
    if (g === '.' && i === 0 && dress.arches.has(r * cols + c)) return `lintel|3.6|${WALL_HEIGHT}|${def.zoneOf(c, r)}`;
    const s = shapeOf(g).solids[i];
    if (!s) return null;
    // Rock masses get a stepped skyline (never lower than a normal wall, so sight lines don't change).
    const y1 = g === '#' ? dress.wallTop[r * cols + c] : s.y1;
    return `${s.kind}|${s.y0}|${y1}|${def.zoneOf(c, r)}`;
  };
  for (let layer = 0; layer < 2; layer++) {
    const rects = greedyMerge(cols, rows, (c, r) => solidKey(c, r, layer));
    for (const rc of rects) {
      const [kind, y0, y1, zone] = rc.key.split('|');
      const x0 = space.x(rc.c0) - CELL / 2;
      const x1 = space.x(rc.c1) + CELL / 2;
      const zTop = space.z(rc.r0) + CELL / 2;
      const zBot = space.z(rc.r1) - CELL / 2;
      boxes.push({
        min: [x0, Number(y0), zBot],
        max: [x1, Number(y1), zTop],
        kind: kind as SolidKind,
        zone,
      });
    }
  }

  // Corridor props: small crates against the walls (sub-cell, so the cell stays walkable).
  for (const pr of dress.props) boxes.push(pr);

  // Visible ground: walkable ground-level cells, merged by zone.
  const floorRects = greedyMerge(cols, rows, (c, r) => {
    const g = ch(c, r);
    const sh = shapeOf(g);
    if (sh.walkable && sh.floor === 0) return def.zoneOf(c, r);
    if (g === 'c' || g === 'C' || g === 'D') return def.zoneOf(c, r); // ground under crates (edges visible)
    return null;
  });
  const floors: MapFloor[] = floorRects.map((rc) => ({
    minX: space.x(rc.c0) - CELL / 2,
    maxX: space.x(rc.c1) + CELL / 2,
    maxZ: space.z(rc.r0) + CELL / 2,
    minZ: space.z(rc.r1) - CELL / 2,
    zone: rc.key,
  }));

  // Navigation grid.
  const walkable = new Uint8Array(cols * rows);
  const height = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const sh = shapeOf(ch(c, r));
      walkable[r * cols + c] = sh.walkable ? 1 : 0;
      height[r * cols + c] = sh.floor;
    }

  const bounds = {
    minX: space.x(0) - CELL / 2,
    maxX: space.x(cols - 1) + CELL / 2,
    minZ: space.z(rows - 1) - CELL / 2,
    maxZ: space.z(0) + CELL / 2,
  };

  // Collision world: ground slab + every solid.
  const world = new CollisionWorld();
  world.add({
    minX: bounds.minX,
    minY: -1,
    minZ: bounds.minZ,
    maxX: bounds.maxX,
    maxY: 0,
    maxZ: bounds.maxZ,
    flags: COL_ALL,
    surface: 'ground',
  });
  for (const b of boxes) {
    world.add({
      minX: b.min[0],
      minY: b.min[1],
      minZ: b.min[2],
      maxX: b.max[0],
      maxY: b.max[1],
      maxZ: b.max[2],
      flags: COL_MOVE | COL_BULLET | COL_SIGHT,
      surface: b.kind,
    });
  }
  // Invisible ceiling/kill box above the walls keeps jumps inside the playable area.
  world.add({
    minX: bounds.minX,
    minY: 12,
    minZ: bounds.minZ,
    maxX: bounds.maxX,
    maxY: 13,
    maxZ: bounds.maxZ,
    flags: COL_MOVE,
    surface: 'ceiling',
  });

  const cellTop = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const g = ch(c, r);
      const sh = shapeOf(g);
      cellTop[r * cols + c] = g === '#' ? dress.wallTop[r * cols + c] : sh.solids.length ? Math.max(...sh.solids.map((x) => x.y1)) : 0;
    }

  return { def, space, cellTop, boxes, floors, nav: { cols, rows, walkable, height }, bounds, world };
}

/** Deterministic 32-bit hash → [0, 1). */
function hash01(a: number, b: number, seed: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Generic dressing applied to every grid map so long corridors don't read as empty tunnels:
 *  - a stepped skyline: rock masses rise to 6 / 7.2 / 8.4 m in 4×4-cell blocks,
 *  - overhead arches (lintels 3.6 m and up, walkable underneath) every few cells along long,
 *    narrow corridors,
 *  - small crates against corridor walls (sub-cell, away from spawns and enemy peek lines).
 * None of it changes ground-level sight lines through open space or which cells are walkable.
 */
export function dressMap(def: MapDefinition, space: GridSpace): { wallTop: Float32Array; arches: Set<number>; props: MapBox[] } {
  const rows = def.grid.length;
  const cols = def.grid[0].length;
  const seed = [...def.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) | 0;
  const at = (c: number, r: number) => (r >= 0 && r < rows && c >= 0 && c < cols ? def.grid[r][c] : '#');
  const plain = (c: number, r: number) => at(c, r) === '.';

  const wallTop = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const h = hash01(Math.floor(c / 4), Math.floor(r / 4), seed);
      wallTop[r * cols + c] = h < 0.5 ? WALL_HEIGHT : h < 0.78 ? WALL_HEIGHT + 1.2 : WALL_HEIGHT + 2.4;
    }

  // walkable run lengths through each cell
  const walk = (c: number, r: number) => shapeOf(at(c, r)).walkable;
  const runX = new Int16Array(cols * rows);
  const runZ = new Int16Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!walk(c, r)) {
        c++;
        continue;
      }
      let e = c;
      while (e + 1 < cols && walk(e + 1, r)) e++;
      for (let k = c; k <= e; k++) runX[r * cols + k] = e - c + 1;
      c = e + 1;
    }
  }
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (!walk(c, r)) {
        r++;
        continue;
      }
      let e = r;
      while (e + 1 < rows && walk(c, e + 1)) e++;
      for (let k = r; k <= e; k++) runZ[k * cols + c] = e - r + 1;
      r = e + 1;
    }
  }
  const NARROW = 4;
  const LONG = 9;
  const corridorZ = (c: number, r: number) => plain(c, r) && runX[r * cols + c] <= NARROW && runZ[r * cols + c] >= LONG;
  const corridorX = (c: number, r: number) => plain(c, r) && runZ[r * cols + c] <= NARROW && runX[r * cols + c] >= LONG;

  // keep clear of spawns and enemy peek lines
  const avoid = new Uint8Array(cols * rows);
  const mark = (x: number, z: number, rad: number) => {
    const c0 = space.col(x - rad);
    const c1 = space.col(x + rad);
    const r0 = space.row(z + rad);
    const r1 = space.row(z - rad);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r >= 0 && r < rows && c >= 0 && c < cols) avoid[r * cols + c] = 1;
  };
  for (const loc of def.locations)
    for (const side of [loc.sides.attack, loc.sides.defend]) {
      for (const sp of side.playerSpawns) mark(sp.pos[0], sp.pos[2], 2.5);
      for (const e of side.enemySpots)
        for (let t = 0; t <= 1.0001; t += 0.25) mark(e.cover[0] + e.peekDir[0] * e.maxPeek * t, e.cover[2] + e.peekDir[1] * e.maxPeek * t, 1.6);
    }

  const arches = new Set<number>();
  const props: MapBox[] = [];
  const spanZ = (c: number, r: number) => {
    // the full horizontal run through (c, r), if it's a wall-to-wall corridor cross-section
    let a = c;
    while (plain(a - 1, r)) a--;
    let b = c;
    while (plain(b + 1, r)) b++;
    return at(a - 1, r) === '#' && at(b + 1, r) === '#' ? [a, b] : null;
  };
  const spanX = (c: number, r: number) => {
    let a = r;
    while (plain(c, a - 1)) a--;
    let b = r;
    while (plain(c, b + 1)) b++;
    return at(c, a - 1) === '#' && at(c, b + 1) === '#' ? [a, b] : null;
  };
  for (let r = 1; r < rows - 1; r++)
    for (let c = 1; c < cols - 1; c++) {
      if (corridorZ(c, r) && r % 5 === 2 && plain(c, r - 2) && plain(c, r + 2)) {
        const sp = spanZ(c, r);
        if (sp && c === sp[0]) for (let k = sp[0]; k <= sp[1]; k++) arches.add(r * cols + k);
      }
      if (corridorX(c, r) && c % 5 === 2 && plain(c - 2, r) && plain(c + 2, r)) {
        const sp = spanX(c, r);
        if (sp && r === sp[0]) for (let k = sp[0]; k <= sp[1]; k++) arches.add(k * cols + c);
      }
    }

  // props: one crate against a wall every 7 cells along long corridors, alternating sides
  const zone = (c: number, r: number) => def.zoneOf(c, r);
  const crate = (cx: number, cz: number, alongX: boolean, sideSign: number, c: number, r: number) => {
    const half = CELL / 2;
    const depth = 0.55;
    const len = 0.95 + hash01(c, r, seed + 3) * 0.35;
    const h = 0.75 + hash01(r, c, seed + 5) * 0.4;
    if (alongX) {
      // corridor runs along X; wall is at z = cz + sideSign·half
      const zWall = cz + sideSign * half;
      const z0 = sideSign > 0 ? zWall - depth : zWall;
      const z1 = sideSign > 0 ? zWall : zWall + depth;
      props.push({ min: [cx - len / 2, 0, z0], max: [cx + len / 2, h, z1], kind: 'crate-low', zone: zone(c, r) });
    } else {
      const xWall = cx + sideSign * half;
      const x0 = sideSign > 0 ? xWall - depth : xWall;
      const x1 = sideSign > 0 ? xWall : xWall + depth;
      props.push({ min: [x0, 0, cz - len / 2], max: [x1, h, cz + len / 2], kind: 'crate-low', zone: zone(c, r) });
    }
  };
  for (let r = 2; r < rows - 2; r++)
    for (let c = 2; c < cols - 2; c++) {
      const i = r * cols + c;
      if (avoid[i] || arches.has(i)) continue;
      if (corridorZ(c, r) && runX[i] >= 2 && r % 7 === 4) {
        const sp = spanZ(c, r);
        if (!sp) continue;
        const left = Math.floor(r / 7) % 2 === 0;
        const cell = left ? sp[0] : sp[1];
        if (c !== cell || !plain(c, r - 1) || !plain(c, r + 1)) continue;
        crate(space.x(c), space.z(r), false, left ? -1 : 1, c, r);
      } else if (corridorX(c, r) && runZ[i] >= 2 && c % 7 === 4) {
        const sp = spanX(c, r);
        if (!sp) continue;
        const top = Math.floor(c / 7) % 2 === 0;
        const cell = top ? sp[0] : sp[1];
        if (r !== cell || !plain(c - 1, r) || !plain(c + 1, r)) continue;
        // row index grows southwards (−Z): the wall above the top cell is at +Z
        crate(space.x(c), space.z(r), true, top ? 1 : -1, c, r);
      }
    }
  return { wallTop, arches, props };
}

/** Find a location by id, falling back to the first one. */
export function findLocation(def: MapDefinition, id: string): MapLocation {
  return def.locations.find((l) => l.id === id) ?? def.locations[0];
}
