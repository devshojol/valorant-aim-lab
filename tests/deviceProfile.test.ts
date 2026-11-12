import { describe, expect, it } from 'vitest';
import { classifyDevice } from '../src/settings/deviceProfile';

describe('classifyDevice', () => {
  const pick = (gpu: string, cores?: number, mem?: number) => classifyDevice(gpu, cores, mem).preset;

  it('puts software renderers on potato', () => {
    expect(pick('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 8, 8)).toBe('potato');
    expect(pick('llvmpipe (LLVM 15.0.7, 256 bits)', 8, 8)).toBe('potato');
    expect(pick('Microsoft Basic Render Driver', 8, 8)).toBe('potato');
  });

  it('puts integrated graphics on low', () => {
    expect(pick('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 8)).toBe('low');
    expect(pick('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 16)).toBe('low');
    expect(pick('Mali-G72', 8, 8)).toBe('low');
  });

  it('puts dedicated GPUs on high and mid-range ones on medium', () => {
    expect(pick('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 12, 8)).toBe('high');
    expect(pick('ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 12, 8)).toBe('high');
    expect(pick('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 8, 8)).toBe('medium');
    expect(pick('ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 8)).toBe('medium');
  });

  it('falls back to medium when the GPU is hidden', () => {
    expect(pick('', 8, 8)).toBe('medium');
    expect(pick('', undefined, undefined)).toBe('medium');
  });

  it('drops one step on a weak CPU or little memory', () => {
    expect(pick('ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)', 4, 8)).toBe('potato');
    expect(pick('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 4, 8)).toBe('medium');
    expect(pick('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 4)).toBe('potato');
  });
});
