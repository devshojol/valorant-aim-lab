/**
 * One Babylon engine (and its canvas) shared by every play session.
 *
 * Creating a new engine per session meant every shader was compiled again each time the
 * "Building <map>…" screen showed. Keeping the engine alive keeps Babylon's compiled-effect
 * cache, so only the first session pays for shader compilation.
 *
 * Exactly one GameEngine may own the host at a time. Two engines must never share one
 * WebGL context: Babylon caches GL state per engine, and interleaved use corrupts rendering.
 */
import { Effect, Engine, type AbstractEngine } from '../rendering/babylon';

// Keep compiled shaders in the engine's cache when a session's materials are disposed,
// so the next session reuses them instead of compiling again.
Effect.PersistentMode = true;

export type RendererKind = 'webgl2' | 'webgpu';

/** A session that may hold the engine. A disposed owner's claim is void. */
export interface HostOwner {
  readonly isDisposed: boolean;
}

interface Host {
  canvas: HTMLCanvasElement;
  engine: AbstractEngine;
  kind: RendererKind;
  name: string;
  owner: HostOwner | null;
}

let host: Host | null = null;
/** Engine creation in flight (WebGPU init is async) — later callers wait for it. */
let creating: Promise<void> | null = null;
let webglOk: boolean | null = null;

export function webglAvailable(): boolean {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    webglOk = !!gl;
    // free the probe context straight away (browsers cap live contexts)
    (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglOk = false;
  }
  return webglOk;
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'absolute inset-0 h-full w-full outline-none';
  c.style.touchAction = 'none';
  c.tabIndex = -1;
  return c;
}

async function createEngine(canvas: HTMLCanvasElement, kind: RendererKind): Promise<{ engine: AbstractEngine; kind: RendererKind; name: string; fallback: boolean }> {
  if (kind === 'webgpu' && 'gpu' in navigator) {
    try {
      const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine');
      if (await WebGPUEngine.IsSupportedAsync) {
        const e = new WebGPUEngine(canvas, { antialias: false, stencil: true, powerPreference: 'high-performance' });
        await e.initAsync();
        return { engine: e, kind: 'webgpu', name: 'WebGPU', fallback: false };
      }
    } catch (err) {
      console.warn('WebGPU init failed, falling back to WebGL2', err);
    }
  }
  const e = new Engine(
    canvas,
    false,
    { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance', antialias: false, doNotHandleContextLost: false, loseContextOnDispose: true },
    false,
  );
  return { engine: e, kind: 'webgl2', name: e.webGLVersion >= 2 ? 'WebGL2' : 'WebGL1', fallback: kind === 'webgpu' };
}

/**
 * Take ownership of the shared engine, creating it (or recreating it for a different renderer)
 * when needed. A disposed previous owner (e.g. React StrictMode's discarded first mount) simply
 * loses its claim. A still-live previous owner should never exist; if one does, the engine is
 * recreated rather than shared.
 */
export async function acquireRenderHost(
  owner: HostOwner,
  kind: RendererKind,
): Promise<{ canvas: HTMLCanvasElement; engine: AbstractEngine; name: string; fallback: boolean }> {
  while (creating) await creating;
  const wantKind: RendererKind = kind === 'webgpu' && 'gpu' in navigator ? 'webgpu' : 'webgl2';
  if (host && host.owner && host.owner !== owner && !host.owner.isDisposed) {
    console.warn('[render] another session still holds the engine — creating a fresh one');
    disposeHost();
  }
  if (host && (host.kind !== wantKind || host.engine.isDisposed)) disposeHost();
  let fallback = false;
  if (!host) {
    creating = (async () => {
      const canvas = makeCanvas();
      const made = await createEngine(canvas, wantKind);
      fallback = made.fallback;
      // A WebGPU request that fell back keeps kind 'webgpu' so we don't retry it every session.
      host = { canvas, engine: made.engine, kind: wantKind, name: made.name, owner: null };
    })();
    try {
      await creating;
    } finally {
      creating = null;
    }
  }
  const h = host!;
  h.owner = owner;
  return { canvas: h.canvas, engine: h.engine, name: h.name, fallback };
}

/** Give the engine back (the session's scene must already be disposed). */
export function releaseRenderHost(owner: HostOwner) {
  if (!host || host.owner !== owner) return;
  host.owner = null;
  host.engine.stopRenderLoop();
  host.canvas.remove();
}

function disposeHost() {
  if (!host) return;
  const h = host;
  host = null;
  h.engine.stopRenderLoop();
  h.canvas.remove();
  h.engine.dispose();
}
