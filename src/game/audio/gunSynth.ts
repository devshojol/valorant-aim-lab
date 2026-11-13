/**
 * Layered gunshot synthesis, rendered once at load with an OfflineAudioContext.
 *
 * A real gunshot recorded near the shooter is several overlapping events, and each one is
 * modelled separately here:
 *   1. Supersonic crack / muzzle N-wave – a sub-millisecond pressure spike (bright, sharp).
 *   2. Muzzle blast – broadband gas expansion whose brightness collapses within ~80 ms.
 *   3. Body – the low-mid "punch" of the blast (200–600 Hz).
 *   4. Sub thump – chest-felt low end with a falling pitch.
 *   5. Mechanical action – bolt carrier / slide / cylinder: short metallic modal ringing.
 *   6. Suppressor gas hiss (Phantom only).
 *   7. Early reflections – slap-back from nearby walls (stereo, low-passed).
 *   8. Reverb tail – convolution with a synthetic outdoor/urban impulse response.
 * Everything goes through soft saturation and a fast compressor, like a close-mic'd recording.
 * All of it is generated from noise and oscillators, so no recorded or copyrighted audio is used.
 */

export type GunSoundId = 'rifle-heavy' | 'rifle-suppressed' | 'rifle-dmr' | 'smg-suppressed' | 'sniper' | 'pistol-light' | 'pistol-heavy' | 'pistol-suppressed';

interface MechEvent {
  delay: number;
  gain: number;
  freqs: number[];
  decay: number;
}

export interface GunProfile {
  length: number;
  crack: { gain: number; hp: number; width: number; decay: number };
  blast: { gain: number; bp: number; q: number; decay: number; sweepFrom: number; sweepTo: number; sweepTime: number };
  body: { gain: number; lp: number; decay: number };
  sub: { gain: number; f0: number; f1: number; decay: number };
  hiss?: { gain: number; bp: number; decay: number };
  mech: MechEvent[];
  drive: number;
  reflections: { gain: number; left: number; right: number; lp: number }[];
  reverb: { wet: number; seconds: number; decay: number; damp: number };
  peak: number;
}

const GUN_PROFILES: Record<GunSoundId, GunProfile> = {
  // Vandal — heavy 7.62-style rifle: hard crack, big low-mid punch, rattly action, long city tail.
  'rifle-heavy': {
    length: 1.7,
    crack: { gain: 1.0, hp: 2200, width: 0.00055, decay: 0.006 },
    blast: { gain: 1.35, bp: 1050, q: 0.55, decay: 0.024, sweepFrom: 9500, sweepTo: 1100, sweepTime: 0.09 },
    body: { gain: 1.25, lp: 420, decay: 0.042 },
    sub: { gain: 0.5, f0: 115, f1: 55, decay: 0.036 },
    mech: [
      { delay: 0.016, gain: 0.22, freqs: [1650, 2480, 3720, 5150, 6900], decay: 0.011 },
      { delay: 0.062, gain: 0.13, freqs: [1420, 2210, 3390, 4870], decay: 0.014 },
    ],
    drive: 2.4,
    reflections: [
      { gain: 0.24, left: 0.029, right: 0.036, lp: 3600 },
      { gain: 0.17, left: 0.061, right: 0.052, lp: 2600 },
      { gain: 0.11, left: 0.097, right: 0.112, lp: 1800 },
      { gain: 0.07, left: 0.153, right: 0.141, lp: 1300 },
    ],
    reverb: { wet: 0.6, seconds: 1.7, decay: 0.42, damp: 5200 },
    peak: 0.97,
  },
  // Phantom — suppressed rifle: muffled thump, prominent bolt clatter, short hiss, small tail.
  'rifle-suppressed': {
    length: 1.1,
    crack: { gain: 0.22, hp: 3200, width: 0.0004, decay: 0.003 },
    blast: { gain: 0.75, bp: 650, q: 0.9, decay: 0.017, sweepFrom: 2600, sweepTo: 600, sweepTime: 0.05 },
    body: { gain: 0.85, lp: 300, decay: 0.045 },
    sub: { gain: 0.4, f0: 130, f1: 65, decay: 0.03 },
    hiss: { gain: 0.38, bp: 2600, decay: 0.028 },
    mech: [
      { delay: 0.009, gain: 0.48, freqs: [2120, 3310, 4690, 6230, 8150], decay: 0.013 },
      { delay: 0.052, gain: 0.32, freqs: [1880, 2960, 4410, 5770], decay: 0.016 },
    ],
    drive: 1.5,
    reflections: [
      { gain: 0.2, left: 0.027, right: 0.034, lp: 2400 },
      { gain: 0.12, left: 0.058, right: 0.049, lp: 1800 },
    ],
    reverb: { wet: 0.2, seconds: 1.0, decay: 0.24, damp: 3800 },
    peak: 0.78,
  },
  // Classic — 9 mm-style pistol: snappy, brighter, shorter body, light slide click.
  'pistol-light': {
    length: 1.3,
    crack: { gain: 0.85, hp: 2800, width: 0.0004, decay: 0.004 },
    blast: { gain: 1.05, bp: 1550, q: 0.65, decay: 0.014, sweepFrom: 11000, sweepTo: 1700, sweepTime: 0.06 },
    body: { gain: 0.8, lp: 620, decay: 0.042 },
    sub: { gain: 0.35, f0: 160, f1: 80, decay: 0.028 },
    mech: [{ delay: 0.011, gain: 0.2, freqs: [2650, 3940, 5420, 7330], decay: 0.009 }],
    drive: 1.9,
    reflections: [
      { gain: 0.2, left: 0.027, right: 0.033, lp: 3800 },
      { gain: 0.13, left: 0.057, right: 0.05, lp: 2700 },
      { gain: 0.08, left: 0.094, right: 0.106, lp: 1900 },
    ],
    reverb: { wet: 0.45, seconds: 1.3, decay: 0.32, damp: 5600 },
    peak: 0.85,
  },
  // Sheriff — heavy revolver: huge boom, deep thump, cylinder clank, long echoing tail.
  'pistol-heavy': {
    length: 2.2,
    crack: { gain: 1.1, hp: 1900, width: 0.0007, decay: 0.008 },
    blast: { gain: 1.5, bp: 880, q: 0.5, decay: 0.032, sweepFrom: 8500, sweepTo: 850, sweepTime: 0.12 },
    body: { gain: 1.4, lp: 340, decay: 0.065 },
    sub: { gain: 0.62, f0: 100, f1: 46, decay: 0.05 },
    mech: [{ delay: 0.085, gain: 0.12, freqs: [1180, 1890, 2710, 3640], decay: 0.022 }],
    drive: 2.8,
    reflections: [
      { gain: 0.3, left: 0.033, right: 0.041, lp: 3200 },
      { gain: 0.21, left: 0.071, right: 0.063, lp: 2300 },
      { gain: 0.14, left: 0.118, right: 0.131, lp: 1600 },
      { gain: 0.09, left: 0.19, right: 0.176, lp: 1100 },
    ],
    reverb: { wet: 0.6, seconds: 2.1, decay: 0.52, damp: 4600 },
    peak: 0.98,
  },
  // Guardian — marksman rifle: sharper and drier than the Vandal, one heavy action clack per shot.
  'rifle-dmr': {
    length: 1.8,
    crack: { gain: 1.1, hp: 2500, width: 0.0005, decay: 0.006 },
    blast: { gain: 1.4, bp: 1250, q: 0.6, decay: 0.026, sweepFrom: 10500, sweepTo: 1250, sweepTime: 0.09 },
    body: { gain: 1.15, lp: 460, decay: 0.05 },
    sub: { gain: 0.5, f0: 120, f1: 58, decay: 0.04 },
    mech: [{ delay: 0.07, gain: 0.2, freqs: [1350, 2080, 3150, 4520, 6100], decay: 0.018 }],
    drive: 2.5,
    reflections: [
      { gain: 0.26, left: 0.031, right: 0.038, lp: 3500 },
      { gain: 0.18, left: 0.066, right: 0.057, lp: 2500 },
      { gain: 0.12, left: 0.108, right: 0.121, lp: 1700 },
      { gain: 0.07, left: 0.168, right: 0.155, lp: 1250 },
    ],
    reverb: { wet: 0.6, seconds: 1.8, decay: 0.45, damp: 5000 },
    peak: 0.97,
  },
  // Spectre — suppressed SMG: short dry tick with a fast, light bolt; almost no tail so it stays clean at 13 shots a second.
  'smg-suppressed': {
    length: 0.8,
    crack: { gain: 0.2, hp: 3600, width: 0.00035, decay: 0.0025 },
    blast: { gain: 0.62, bp: 820, q: 1.0, decay: 0.012, sweepFrom: 3000, sweepTo: 760, sweepTime: 0.035 },
    body: { gain: 0.6, lp: 360, decay: 0.03 },
    sub: { gain: 0.25, f0: 150, f1: 80, decay: 0.02 },
    hiss: { gain: 0.34, bp: 3100, decay: 0.02 },
    mech: [
      { delay: 0.007, gain: 0.42, freqs: [2480, 3720, 5260, 7050, 9100], decay: 0.009 },
      { delay: 0.034, gain: 0.26, freqs: [2150, 3380, 4960, 6420], decay: 0.011 },
    ],
    drive: 1.4,
    reflections: [
      { gain: 0.16, left: 0.025, right: 0.031, lp: 2300 },
      { gain: 0.09, left: 0.052, right: 0.046, lp: 1700 },
    ],
    reverb: { wet: 0.14, seconds: 0.8, decay: 0.18, damp: 3600 },
    peak: 0.72,
  },
  // Operator — sniper: the loudest shot, very deep, with a long rolling echo and a late bolt.
  sniper: {
    length: 2.8,
    crack: { gain: 1.25, hp: 1700, width: 0.0008, decay: 0.01 },
    blast: { gain: 1.7, bp: 760, q: 0.45, decay: 0.04, sweepFrom: 9000, sweepTo: 700, sweepTime: 0.15 },
    body: { gain: 1.6, lp: 300, decay: 0.085 },
    sub: { gain: 0.8, f0: 90, f1: 38, decay: 0.07 },
    mech: [{ delay: 0.12, gain: 0.1, freqs: [980, 1620, 2440, 3380], decay: 0.03 }],
    drive: 3.0,
    reflections: [
      { gain: 0.34, left: 0.036, right: 0.045, lp: 3000 },
      { gain: 0.25, left: 0.079, right: 0.069, lp: 2200 },
      { gain: 0.18, left: 0.131, right: 0.146, lp: 1500 },
      { gain: 0.12, left: 0.214, right: 0.198, lp: 1050 },
      { gain: 0.07, left: 0.33, right: 0.305, lp: 800 },
    ],
    reverb: { wet: 0.7, seconds: 2.7, decay: 0.68, damp: 4200 },
    peak: 0.99,
  },
  // Ghost — suppressed pistol: a small bright snap, slide click, no tail.
  'pistol-suppressed': {
    length: 0.8,
    crack: { gain: 0.18, hp: 3800, width: 0.0003, decay: 0.0025 },
    blast: { gain: 0.6, bp: 1100, q: 1.0, decay: 0.011, sweepFrom: 3600, sweepTo: 1000, sweepTime: 0.035 },
    body: { gain: 0.5, lp: 480, decay: 0.028 },
    sub: { gain: 0.2, f0: 170, f1: 90, decay: 0.018 },
    hiss: { gain: 0.3, bp: 3400, decay: 0.022 },
    mech: [{ delay: 0.009, gain: 0.34, freqs: [2900, 4250, 5880, 7900], decay: 0.008 }],
    drive: 1.3,
    reflections: [
      { gain: 0.15, left: 0.026, right: 0.032, lp: 2400 },
      { gain: 0.08, left: 0.055, right: 0.048, lp: 1800 },
    ],
    reverb: { wet: 0.14, seconds: 0.8, decay: 0.2, damp: 3800 },
    peak: 0.68,
  },
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function tanhCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / norm;
  }
  return c;
}

/** Synthetic stereo impulse response: discrete early reflections + diffuse, darkening decay. */
export function makeImpulseResponse(ctx: BaseAudioContext, seconds: number, decay: number, damp: number, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(seconds * sr));
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed * 31 + ch * 7 + 3);
    const d = ir.getChannelData(ch);
    let y = 0;
    const preDelay = Math.floor(0.012 * sr);
    for (let i = preDelay; i < len; i++) {
      const t = (i - preDelay) / sr;
      // high frequencies die faster than lows (air + surface absorption)
      const fc = 350 + damp * Math.exp(-t * 3.2);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      const x = (r() * 2 - 1) * Math.exp(-t / decay);
      y += a * (x - y);
      d[i] = y;
    }
    // sparse early reflections in the first 80 ms
    for (let k = 0; k < 14; k++) {
      const t = 0.012 + r() * 0.07;
      const i = Math.floor(t * sr);
      if (i < len) d[i] += (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5) * Math.exp(-t / 0.05);
    }
  }
  return ir;
}

/** Render one gunshot variant. `seed` changes noise and micro-timing so repeated shots differ. */
async function renderGunshot(p: GunProfile, sampleRate: number, seed: number): Promise<AudioBuffer> {
  const len = Math.ceil(p.length * sampleRate);
  const oc = new OfflineAudioContext(2, len, sampleRate);
  const r = rng(seed);
  const jit = (v: number, amt = 0.06) => v * (1 + (r() * 2 - 1) * amt);
  const T0 = 0.002;

  // shared white noise
  const noiseLen = Math.ceil(0.6 * sampleRate);
  const noise = oc.createBuffer(1, noiseLen, sampleRate);
  {
    const d = noise.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) d[i] = r() * 2 - 1;
  }
  const noiseSrc = (offset: number) => {
    const s = oc.createBufferSource();
    s.buffer = noise;
    s.start(T0, offset);
    return s;
  };
  const env = (attack: number, peak: number, decay: number, start = T0) => {
    const g = oc.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.setTargetAtTime(0, start + attack, decay);
    return g;
  };

  // ---- busses
  const pre = oc.createGain();
  const shaper = oc.createWaveShaper();
  shaper.curve = tanhCurve(p.drive);
  shaper.oversample = '4x';
  pre.connect(shaper);
  const mix = oc.createGain();
  shaper.connect(mix);
  const clean = oc.createGain(); // layers that should not be saturated
  clean.connect(mix);

  // early reflections (stereo). Walls reflect mids/highs; keep the sub out of the echoes.
  const merger = oc.createChannelMerger(2);
  merger.connect(mix);
  const reflHp = oc.createBiquadFilter();
  reflHp.type = 'highpass';
  reflHp.frequency.value = 220;
  shaper.connect(reflHp);
  for (const rf of p.reflections) {
    for (const [ch, dl] of [
      [0, rf.left],
      [1, rf.right],
    ] as const) {
      const d = oc.createDelay(1);
      d.delayTime.value = jit(dl, 0.08);
      const lp = oc.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = rf.lp;
      const g = oc.createGain();
      g.gain.value = rf.gain * (0.85 + r() * 0.3);
      reflHp.connect(d);
      d.connect(lp);
      lp.connect(g);
      g.connect(merger, 0, ch);
    }
  }

  // reverb tail
  const conv = oc.createConvolver();
  conv.normalize = true;
  conv.buffer = makeImpulseResponse(oc, p.reverb.seconds, p.reverb.decay, p.reverb.damp, seed);
  const wet = oc.createGain();
  wet.gain.value = p.reverb.wet;
  // Low end is not sent to the reverb, which keeps the tail from turning into a rumble.
  const revHp = oc.createBiquadFilter();
  revHp.type = 'highpass';
  revHp.frequency.value = 280;
  revHp.Q.value = 0.6;
  shaper.connect(revHp);
  clean.connect(revHp);
  revHp.connect(conv);
  conv.connect(wet);
  wet.connect(mix);

  // ---- 1. crack: N-wave + snap
  {
    const cl = Math.ceil(0.04 * sampleRate);
    const b = oc.createBuffer(1, cl, sampleRate);
    const d = b.getChannelData(0);
    const w = jit(p.crack.width, 0.15);
    for (let i = 0; i < cl; i++) {
      const t = i / sampleRate;
      const nwave = t < w ? 1 - (2 * t) / w : 0;
      d[i] = nwave + (r() * 2 - 1) * 0.6 * Math.exp(-t / p.crack.decay);
    }
    const s = oc.createBufferSource();
    s.buffer = b;
    const hp = oc.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = p.crack.hp;
    const g = oc.createGain();
    g.gain.value = p.crack.gain;
    s.connect(hp);
    hp.connect(g);
    g.connect(clean);
    const g2 = oc.createGain();
    g2.gain.value = p.crack.gain * 0.4;
    hp.connect(g2);
    g2.connect(pre);
    s.start(T0);
  }

  // ---- 2. muzzle blast with collapsing brightness
  {
    const s = noiseSrc(r() * 0.2);
    const bp = oc.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = jit(p.blast.bp);
    bp.Q.value = p.blast.q;
    const lp = oc.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(p.blast.sweepFrom, T0);
    lp.frequency.exponentialRampToValueAtTime(p.blast.sweepTo, T0 + p.blast.sweepTime);
    const g = env(0.0006, p.blast.gain, jit(p.blast.decay));
    s.connect(bp);
    bp.connect(lp);
    lp.connect(g);
    g.connect(pre);
    // broadband component keeps the attack wide
    const s2 = noiseSrc(r() * 0.2);
    const lp2 = oc.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.setValueAtTime(p.blast.sweepFrom * 1.2, T0);
    lp2.frequency.exponentialRampToValueAtTime(p.blast.sweepTo * 1.5, T0 + p.blast.sweepTime * 0.7);
    const g2 = env(0.0004, p.blast.gain * 0.45, jit(p.blast.decay * 0.6));
    s2.connect(lp2);
    lp2.connect(g2);
    g2.connect(pre);
  }

  // ---- 3. body punch
  {
    const s = noiseSrc(r() * 0.2);
    const lp = oc.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = jit(p.body.lp);
    lp.Q.value = 1.1;
    const g = env(0.0015, p.body.gain, jit(p.body.decay));
    s.connect(lp);
    lp.connect(g);
    g.connect(pre);
  }

  // ---- 4. sub thump with pitch drop
  {
    const o = oc.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(jit(p.sub.f0, 0.04), T0);
    o.frequency.exponentialRampToValueAtTime(p.sub.f1, T0 + p.sub.decay * 1.8);
    const g = env(0.002, p.sub.gain, p.sub.decay);
    o.connect(g);
    g.connect(pre);
    o.start(T0);
    o.stop(T0 + p.sub.decay * 6);
  }

  // ---- 6. suppressor hiss
  if (p.hiss) {
    const s = noiseSrc(r() * 0.2);
    const bp = oc.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = jit(p.hiss.bp);
    bp.Q.value = 1.3;
    const g = env(0.004, p.hiss.gain, p.hiss.decay);
    s.connect(bp);
    bp.connect(g);
    g.connect(clean);
  }

  // ---- 5. mechanical action (modal metallic ringing + contact noise)
  for (const m of p.mech) {
    const start = T0 + jit(m.delay, 0.12);
    for (const f of m.freqs) {
      const o = oc.createOscillator();
      o.type = 'sine';
      o.frequency.value = jit(f, 0.03);
      const g = env(0.0003, (m.gain / m.freqs.length) * (0.6 + r() * 0.8), jit(m.decay, 0.25), start);
      o.connect(g);
      g.connect(clean);
      o.start(start);
      o.stop(start + m.decay * 10);
    }
    const s = oc.createBufferSource();
    s.buffer = noise;
    const hp = oc.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const g = env(0.0002, m.gain * 0.6, 0.0025, start);
    s.connect(hp);
    hp.connect(g);
    g.connect(clean);
    s.start(start, r() * 0.3);
  }

  // ---- master: DC/rumble filter (no compressor: its make-up gain would lift the tail over the transient)
  const hpOut = oc.createBiquadFilter();
  hpOut.type = 'highpass';
  hpOut.frequency.value = 28;
  hpOut.Q.value = 0.7;
  mix.connect(hpOut);
  hpOut.connect(oc.destination);

  const out = await oc.startRendering();
  // normalise to the profile's peak level
  let peak = 0;
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const d = out.getChannelData(ch);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const k = peak > 0 ? p.peak / peak : 1;
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const d = out.getChannelData(ch);
    // short fade-out at the very end to avoid clicks
    const fade = Math.floor(0.05 * sampleRate);
    for (let i = 0; i < d.length; i++) {
      const f = i > d.length - fade ? (d.length - i) / fade : 1;
      d[i] *= k * f;
    }
  }
  return out;
}

/** Render `variants` takes of every gun. */
export async function renderAllGuns(sampleRate: number, variants = 4): Promise<Map<GunSoundId, AudioBuffer[]>> {
  const out = new Map<GunSoundId, AudioBuffer[]>();
  const ids = Object.keys(GUN_PROFILES) as GunSoundId[];
  await Promise.all(
    ids.map(async (id, gi) => {
      const list: AudioBuffer[] = [];
      for (let v = 0; v < variants; v++) list.push(await renderGunshot(GUN_PROFILES[id], sampleRate, 1000 + gi * 97 + v * 13));
      out.set(id, list);
    }),
  );
  return out;
}

/** Encode an AudioBuffer as a 16-bit PCM WAV (used by tests/previews). */
export function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = 44 + n * ch * 2;
  const ab = new ArrayBuffer(bytes);
  const v = new DataView(ab);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return ab;
}
