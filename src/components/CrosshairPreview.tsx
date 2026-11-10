import { useEffect, useRef } from 'react';
import type { CrosshairSettings } from '../types';
import { drawCrosshair } from '../game/hud/crosshairRenderer';

/** Live crosshair preview rendered with the exact same code path as the in-game HUD. */
export function CrosshairPreview({
  settings,
  background = 'scene',
  className,
  movementPx = 0,
  firingPx = 0,
  zoom = 1,
}: {
  settings: CrosshairSettings;
  background?: 'scene' | 'dark' | 'light';
  className?: string;
  movementPx?: number;
  firingPx?: number;
  zoom?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    if (background === 'scene') {
      const g = ctx.createLinearGradient(0, 0, 0, c.height);
      g.addColorStop(0, '#9cc8ea');
      g.addColorStop(0.5, '#e9d7bf');
      g.addColorStop(0.5, '#cf9a74');
      g.addColorStop(1, '#8a6b55');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#d9c6a5';
      ctx.fillRect(c.width * 0.62, c.height * 0.18, c.width * 0.38, c.height * 0.64);
      ctx.fillStyle = '#a5794b';
      ctx.fillRect(c.width * 0.1, c.height * 0.55, c.width * 0.16, c.height * 0.2);
    } else {
      ctx.fillStyle = background === 'dark' ? '#0b1016' : '#e9e6df';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    drawCrosshair(ctx, settings, Math.floor(c.width / 2), Math.floor(c.height / 2), dpr * zoom, { movementPx, firingPx });
  }, [settings, background, movementPx, firingPx, zoom]);
  return <canvas ref={ref} className={className} style={{ imageRendering: 'pixelated' }} />;
}
