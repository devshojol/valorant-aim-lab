import { describe, expect, it } from 'vitest';
import { splitSteps, trimSilence } from '../src/game/audio/AudioEngine';

/** Minimal stand-ins for AudioBuffer / BaseAudioContext (enough for the trimming helpers). */
class FakeBuffer {
  readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
  copyToChannel(src: Float32Array, c: number) {
    this.data[c].set(src);
  }
}
const ctx = { createBuffer: (ch: number, len: number, rate: number) => new FakeBuffer(ch, len, rate) } as unknown as BaseAudioContext;
const RATE = 8000;

/** A take with decaying 120 Hz thumps at the given times (seconds). */
function take(seconds: number, hits: number[]): AudioBuffer {
  const b = new FakeBuffer(2, Math.floor(seconds * RATE), RATE);
  for (const t of hits) {
    const s = Math.floor(t * RATE);
    for (let i = 0; i < 0.12 * RATE && s + i < b.length; i++) {
      const v = Math.sin((2 * Math.PI * 120 * i) / RATE) * Math.exp(-i / (0.03 * RATE)) * 0.8;
      b.data[0][s + i] += v;
      b.data[1][s + i] += v;
    }
  }
  return b as unknown as AudioBuffer;
}

describe('recording clean-up', () => {
  it('trims leading and trailing silence', () => {
    const out = trimSilence(ctx, take(3, [0.5]));
    expect(out.duration).toBeLessThan(0.25);
    expect(Math.abs(out.getChannelData(0)[Math.floor(0.01 * RATE)])).toBeGreaterThan(0);
  });

  it('cuts a walking take into single steps', () => {
    const hits = [0.5, 1.0, 1.55, 2.05, 2.6, 3.1];
    const steps = splitSteps(ctx, take(4, hits));
    expect(steps.length).toBe(hits.length);
    for (const s of steps) expect(s.duration).toBeLessThanOrEqual(0.4);
  });

  it('keeps a heel-and-toe pair as one step', () => {
    const steps = splitSteps(ctx, take(3, [0.5, 0.58, 1.2, 1.28, 1.9, 1.98]));
    expect(steps.length).toBe(3);
  });
});
