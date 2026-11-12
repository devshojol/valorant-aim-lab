import type { GraphicsPreset } from '../types';

export type DetectedPreset = Exclude<GraphicsPreset, 'custom'>;

export interface DeviceProfile {
  preset: DetectedPreset;
  /** GPU name as the browser reports it ('' when hidden or unavailable). */
  gpu: string;
  /** Why this preset was picked, for the Settings page. */
  reason: string;
}

const ORDER: DetectedPreset[] = ['potato', 'low', 'medium', 'high'];

/**
 * Pick a graphics preset from a GPU name and the machine's core count / memory.
 * A guess from names only: adaptive resolution covers what it gets wrong.
 */
export function classifyDevice(gpu: string, cores: number | undefined, memoryGb: number | undefined): DeviceProfile {
  const g = gpu.toLowerCase();
  let tier: DetectedPreset;
  let reason: string;
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(g)) {
    tier = 'potato';
    reason = 'software rendering (no GPU acceleration)';
  } else if (/rtx|gtx (9|1\d)\d\d|radeon (pro )?rx|radeon pro w|arc\(tm\) [ab]\d|\barc [ab]\d|quadro rtx|apple m\d+ (pro|max|ultra)/.test(g)) {
    tier = 'high';
    reason = 'dedicated GPU';
  } else if (/apple (m\d|gpu)|geforce|nvidia|radeon (r9|pro)|\biris\(r\) xe|\biris xe|\barc\b/.test(g)) {
    tier = 'medium';
    reason = 'mid-range GPU';
  } else if (/intel|iris|uhd|hd graphics|radeon|amd|mali|adreno|powervr|videocore/.test(g)) {
    tier = 'low';
    reason = 'integrated graphics';
  } else {
    tier = 'medium';
    reason = g ? 'unrecognised GPU' : 'GPU name hidden by the browser';
  }
  // A weak CPU or little memory pulls the pick down one step.
  if ((cores !== undefined && cores <= 4) || (memoryGb !== undefined && memoryGb <= 4)) {
    const i = ORDER.indexOf(tier);
    if (i > 0) {
      tier = ORDER[i - 1];
      reason += ', few CPU cores or little memory';
    }
  }
  return { preset: tier, gpu, reason };
}

/** Read the GPU name from a throwaway WebGL context and classify this machine. */
export function detectDevice(): DeviceProfile {
  let gpu = '';
  let hasGl = false;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      hasGl = true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* fall through */
  }
  if (!hasGl) return { preset: 'potato', gpu: '', reason: 'WebGL unavailable' };
  const nav = navigator as Navigator & { deviceMemory?: number };
  return classifyDevice(gpu, nav.hardwareConcurrency, nav.deviceMemory);
}
