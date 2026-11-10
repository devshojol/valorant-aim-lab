/**
 * Grid navigation for bots: A* over the map's walkable cells with step-height rules,
 * one-way drops, diagonal corner checks and line-of-walk path smoothing.
 */

import type { GridSpace } from '../../maps/GridMap';
import type { NavGrid } from '../../maps/MapData';

export type NavPoint = [number, number];

const STEP = 0.45;
const MAX_DROP = 2.6;

function canTraverse(nav: NavGrid, a: number, b: number, orthogonal: boolean): boolean {
  if (!nav.walkable[b]) return false;
  const dh = nav.height[b] - nav.height[a];
  if (dh > STEP) return false;
  if (dh < -STEP) return orthogonal && -dh <= MAX_DROP;
  return true;
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastI = this.items.pop()!;
    const lastP = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastI;
      this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}

export function nearestWalkable(nav: NavGrid, c: number, r: number, maxRadius = 3): number {
  const inb = (cc: number, rr: number) => cc >= 0 && rr >= 0 && cc < nav.cols && rr < nav.rows;
  if (inb(c, r) && nav.walkable[r * nav.cols + c]) return r * nav.cols + c;
  for (let rad = 1; rad <= maxRadius; rad++) {
    let best = -1;
    let bestD = Infinity;
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (!inb(cc, rr)) continue;
        const idx = rr * nav.cols + cc;
        if (!nav.walkable[idx]) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) {
          bestD = d;
          best = idx;
        }
      }
    if (best >= 0) return best;
  }
  return -1;
}

export function findPath(
  nav: NavGrid,
  space: GridSpace,
  sx: number,
  sz: number,
  tx: number,
  tz: number,
): NavPoint[] | null {
  const cols = nav.cols;
  const start = nearestWalkable(nav, space.col(sx), space.row(sz));
  const goal = nearestWalkable(nav, space.col(tx), space.row(tz));
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [[tx, tz]];

  const n = cols * nav.rows;
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gc = goal % cols;
  const gr = (goal / cols) | 0;
  const h = (i: number) => {
    const dc = Math.abs((i % cols) - gc);
    const dr = Math.abs(((i / cols) | 0) - gr);
    return Math.max(dc, dr) + 0.414 * Math.min(dc, dr);
  };
  const open = new MinHeap();
  g[start] = 0;
  open.push(start, h(start));
  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [-1, -1, 1.414],
  ];
  let found = false;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const c = cur % cols;
    const r = (cur / cols) | 0;
    for (const [dc, dr, cost] of dirs) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= nav.rows) continue;
      const ni = nr * cols + nc;
      if (closed[ni]) continue;
      const ortho = dc === 0 || dr === 0;
      if (!canTraverse(nav, cur, ni, ortho)) continue;
      if (!ortho) {
        // no corner cutting
        const a = r * cols + nc;
        const b = nr * cols + c;
        if (!canTraverse(nav, cur, a, true) || !canTraverse(nav, cur, b, true)) continue;
        if (Math.abs(nav.height[a] - nav.height[cur]) > 0.01 || Math.abs(nav.height[b] - nav.height[cur]) > 0.01) continue;
      }
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ni, ng + h(ni));
      }
    }
  }
  if (!found) return null;

  const cells: number[] = [];
  for (let i = goal; i !== -1; i = came[i]) cells.push(i);
  cells.reverse();
  const pts: NavPoint[] = cells.map((i) => [space.x(i % cols), space.z((i / cols) | 0)]);
  pts[0] = [sx, sz];
  pts[pts.length - 1] = [tx, tz];
  return smoothPath(nav, space, pts).slice(1);
}

/** True when a straight walk from a to b stays on walkable, level-compatible cells with clearance. */
function walkClear(nav: NavGrid, space: GridSpace, a: NavPoint, b: NavPoint, clearance = 0.4): boolean {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return true;
  const px = -dz / len;
  const pz = dx / len;
  const steps = Math.ceil(len / 0.4);
  let prevH: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a[0] + dx * t;
    const z = a[1] + dz * t;
    for (const off of [0, clearance, -clearance]) {
      const c = space.col(x + px * off);
      const r = space.row(z + pz * off);
      if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) return false;
      const idx = r * nav.cols + c;
      if (!nav.walkable[idx]) return false;
      if (off === 0) {
        const hh = nav.height[idx];
        if (prevH !== null && Math.abs(hh - prevH) > STEP) return false;
        prevH = hh;
      }
    }
  }
  return true;
}

function smoothPath(nav: NavGrid, space: GridSpace, pts: NavPoint[]): NavPoint[] {
  if (pts.length <= 2) return pts;
  const out: NavPoint[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !walkClear(nav, space, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
