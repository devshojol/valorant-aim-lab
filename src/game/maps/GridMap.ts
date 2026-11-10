/**
 * Grid-authored map geometry.
 *
 * Maps are authored on a grid of CELL-sized cells (1.5 m) by carving walkable space out of solid rock,
 * then greedily merged into a small number of boxes. The same box list drives
 * collision, line-of-sight, navigation and rendering, so what you see is exactly
 * what blocks bullets.
 */

import type { Vec3 } from '../../types';

/**
 * Size of one grid cell in metres. Every horizontal distance on every map comes from this, so
 * changing it scales all maps without touching their layouts (heights are separate). Was 2 m;
 * 1.5 m makes rooms, corridors and the gaps between cover 25% smaller.
 */
export const CELL = 1.5;

export interface CellShape {
  /** Solid from y0 to y1 (blocks). */
  solids: { y0: number; y1: number; kind: SolidKind }[];
  /** Height of walkable floor top (0 for ground). */
  floor: number;
  walkable: boolean;
}

export type SolidKind = 'wall' | 'crate' | 'crate-low' | 'stack' | 'pillar' | 'rail' | 'raised' | 'lintel';

export const WALL_HEIGHT = 6;
const RAISE_STEP = 0.4;

export function shapeOf(ch: string): CellShape {
  switch (ch) {
    case '#':
      return { solids: [{ y0: 0, y1: WALL_HEIGHT, kind: 'wall' }], floor: WALL_HEIGHT, walkable: false };
    case '.':
      return { solids: [], floor: 0, walkable: true };
    case 'c':
      return { solids: [{ y0: 0, y1: 1.3, kind: 'crate-low' }], floor: 1.3, walkable: false };
    case 'C':
      return { solids: [{ y0: 0, y1: 2.2, kind: 'crate' }], floor: 2.2, walkable: false };
    case 'D':
      return { solids: [{ y0: 0, y1: 3.3, kind: 'stack' }], floor: 3.3, walkable: false };
    case 'P':
      return { solids: [{ y0: 0, y1: WALL_HEIGHT, kind: 'pillar' }], floor: WALL_HEIGHT, walkable: false };
    case 'r':
      return {
        solids: [
          { y0: 0, y1: 2.4, kind: 'raised' },
          { y0: 2.4, y1: 3.45, kind: 'rail' },
        ],
        floor: 3.45,
        walkable: false,
      };
    case '=':
      return { solids: [{ y0: 3.6, y1: WALL_HEIGHT, kind: 'lintel' }], floor: 0, walkable: true };
    case 'w':
      // window: sill below, lintel above, open (see/shoot-through) gap between 1.1 m and 2.4 m
      return {
        solids: [
          { y0: 0, y1: 1.1, kind: 'wall' },
          { y0: 2.4, y1: WALL_HEIGHT, kind: 'lintel' },
        ],
        floor: 1.1,
        walkable: false,
      };
    default: {
      const n = Number(ch);
      if (n >= 1 && n <= 9) {
        const h = n * RAISE_STEP;
        return { solids: [{ y0: 0, y1: h, kind: 'raised' }], floor: h, walkable: true };
      }
      return { solids: [{ y0: 0, y1: WALL_HEIGHT, kind: 'wall' }], floor: WALL_HEIGHT, walkable: false };
    }
  }
}

export class GridBuilder {
  readonly cells: string[][];
  constructor(
    readonly cols: number,
    readonly rows: number,
    fill = '#',
  ) {
    this.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
  }
  /** Fill an inclusive cell rectangle. */
  rect(c0: number, r0: number, c1: number, r1: number, ch: string): this {
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
        if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) this.cells[r][c] = ch;
      }
    return this;
  }
  set(c: number, r: number, ch: string): this {
    return this.rect(c, r, c, r, ch);
  }
  toStrings(): string[] {
    return this.cells.map((row) => row.join(''));
  }
}

/** Converts between cell coordinates and world coordinates for a grid. */
export class GridSpace {
  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {}
  /** World X of cell column (fractional allowed; integer = cell center). */
  x(c: number): number {
    return (c - this.cols / 2) * CELL + CELL / 2;
  }
  /** World Z of cell row (row 0 is north / +Z). */
  z(r: number): number {
    return (this.rows / 2 - r) * CELL - CELL / 2;
  }
  col(x: number): number {
    return Math.floor(x / CELL + this.cols / 2);
  }
  row(z: number): number {
    return Math.floor(this.rows / 2 - z / CELL);
  }
  pos(c: number, r: number, y = 0): Vec3 {
    return [this.x(c), y, this.z(r)];
  }
}

export interface MergedRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  key: string;
}

/**
 * Greedy rectangle merge: groups equal keys into maximal rectangles.
 * `keyOf` returns null for cells that should be skipped.
 */
export function greedyMerge(cols: number, rows: number, keyOf: (c: number, r: number) => string | null): MergedRect[] {
  const used: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
  const out: MergedRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (used[r][c]) continue;
      const key = keyOf(c, r);
      if (key === null) continue;
      // extend right
      let c1 = c;
      while (c1 + 1 < cols && !used[r][c1 + 1] && keyOf(c1 + 1, r) === key) c1++;
      // extend down
      let r1 = r;
      outer: while (r1 + 1 < rows) {
        for (let cc = c; cc <= c1; cc++) {
          if (used[r1 + 1][cc] || keyOf(cc, r1 + 1) !== key) break outer;
        }
        r1++;
      }
      for (let rr = r; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) used[rr][cc] = true;
      out.push({ c0: c, r0: r, c1, r1, key });
    }
  }
  return out;
}
