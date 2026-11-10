/**
 * HUD minimap, drawn on the 2D overlay canvas.
 *
 * The map is pre-rendered once from the grid (walkable floors, raised floors, cover) and then drawn
 * each frame rotated so the player's facing is always "up". Enemies within `enemyRange` metres are
 * always shown, even through walls (a training aid); enemies the player can actually see are drawn
 * larger and brighter.
 */
import { CELL, shapeOf } from '../maps/GridMap';
import type { MapData } from '../maps/MapData';

/** Pixels per grid cell in the pre-rendered image. */
const PPC = 10;

export interface MinimapEnemy {
  x: number;
  z: number;
  alive: boolean;
  visible: boolean;
}

export interface MinimapOptions {
  /** Panel size in CSS pixels. */
  size: number;
  /** World metres from the centre to the panel edge. */
  viewRange: number;
  /** Enemies closer than this (metres) are always drawn. */
  enemyRange: number;
  /** Horizontal field of view (radians) for the view cone. */
  fov: number;
}

export class Minimap {
  private readonly img: HTMLCanvasElement;
  private readonly sites: { letter: string; x: number; z: number }[];

  constructor(private readonly map: MapData) {
    const { def, space } = map;
    const rows = def.grid.length;
    const cols = def.grid[0].length;
    this.img = document.createElement('canvas');
    this.img.width = cols * PPC;
    this.img.height = rows * PPC;
    const g = this.img.getContext('2d')!;
    const walk = (c: number, r: number) => r >= 0 && r < rows && c >= 0 && c < cols && shapeOf(def.grid[r][c]).walkable;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const ch = def.grid[r][c];
        const s = shapeOf(ch);
        let fill: string | null = null;
        if (s.walkable) fill = s.floor > 0.01 ? `rgba(215,222,232,${0.62 + Math.min(0.25, s.floor * 0.08)})` : 'rgba(188,196,208,0.55)';
        else if (ch === 'c' || ch === 'C' || ch === 'D') fill = 'rgba(95,104,118,0.95)';
        else if (ch === 'w' || ch === 'r') fill = 'rgba(130,140,155,0.9)';
        else if (ch === 'P') fill = 'rgba(70,78,90,0.95)';
        if (!fill) continue;
        g.fillStyle = fill;
        g.fillRect(c * PPC, r * PPC, PPC, PPC);
      }
    // outline the walkable area so corridors read clearly
    g.strokeStyle = 'rgba(245,248,252,0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (walk(c, r) || def.grid[r][c] === 'c' || def.grid[r][c] === 'C' || def.grid[r][c] === 'D') continue;
        const x = c * PPC;
        const y = r * PPC;
        if (walk(c, r - 1)) g.moveTo(x, y), g.lineTo(x + PPC, y);
        if (walk(c, r + 1)) g.moveTo(x, y + PPC), g.lineTo(x + PPC, y + PPC);
        if (walk(c - 1, r)) g.moveTo(x, y), g.lineTo(x, y + PPC);
        if (walk(c + 1, r)) g.moveTo(x + PPC, y), g.lineTo(x + PPC, y + PPC);
      }
    g.stroke();
    this.sites = (def.siteMarks ?? []).map((m) => ({ letter: m.letter, x: space.x(m.c), z: space.z(m.r) }));
  }

  draw(
    ctx: CanvasRenderingContext2D,
    dpr: number,
    left: number,
    top: number,
    player: { x: number; z: number; yaw: number; alive: boolean },
    enemies: MinimapEnemy[],
    o: MinimapOptions,
  ) {
    const size = o.size * dpr;
    const x0 = left * dpr;
    const y0 = top * dpr;
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const pxPerM = size / 2 / o.viewRange;
    const rows = this.map.def.grid.length;
    const cols = this.map.def.grid[0].length;
    const cos = Math.cos(player.yaw);
    const sin = Math.sin(player.yaw);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - player.x;
      const dz = z - player.z;
      return [cx + (dx * cos - dz * sin) * pxPerM, cy - (dx * sin + dz * cos) * pxPerM];
    };

    ctx.save();
    // panel
    const rad = 10 * dpr;
    ctx.beginPath();
    ctx.roundRect(x0, y0, size, size, rad);
    ctx.fillStyle = 'rgba(12,16,22,0.62)';
    ctx.fill();
    ctx.clip();

    // map image: image u = (x/CELL + cols/2)·PPC, v = (rows/2 − z/CELL)·PPC; rotate so facing is up
    const u = (player.x / CELL + cols / 2) * PPC;
    const v = (rows / 2 - player.z / CELL) * PPC;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-player.yaw);
    const k = pxPerM / (PPC / CELL);
    ctx.scale(k, k);
    ctx.translate(-u, -v);
    ctx.drawImage(this.img, 0, 0);
    ctx.restore();

    // site letters (kept upright)
    ctx.font = `700 ${Math.round(15 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of this.sites) {
      const [sx, sy] = toScreen(s.x, s.z);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(s.letter, sx, sy);
    }

    // view cone
    if (player.alive) {
      const half = o.fov / 2;
      const r = size * 0.42;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.28)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, -Math.PI / 2 - half, -Math.PI / 2 + half);
      ctx.closePath();
      ctx.fill();
    }

    // enemies within range (always), visible ones emphasised
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - player.x, e.z - player.z);
      if (d > o.enemyRange) continue;
      const [sx, sy] = toScreen(e.x, e.z);
      const r = (e.visible ? 5.5 : 4.2) * dpr;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = e.visible ? 'rgba(255,70,85,1)' : 'rgba(255,70,85,0.72)';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = e.visible ? 'rgba(255,235,235,0.95)' : 'rgba(40,0,6,0.85)';
      ctx.stroke();
    }

    // player arrow
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -8 * dpr);
    ctx.lineTo(6 * dpr, 6 * dpr);
    ctx.lineTo(0, 3 * dpr);
    ctx.lineTo(-6 * dpr, 6 * dpr);
    ctx.closePath();
    ctx.fillStyle = player.alive ? '#5ee0c8' : 'rgba(200,200,200,0.6)';
    ctx.fill();
    ctx.lineWidth = 1.2 * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.stroke();
    ctx.restore();

    // frame + enemy range ring hint
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x0 + 0.5 * dpr, y0 + 0.5 * dpr, size - dpr, size - dpr, rad);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
    if (o.enemyRange < o.viewRange) {
      ctx.beginPath();
      ctx.arc(cx, cy, o.enemyRange * pxPerM, 0, Math.PI * 2);
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(255,70,85,0.25)';
      ctx.stroke();
    }
    ctx.restore();
  }
}
