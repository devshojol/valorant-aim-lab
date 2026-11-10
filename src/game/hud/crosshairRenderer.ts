import type { CrosshairLineSettings, CrosshairSettings } from '../../types';

export interface CrosshairErrors {
  /** Pixel spread caused by movement. */
  movementPx: number;
  /** Pixel spread caused by firing. */
  firingPx: number;
}

/**
 * Draw a Valorant-style crosshair into a 2D canvas (screen-space HUD).
 * `scale` maps crosshair "pixels" to device pixels (devicePixelRatio).
 */
export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  s: CrosshairSettings,
  cx: number,
  cy: number,
  scale: number,
  errors: CrosshairErrors = { movementPx: 0, firingPx: 0 },
) {
  const px = (v: number) => Math.round(v * scale);
  const ol = s.outlines ? Math.max(1, px(s.outlineThickness)) : 0;
  const rects: { x: number; y: number; w: number; h: number; a: number }[] = [];

  const lineGroup = (l: CrosshairLineSettings) => {
    if (!l.show || l.length <= 0 || l.thickness <= 0) return;
    let err = 0;
    if (s.dynamic) {
      if (l.movementError) err += errors.movementPx * l.movementMult;
      if (l.firingError) err += errors.firingPx * l.firingMult;
    }
    const t = Math.max(1, px(l.thickness));
    const len = Math.max(1, px(l.length));
    const off = px(l.offset + err);
    const half = Math.floor(t / 2);
    // top, bottom, left, right
    rects.push({ x: cx - half, y: cy - off - len, w: t, h: len, a: l.opacity });
    rects.push({ x: cx - half, y: cy + off + (t % 2 === 0 ? 0 : 1), w: t, h: len, a: l.opacity });
    rects.push({ x: cx - off - len, y: cy - half, w: len, h: t, a: l.opacity });
    rects.push({ x: cx + off + (t % 2 === 0 ? 0 : 1), y: cy - half, w: len, h: t, a: l.opacity });
  };

  if (s.centerDot) {
    const t = Math.max(1, px(s.centerDotThickness));
    const half = Math.floor(t / 2);
    rects.push({ x: cx - half, y: cy - half, w: t, h: t, a: s.centerDotOpacity });
  }
  lineGroup(s.inner);
  lineGroup(s.outer);

  if (ol > 0) {
    ctx.fillStyle = `rgba(0,0,0,${s.outlineOpacity})`;
    for (const r of rects) {
      if (r.a <= 0) continue;
      ctx.globalAlpha = Math.min(1, r.a + 0.2);
      ctx.fillRect(r.x - ol, r.y - ol, r.w + ol * 2, r.h + ol * 2);
    }
  }
  ctx.fillStyle = s.color;
  for (const r of rects) {
    if (r.a <= 0) continue;
    ctx.globalAlpha = r.a;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.globalAlpha = 1;
}

/** Serialize crosshair settings to a shareable code (base64 JSON). */
export function exportCrosshairCode(s: CrosshairSettings): string {
  const json = JSON.stringify({ v: 1, s });
  return 'TAL1-' + btoa(unescape(encodeURIComponent(json)));
}

export function importCrosshairCode(code: string): CrosshairSettings | null {
  try {
    const trimmed = code.trim();
    const body = trimmed.startsWith('TAL1-') ? trimmed.slice(5) : trimmed;
    const json = trimmed.startsWith('{') ? trimmed : decodeURIComponent(escape(atob(body)));
    const parsed = JSON.parse(json);
    const s = parsed.s ?? parsed;
    if (!s || typeof s.color !== 'string' || !s.inner || !s.outer) return null;
    return s as CrosshairSettings;
  } catch {
    return null;
  }
}
