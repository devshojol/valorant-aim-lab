/**
 * Procedural, original textures drawn on canvases at load time (no external assets).
 */
import { DynamicTexture, Texture, type Scene } from './babylon';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex: string, f: number, alpha = 1): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgba(${c(r)},${c(g)},${c(b)},${alpha})`;
}

function makeTexture(
  scene: Scene,
  name: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  hasAlpha = false,
  wrap = true,
): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  draw(ctx, size);
  tex.update(true);
  tex.hasAlpha = hasAlpha;
  tex.wrapU = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, s: number, base: string, count: number, r: () => number, amp = 0.08) {
  for (let i = 0; i < count; i++) {
    const x = r() * s;
    const y = r() * s;
    const sz = 1 + r() * 3;
    ctx.fillStyle = shade(base, (r() - 0.5) * 2 * amp, 0.5);
    ctx.fillRect(x, y, sz, sz);
  }
}

/** Plaster wall: v spans the full wall height, so the baseboard sits at the canvas bottom. */
export function wallTexture(scene: Scene, base: string, accent: string, seed: number) {
  return makeTexture(scene, `wall-${seed}`, 512, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    // soft plaster blotches
    for (let i = 0; i < 70; i++) {
      const x = r() * s;
      const y = r() * s;
      const rad = 20 + r() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, shade(base, (r() - 0.5) * 0.16, 0.45));
      g.addColorStop(1, shade(base, 0, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    speckle(ctx, s, base, 2600, r, 0.1);
    // block seams
    ctx.strokeStyle = shade(base, -0.12, 0.35);
    ctx.lineWidth = 2;
    for (let y = s * 0.14; y < s * 0.9; y += s * 0.19) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    // top trim band
    ctx.fillStyle = shade(base, -0.18);
    ctx.fillRect(0, 0, s, s * 0.035);
    ctx.fillStyle = shade(accent, -0.05, 0.9);
    ctx.fillRect(0, s * 0.035, s, s * 0.012);
    // baseboard
    ctx.fillStyle = shade(base, -0.32);
    ctx.fillRect(0, s * 0.94, s, s * 0.06);
    ctx.fillStyle = shade(base, -0.2);
    ctx.fillRect(0, s * 0.93, s, s * 0.012);
    // grime gradient near the floor
    const gr = ctx.createLinearGradient(0, s * 0.7, 0, s * 0.94);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(40,25,10,0.18)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, s * 0.7, s, s * 0.24);
  });
}

/** Paved floor: texture spans 4×4 m with 1 m pavers. */
export function floorTexture(scene: Scene, base: string, seed: number) {
  return makeTexture(scene, `floor-${seed}`, 512, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = shade(base, -0.25);
    ctx.fillRect(0, 0, s, s);
    const n = 4;
    const t = s / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const off = j % 2 === 0 ? 0 : t / 2;
        for (const dx of [0, -s]) {
          const x = i * t + off + dx;
          ctx.fillStyle = shade(base, (r() - 0.5) * 0.14);
          ctx.fillRect(x + 3, j * t + 3, t - 6, t - 6);
          ctx.fillStyle = shade(base, 0.08, 0.4);
          ctx.fillRect(x + 3, j * t + 3, t - 6, 3);
        }
      }
    speckle(ctx, s, base, 3000, r, 0.14);
  });
}

export function crateTexture(scene: Scene, base: string, seed: number) {
  return makeTexture(scene, `crate-${seed}`, 256, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = shade(base, (r() - 0.5) * 0.18);
      ctx.fillRect(0, (i * s) / 6, s, s / 6 - 2);
      ctx.fillStyle = shade(base, -0.35, 0.8);
      ctx.fillRect(0, ((i + 1) * s) / 6 - 2, s, 2);
    }
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = shade(base, -0.2, 0.35);
      ctx.fillRect(r() * s, r() * s, 6 + r() * 30, 1);
    }
    // frame
    const f = s * 0.09;
    ctx.fillStyle = shade(base, -0.28);
    ctx.fillRect(0, 0, s, f);
    ctx.fillRect(0, s - f, s, f);
    ctx.fillRect(0, 0, f, s);
    ctx.fillRect(s - f, 0, f, s);
    // diagonal brace
    ctx.strokeStyle = shade(base, -0.25);
    ctx.lineWidth = f * 0.8;
    ctx.beginPath();
    ctx.moveTo(f, f);
    ctx.lineTo(s - f, s - f);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });
}

export function metalTexture(scene: Scene, base: string, seed: number) {
  return makeTexture(scene, `metal-${seed}`, 256, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = shade(base, 0.12, 0.6);
      ctx.fillRect(x, 0, 5, s);
      ctx.fillStyle = shade(base, -0.25, 0.6);
      ctx.fillRect(x + 9, 0, 3, s);
    }
    speckle(ctx, s, base, 500, r, 0.2);
    ctx.fillStyle = shade(base, -0.35);
    ctx.fillRect(0, 0, s, 10);
    ctx.fillRect(0, s - 10, s, 10);
  });
}

export function stoneTexture(scene: Scene, base: string, seed: number) {
  return makeTexture(scene, `stone-${seed}`, 256, (ctx, s) => {
    const r = rng(seed);
    ctx.fillStyle = shade(base, -0.3);
    ctx.fillRect(0, 0, s, s);
    const rows = 4;
    const h = s / rows;
    for (let j = 0; j < rows; j++) {
      const w = s / 2;
      const off = j % 2 ? w / 2 : 0;
      for (let i = -1; i < 3; i++) {
        ctx.fillStyle = shade(base, (r() - 0.5) * 0.18);
        ctx.fillRect(i * w + off + 2, j * h + 2, w - 4, h - 4);
      }
    }
    speckle(ctx, s, base, 900, r, 0.15);
  });
}

export function skyTexture(scene: Scene, top: string, horizon: string) {
  return makeTexture(
    scene,
    'sky',
    256,
    (ctx, s) => {
      // Sphere UVs run top→bottom while canvas rows are uploaded bottom-up, so draw inverted.
      const g = ctx.createLinearGradient(0, s, 0, 0);
      g.addColorStop(0, top);
      g.addColorStop(0.48, horizon);
      g.addColorStop(0.52, horizon);
      g.addColorStop(1, shade(horizon, -0.2));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    false,
    false,
  );
}

export function radialTexture(scene: Scene, name: string, inner: string, outer: string, size = 64) {
  return makeTexture(
    scene,
    name,
    size,
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    true,
    false,
  );
}

export function bulletHoleTexture(scene: Scene) {
  return makeTexture(
    scene,
    'bullet-hole',
    64,
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(10,8,6,1)');
      g.addColorStop(0.35, 'rgba(25,20,16,0.95)');
      g.addColorStop(0.6, 'rgba(60,50,40,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
    true,
    false,
  );
}

export function muzzleFlashTexture(scene: Scene) {
  return makeTexture(
    scene,
    'muzzle',
    128,
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.translate(s / 2, s / 2);
      for (let i = 0; i < 7; i++) {
        ctx.rotate((Math.PI * 2) / 7);
        const g = ctx.createLinearGradient(0, 0, s / 2, 0);
        g.addColorStop(0, 'rgba(255,250,220,1)');
        g.addColorStop(0.5, 'rgba(255,190,90,0.7)');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.06);
        ctx.lineTo(s / 2, 0);
        ctx.lineTo(0, s * 0.06);
        ctx.fill();
      }
      const c = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.22);
      c.addColorStop(0, 'rgba(255,255,240,1)');
      c.addColorStop(1, 'rgba(255,200,100,0)');
      ctx.fillStyle = c;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    true,
    false,
  );
}

export function letterTexture(scene: Scene, letter: string, color: string) {
  return makeTexture(
    scene,
    `letter-${letter}`,
    256,
    (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = color;
      ctx.font = `800 ${s * 0.82}px "Barlow Condensed", Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, s / 2, s / 2 + s * 0.04);
    },
    true,
    false,
  );
}
