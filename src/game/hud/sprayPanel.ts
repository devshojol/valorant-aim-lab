/** Live plot of the current spray, drawn on the 2D overlay (no GPU cost). */
import type { SprayPoint, SprayResult, SpraySummary, Vec2 } from '../../types';
import { TIGHT_DEG } from '../practice/SprayTrainer';

const W = 230;
const H = 318;
const PX_PER_DEG = 32;

export interface SprayPanelState {
  weaponName: string;
  /** The weapon's recoil pattern for one magazine: where bullets go with no control. */
  pattern: Vec2[];
  live: SprayPoint[] | null;
  last: SprayResult | null;
  summary: SpraySummary | undefined;
}

export function drawSprayPanel(ctx: CanvasRenderingContext2D, dpr: number, canvasW: number, canvasH: number, s: SprayPanelState) {
  const x0 = canvasW / dpr - W - 14;
  const y0 = Math.max(60, (canvasH / dpr - H) / 2);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(x0, y0);

  ctx.fillStyle = 'rgba(8,12,17,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`SPRAY CONTROL · ${s.weaponName.toUpperCase()}`, 10, 9);

  // plot area: the first-shot point sits low so the uncontrolled climb fits above it
  const px0 = 0;
  const py0 = 28;
  const pw = W;
  const ph = 214;
  const ox = px0 + pw / 2;
  const oy = py0 + ph - 34;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px0 + 1, py0, pw - 2, ph);
  ctx.clip();
  const X = (deg: number) => ox + deg * PX_PER_DEG;
  const Y = (deg: number) => oy - deg * PX_PER_DEG;

  // target: tight ring and aim cross
  ctx.strokeStyle = 'rgba(0,255,123,0.5)';
  ctx.beginPath();
  ctx.arc(ox, oy, TIGHT_DEG * PX_PER_DEG, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.moveTo(ox - 8, oy);
  ctx.lineTo(ox + 8, oy);
  ctx.moveTo(ox, oy - 8);
  ctx.lineTo(ox, oy + 8);
  ctx.stroke();

  // where the bullets go if the mouse is held still
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  s.pattern.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('no control', ox + 54, py0 + 6);

  const points = s.live ?? s.last?.points ?? null;
  if (points && points.length) {
    // the controlled part: centre of the spread cone
    ctx.strokeStyle = 'rgba(90,190,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(X(p.control[0]), Y(p.control[1])) : ctx.moveTo(X(p.control[0]), Y(p.control[1]))));
    ctx.stroke();
    // the bullets themselves (control + random spread)
    for (const p of points) {
      const e = Math.hypot(p.bullet[0], p.bullet[1]);
      ctx.fillStyle = e <= TIGHT_DEG ? '#00ff7b' : e <= TIGHT_DEG * 2.5 ? '#ffd84a' : '#ff4655';
      ctx.beginPath();
      ctx.arc(X(p.bullet[0]), Y(p.bullet[1]), 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // text block
  let ty = py0 + ph + 8;
  const line = (text: string, color = 'rgba(255,255,255,0.78)', font = '12px system-ui, sans-serif') => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(text, 10, ty);
    ty += 17;
  };
  if (s.live) line(`${s.live.length} bullets…`);
  else if (s.last) {
    line(`Score ${s.last.score}`, '#00ff7b', '700 15px system-ui, sans-serif');
    ty += 2;
    line(`${s.last.bullets} bullets · avg ${s.last.avgErrorDeg.toFixed(2)}° off · ${s.last.tightPct}% tight`);
  } else {
    line('Hold fire at a wall and pull the');
    line('mouse to keep the blue line in the ring.');
  }
  if (s.summary && s.summary.sprays > 0) line(`Session: ${s.summary.sprays} sprays · avg ${Math.round(s.summary.avgScore)} · best ${s.summary.bestScore}`, 'rgba(255,255,255,0.5)', '11px system-ui, sans-serif');
  ctx.restore();
}
