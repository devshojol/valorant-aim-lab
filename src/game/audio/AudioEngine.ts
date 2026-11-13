/**
 * Web Audio engine with fully procedural (synthesised at load) sounds — no external or
 * copyrighted audio files. Supports HRTF positional playback with distance filtering and
 * simple wall occlusion.
 */

import type { AudioSettings, Vec3 } from '../../types';
import { makeImpulseResponse, renderAllGuns, type GunSoundId } from './gunSynth';

/** Optional user-supplied recordings (public/sounds/manifest.json), keyed by weapon. */
const SAMPLE_KEYS: Record<GunSoundId, string> = {
  'rifle-heavy': 'vandal',
  'rifle-suppressed': 'phantom',
  'pistol-light': 'classic',
  'pistol-heavy': 'sheriff',
  'rifle-dmr': 'guardian',
  'smg-suppressed': 'spectre',
  sniper: 'operator',
  'pistol-suppressed': 'ghost',
};

/**
 * Other sounds a recording in public/sounds/manifest.json can replace: manifest key → sound name.
 * `kill1`…`kill5` are the kill-streak sounds (5 is reused for every kill after the fifth),
 * `<weapon>-kill1`… let a weapon skin have its own set, `reload` replaces the three synthesized
 * reload cues with one recording (`reload-<weapon>` per weapon).
 */
const EXTRA_KEYS: Record<string, string> = {
  footstep: 'step',
  jump: 'jump',
  land: 'land',
  reload: 'reload',
  headshot: 'headshot',
  ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`kill${n}`, `kill${n}`])),
  ...Object.fromEntries(
    ['vandal', 'phantom', 'spectre', 'guardian', 'operator', 'sheriff', 'ghost', 'classic'].flatMap((w) => [
      [`reload-${w}`, `reload-${w}`],
      ...[1, 2, 3, 4, 5].map((n) => [`${w}-kill${n}`, `${w}-kill${n}`]),
    ]),
  ),
};

type Bus = 'weapons' | 'effects' | 'foot';

export interface PlayOptions {
  pos?: Vec3;
  volume?: number;
  rate?: number;
  bus?: Bus;
  occluded?: boolean;
  delay?: number;
  /**
   * Voice group: starting a sound in a group fades out the one already playing in it, so long
   * recordings (a kill call-out, a reload, a footstep) never stack on top of each other.
   */
  group?: string;
  /**
   * With `pos`: play the sound as it is (no distance muffling, wall muffling or echo), only panned
   * left/right towards `pos` and a little quieter with distance. Used for enemy gunshots so they
   * sound like the same gun the player fires.
   */
  clean?: boolean;
}

function rngFrom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Buffer synthesis helpers operating on Float32Array. */
class Synth {
  constructor(readonly sr: number) {}

  buffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const norm = peak > 0 ? 0.92 / peak : 1;
    const b = ctx.createBuffer(1, data.length, this.sr);
    const ch = b.getChannelData(0);
    for (let i = 0; i < data.length; i++) ch[i] = data[i] * norm;
    return b;
  }

  noise(len: number, seed: number) {
    const r = rngFrom(seed);
    const out = new Float32Array(Math.floor(len * this.sr));
    for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
    return out;
  }

  lowpass(x: Float32Array, cutoff: number) {
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / this.sr);
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      y += a * (x[i] - y);
      x[i] = y;
    }
    return x;
  }

  highpass(x: Float32Array, cutoff: number) {
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / this.sr);
    let low = 0;
    for (let i = 0; i < x.length; i++) {
      low += a * (x[i] - low);
      x[i] = x[i] - low;
    }
    return x;
  }

  env(x: Float32Array, attack: number, decay: number, gain = 1) {
    const sr = this.sr;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      const a = attack > 0 ? Math.min(1, t / attack) : 1;
      x[i] *= gain * a * Math.exp(-t / decay);
    }
    return x;
  }

  tone(len: number, f0: number, f1: number, decay: number, gain = 1, type: 'sine' | 'square' = 'sine') {
    const out = new Float32Array(Math.floor(len * this.sr));
    let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / this.sr;
      const f = f0 + (f1 - f0) * Math.min(1, t / len);
      ph += (2 * Math.PI * f) / this.sr;
      const s = type === 'sine' ? Math.sin(ph) : Math.sign(Math.sin(ph)) * 0.6;
      out[i] = s * gain * Math.exp(-t / decay);
    }
    return out;
  }

  mix(len: number, ...parts: [Float32Array, number?][]) {
    const out = new Float32Array(Math.floor(len * this.sr));
    for (const [p, offset = 0] of parts) {
      const o = Math.floor(offset * this.sr);
      for (let i = 0; i < p.length && i + o < out.length; i++) out[i + o] += p[i];
    }
    return out;
  }

  softClip(x: Float32Array, drive = 1.5) {
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive);
    return x;
  }
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private buffers = new Map<string, AudioBuffer[]>();
  private settings: AudioSettings;
  private reverbIn!: GainNode;
  ready = false;
  /** True once the layered gunshots have finished rendering. */
  gunsReady = false;
  /** Which weapons are using user-supplied recordings instead of synthesis. */
  readonly sampleOverrides: string[] = [];

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  /** Create the AudioContext — must be called from a user gesture. */
  init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.buses = {
      weapons: this.ctx.createGain(),
      effects: this.ctx.createGain(),
      foot: this.ctx.createGain(),
    };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    // Shared environment reverb: distant / occluded positional sounds are sent here.
    const conv = this.ctx.createConvolver();
    conv.buffer = makeImpulseResponse(this.ctx, 1.9, 0.48, 4800, 77);
    this.reverbIn = this.ctx.createGain();
    const reverbOut = this.ctx.createGain();
    reverbOut.gain.value = 0.55;
    this.reverbIn.connect(conv);
    conv.connect(reverbOut);
    reverbOut.connect(this.master);
    this.applySettings(this.settings);
    this.synthesize();
    this.ready = true;
    void this.loadGuns();
  }

  /** Weapons whose sound comes from a recording (public/sounds) — synthesis must not overwrite them. */
  private readonly recorded = new Set<string>();
  /** Sound currently playing in each voice group. */
  private readonly voices = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();

  /** Render the layered gunshots and load any recorded takes, in parallel. */
  private async loadGuns() {
    const ctx = this.ctx;
    if (!ctx) return;
    const recordings = typeof __SAMPLE_OVERRIDES__ !== 'undefined' && __SAMPLE_OVERRIDES__ ? this.loadSampleOverrides() : Promise.resolve();
    try {
      const guns = await renderAllGuns(ctx.sampleRate, 4);
      for (const [id, list] of guns) if (!this.recorded.has(id)) this.buffers.set(id, list);
      this.gunsReady = true;
    } catch (err) {
      console.warn('[audio] layered gunshot render failed, using fallback synth', err);
    }
    await recordings;
  }

  private async loadSampleOverrides() {
    const ctx = this.ctx;
    if (!ctx) return;
    let manifest: Record<string, string[]>;
    try {
      const res = await fetch('sounds/manifest.json', { cache: 'no-cache' });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
      manifest = (await res.json()) as Record<string, string[]>;
    } catch {
      return; // no manifest — keep synthesis
    }
    const decode = async (file: string): Promise<AudioBuffer | null> => {
      try {
        const r = await fetch(`sounds/${file}`);
        if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('audio')) return null;
        return await ctx.decodeAudioData(await r.arrayBuffer());
      } catch {
        return null; // skip unreadable file
      }
    };
    const targets: [string, string][] = [...Object.entries(SAMPLE_KEYS), ...Object.entries(EXTRA_KEYS).map(([k, id]) => [id, k] as [string, string])];
    await Promise.all(
      targets.map(async ([id, key]) => {
        const files = manifest[key];
        if (!Array.isArray(files) || files.length === 0) return;
        let decoded = (await Promise.all(files.map(decode))).filter((b): b is AudioBuffer => b !== null);
        // Recordings often start with silence (late playback) and footstep files are often whole
        // walking takes: trim every take, and cut long footstep takes into single steps.
        decoded = decoded.map((b) => trimSilence(ctx, b));
        if (id === 'step') decoded = decoded.flatMap((b) => (b.duration > 0.8 ? splitSteps(ctx, b) : [fadeOut(ctx, b, 0.5)]));
        if (!decoded.length) return;
        this.recorded.add(id);
        this.buffers.set(id, decoded);
        if (id.startsWith('reload')) {
          // cut at the pause between taking the magazine out and putting the new one in (see playReload)
          const parts = splitReload(ctx, decoded[0]);
          if (parts) {
            this.buffers.set(`${id}#out`, [parts.out]);
            this.buffers.set(`${id}#in`, [parts.in]);
            this.reloadParts.set(id, { outPeak: parts.outPeak, inPeak: parts.inPeak });
          }
        }
        this.sampleOverrides.push(key);
      }),
    );
  }

  /** True when a sound with this name is loaded (synthesized or recorded). */
  has(name: string): boolean {
    return (this.buffers.get(name)?.length ?? 0) > 0;
  }

  /** Reload recordings that were cut in two: seconds from each part's start to its loudest moment. */
  private readonly reloadParts = new Map<string, { outPeak: number; inPeak: number }>();

  /**
   * Play a reload recording in time with the reload animation: its first half so that its loudest
   * moment falls `outAt` seconds from now (the magazine coming out), its second half so that its
   * loudest moment falls at `inAt` (the new magazine going in). A recording with no clear pause in it
   * is played whole, straight away. Both halves stop with `stopReload`.
   */
  playReload(name: string, outAt: number, inAt: number, volume = 0.8) {
    const parts = this.reloadParts.get(name);
    if (!parts) {
      this.play(name, { volume, group: 'reload' });
      return;
    }
    const outStart = Math.max(0, outAt - parts.outPeak);
    this.play(`${name}#out`, { volume, group: 'reload', delay: outStart });
    this.play(`${name}#in`, { volume, group: 'reload-in', delay: Math.max(outStart, inAt - parts.inPeak) });
  }

  /** Cut off a reload recording (the reload was cancelled). */
  stopReload() {
    this.stopGroup('reload');
    this.stopGroup('reload-in');
  }

  /** True when this sound comes from a recording in public/sounds. */
  isRecorded(name: string): boolean {
    return this.recorded.has(name);
  }

  resume() {
    void this.ctx?.resume();
  }

  suspend() {
    void this.ctx?.suspend();
  }

  applySettings(s: AudioSettings) {
    this.settings = s;
    if (!this.ctx) return;
    this.master.gain.value = s.master;
    this.buses.weapons.gain.value = s.weapons;
    this.buses.effects.gain.value = s.effects;
    this.buses.foot.gain.value = s.footsteps;
  }

  private synthesize() {
    const ctx = this.ctx!;
    const S = new Synth(ctx.sampleRate);
    const add = (name: string, data: Float32Array) => this.buffers.set(name, [S.buffer(ctx, data)]);

    // --- Rifle (heavy): crack + body + thump + tail
    {
      const crack = S.env(S.highpass(S.noise(0.05, 1), 2500), 0, 0.01, 1.2);
      const body = S.env(S.lowpass(S.noise(0.25, 2), 1400), 0.001, 0.06, 1.4);
      const thump = S.tone(0.2, 95, 42, 0.07, 1.3);
      const tail = S.env(S.lowpass(S.noise(0.6, 3), 700), 0.01, 0.22, 0.35);
      add('rifle-heavy', S.softClip(S.mix(0.6, [crack], [body], [thump], [tail]), 1.8));
    }
    // --- Rifle (suppressed): thwip + mechanical click + small thump
    {
      const thwip = S.env(S.highpass(S.lowpass(S.noise(0.08, 4), 4200), 900), 0.001, 0.022, 1);
      const click = S.tone(0.03, 2400, 1800, 0.006, 0.6, 'square');
      const thump = S.tone(0.12, 120, 60, 0.04, 0.7);
      const tail = S.env(S.lowpass(S.noise(0.3, 5), 900), 0.005, 0.08, 0.15);
      add('rifle-suppressed', S.mix(0.32, [thwip], [click, 0.004], [thump], [tail]));
    }
    // --- Pistol light
    {
      const crack = S.env(S.highpass(S.noise(0.04, 6), 3000), 0, 0.007, 1);
      const body = S.env(S.lowpass(S.noise(0.15, 7), 2200), 0.001, 0.035, 1);
      const thump = S.tone(0.1, 160, 90, 0.035, 0.7);
      const tail = S.env(S.lowpass(S.noise(0.3, 8), 900), 0.005, 0.1, 0.2);
      add('pistol-light', S.softClip(S.mix(0.35, [crack], [body], [thump], [tail]), 1.4));
    }
    // --- Pistol heavy (revolver)
    {
      const crack = S.env(S.highpass(S.noise(0.05, 9), 2000), 0, 0.012, 1.3);
      const body = S.env(S.lowpass(S.noise(0.3, 10), 1100), 0.001, 0.09, 1.5);
      const thump = S.tone(0.3, 70, 38, 0.12, 1.6);
      const tail = S.env(S.lowpass(S.noise(0.8, 11), 600), 0.01, 0.32, 0.4);
      add('pistol-heavy', S.softClip(S.mix(0.85, [crack], [body], [thump], [tail]), 2));
    }
    // --- Mechanical: mag out / mag in / bolt / equip / dry fire
    const click = (seed: number, f: number, len = 0.04) =>
      S.mix(len, [S.env(S.highpass(S.noise(len, seed), 1500), 0, 0.006, 0.9)], [S.tone(len, f, f * 0.8, 0.01, 0.5)]);
    add('mag-out', S.mix(0.18, [click(12, 1800)], [S.env(S.lowpass(S.noise(0.12, 13), 2500), 0.01, 0.04, 0.4), 0.03]));
    add('mag-in', S.mix(0.16, [click(14, 1500)], [click(15, 2200), 0.06]));
    add('bolt', S.mix(0.3, [S.env(S.highpass(S.noise(0.12, 16), 2000), 0.02, 0.04, 0.6)], [click(17, 2600), 0.1], [click(18, 1900), 0.17]));
    add('equip', S.mix(0.25, [S.env(S.lowpass(S.noise(0.2, 19), 3000), 0.02, 0.05, 0.6)], [click(20, 2000), 0.12]));
    add('dry', click(21, 3000, 0.05));

    // --- Footsteps (4 variants, picked at random)
    const steps: AudioBuffer[] = [];
    for (let i = 0; i < 4; i++) {
      const scuff = S.env(S.lowpass(S.noise(0.12, 30 + i), 900 + i * 220), 0.003, 0.03, 1);
      const heel = S.tone(0.08, 85 + i * 10, 55, 0.02, 0.8);
      steps.push(S.buffer(ctx, S.mix(0.14, [scuff], [heel])));
    }
    this.buffers.set('step', steps);
    // Jump (original): a shoe pushing off — short grippy scuff over a soft low thud — then a quick
    // rustle of clothes and gear as the body lifts, with two faint strap/buckle ticks.
    add(
      'jump',
      S.mix(
        0.3,
        [S.env(S.highpass(S.lowpass(S.noise(0.06, 43), 3800), 700), 0.001, 0.014, 0.9)],
        [S.tone(0.1, 120, 68, 0.028, 0.75)],
        [S.env(S.highpass(S.lowpass(S.noise(0.2, 44), 2600), 1100), 0.025, 0.05, 0.3), 0.02],
        [S.tone(0.025, 2900, 2750, 0.006, 0.12), 0.055],
        [S.tone(0.02, 3400, 3300, 0.005, 0.08), 0.1],
      ),
    );
    add('land', S.mix(0.2, [S.tone(0.15, 70, 40, 0.05, 1)], [S.env(S.lowpass(S.noise(0.15, 41), 700), 0.002, 0.04, 0.8)]));

    // --- Feedback
    add('hit', S.mix(0.12, [S.tone(0.1, 1350, 1250, 0.025, 0.8)], [S.env(S.highpass(S.noise(0.03, 50), 3000), 0, 0.004, 0.4)]));
    add(
      'headshot',
      S.mix(0.5, [S.tone(0.5, 2650, 2640, 0.12, 0.8)], [S.tone(0.5, 4180, 4170, 0.08, 0.5)], [S.tone(0.5, 6100, 6100, 0.05, 0.25)]),
    );
    add('kill', S.mix(0.35, [S.tone(0.09, 880, 880, 0.05, 0.6, 'square')], [S.tone(0.2, 1320, 1320, 0.08, 0.6, 'square'), 0.08]));
    // Kill streak 1–5: a rising chime that gains one note per kill (original, not a game recording).
    const notes = [659.25, 783.99, 987.77, 1174.66, 1318.51];
    for (let n = 1; n <= 5; n++) {
      const parts: [Float32Array, number?][] = [];
      for (let i = 0; i < n; i++) {
        const t = i * 0.06;
        parts.push([S.tone(0.32, notes[i], notes[i], 0.12, 0.55), t]);
        parts.push([S.tone(0.22, notes[i] * 2.01, notes[i] * 2.01, 0.07, 0.2), t]);
        parts.push([S.tone(0.05, notes[i] * 3, notes[i] * 3, 0.012, 0.25, 'square'), t]);
      }
      if (n === 5) {
        parts.push([S.tone(0.7, 329.63, 329.63, 0.35, 0.45), 0.24]);
        parts.push([S.tone(0.7, 493.88, 493.88, 0.35, 0.3), 0.24]);
      }
      add(`kill${n}`, S.mix(0.35 + n * 0.06 + (n === 5 ? 0.6 : 0), ...parts));
    }
    // bullet into stone: sharp tick + gritty debris scatter
    add(
      'impact',
      S.mix(
        0.18,
        [S.env(S.highpass(S.noise(0.02, 60), 3500), 0, 0.0025, 1)],
        [S.env(S.highpass(S.lowpass(S.noise(0.15, 63), 4500), 900), 0.002, 0.03, 0.55), 0.004],
        [S.tone(0.05, 1900, 1500, 0.006, 0.3)],
      ),
    );
    add('hurt', S.mix(0.25, [S.tone(0.2, 120, 60, 0.06, 1)], [S.env(S.lowpass(S.noise(0.2, 61), 500), 0, 0.05, 0.8)]));
    // supersonic round passing close by: hard crack followed by a short tearing whoosh
    add(
      'whiz',
      S.mix(
        0.22,
        [S.env(S.highpass(S.noise(0.02, 64), 2500), 0, 0.0018, 1)],
        [S.env(S.lowpass(S.highpass(S.noise(0.2, 62), 1200), 6000), 0.01, 0.04, 0.45), 0.003],
      ),
    );
  }

  /** Update the listener from the camera. */
  setListener(x: number, y: number, z: number, yaw: number, pitch: number) {
    if (!this.ctx) return;
    this.listenerYaw = yaw;
    const l = this.ctx.listener;
    const fx = Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = Math.cos(yaw) * Math.cos(pitch);
    // Web Audio is right-handed; flip Z from Babylon's left-handed world.
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(-z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(-fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      (l as unknown as { setPosition(a: number, b: number, c: number): void }).setPosition(x, y, -z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(fx, fy, -fz, 0, 1, 0);
    }
    this.listenerPos = [x, y, z];
  }
  private listenerPos: Vec3 = [0, 0, 0];
  private listenerYaw = 0;

  /** Fade out and stop whatever is playing in a voice group. */
  stopGroup(group: string, fade = 0.04) {
    const v = this.voices.get(group);
    if (!v || !this.ctx) return;
    this.voices.delete(group);
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + fade);
    try {
      v.src.stop(t + fade + 0.01);
    } catch {
      /* already stopped */
    }
  }

  play(name: string, opts: PlayOptions = {}) {
    if (!this.ctx || !this.ready || this.ctx.state !== 'running') return;
    const list = this.buffers.get(name);
    if (!list || list.length === 0) return;
    const buf = list[Math.floor(Math.random() * list.length)];
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    let node: AudioNode = src;
    if (opts.pos && opts.clean) {
      // same sound as up close, just placed left/right and slightly quieter far away
      const dx = opts.pos[0] - this.listenerPos[0];
      const dz = opts.pos[2] - this.listenerPos[2];
      const dist = Math.hypot(dx, opts.pos[1] - this.listenerPos[1], dz);
      const flat = Math.hypot(dx, dz) || 1;
      const side = (dx * Math.cos(this.listenerYaw) - dz * Math.sin(this.listenerYaw)) / flat; // +1 = right
      gain.gain.value *= Math.max(0.5, 1 / (1 + dist / 40));
      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.max(-1, Math.min(1, side * 0.8));
        node.connect(pan);
        node = pan;
      }
    } else if (opts.pos) {
      const [x, y, z] = opts.pos;
      const dist = Math.hypot(x - this.listenerPos[0], y - this.listenerPos[1], z - this.listenerPos[2]);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      // distance + occlusion muffling
      let cutoff = 18000 * Math.exp(-dist / 55);
      if (opts.occluded) cutoff = Math.min(cutoff, 1400);
      lp.frequency.value = Math.max(600, cutoff);
      if (opts.occluded) gain.gain.value *= 0.55;
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2.5;
      panner.maxDistance = 150;
      panner.rolloffFactor = 1.1;
      if (panner.positionX) {
        panner.positionX.value = x;
        panner.positionY.value = y;
        panner.positionZ.value = -z;
      } else (panner as unknown as { setPosition(a: number, b: number, c: number): void }).setPosition(x, y, -z);
      node.connect(lp);
      lp.connect(panner);
      // Environment send: far-away or walled-off shots are heard mostly through reflections.
      const send = ctx.createGain();
      const sendLevel = Math.min(0.85, 0.08 + dist / 50 + (opts.occluded ? 0.25 : 0)) * (opts.volume ?? 1);
      send.gain.value = sendLevel;
      lp.connect(send);
      send.connect(this.reverbIn);
      src.addEventListener('ended', () => send.disconnect());
      node = panner;
    }
    node.connect(gain);
    gain.connect(this.buses[opts.bus ?? 'effects']);
    const group = opts.group;
    if (group) {
      this.stopGroup(group);
      this.voices.set(group, { src, gain });
    }
    src.start(ctx.currentTime + (opts.delay ?? 0));
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      if (group && this.voices.get(group)?.src === src) this.voices.delete(group);
    };
  }

  get hitSounds() {
    return this.settings.hitSounds;
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.ready = false;
  }
}

/* ---------------- recording clean-up ---------------- */

function peakOf(b: AudioBuffer, from = 0, to = b.length): number {
  let peak = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  return peak;
}

function slice(ctx: BaseAudioContext, b: AudioBuffer, from: number, to: number): AudioBuffer {
  const len = Math.max(1, to - from);
  const out = ctx.createBuffer(b.numberOfChannels, len, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(from, to), c);
  return out;
}

/** Shorten to at most `maxSec` with a short fade-out at the end. */
function fadeOut(ctx: BaseAudioContext, b: AudioBuffer, maxSec: number, fadeSec = 0.012): AudioBuffer {
  const out = b.duration > maxSec ? slice(ctx, b, 0, Math.floor(maxSec * b.sampleRate)) : b;
  const n = Math.min(out.length, Math.floor(fadeSec * out.sampleRate));
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < n; i++) d[out.length - n + i] *= 1 - (i + 1) / n;
  }
  return out;
}

/** Drop leading and trailing silence (below −34 dB of the take's peak), keeping a few ms of lead-in. */
export function trimSilence(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  const peak = peakOf(b);
  if (peak <= 0) return b;
  const thr = peak * 0.02;
  let first = -1;
  let last = -1;
  for (let i = 0; i < b.length; i++) {
    let v = 0;
    for (let c = 0; c < b.numberOfChannels; c++) v = Math.max(v, Math.abs(b.getChannelData(c)[i]));
    if (v > thr) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return b;
  const from = Math.max(0, first - Math.floor(0.004 * b.sampleRate));
  const to = Math.min(b.length, last + Math.floor(0.03 * b.sampleRate));
  if (from === 0 && to === b.length) return b;
  return fadeOut(ctx, slice(ctx, b, from, to), Infinity, 0.01);
}

/**
 * Cut a reload recording in two at the quietest moment between its two loudest sounds (magazine out,
 * magazine in), so each half can be played when the animation gets there. Returns each half and the
 * time from its start to its loudest moment, or null when the take has no second sound at least a
 * quarter as loud as the first and 0.15 s away from it.
 */
export function splitReload(ctx: BaseAudioContext, b: AudioBuffer): { out: AudioBuffer; in: AudioBuffer; outPeak: number; inPeak: number } | null {
  const frame = Math.max(1, Math.floor(0.01 * b.sampleRate));
  const frames = Math.floor(b.length / frame);
  if (frames < 30) return null;
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = f * frame; i < (f + 1) * frame; i++) sum += d[i] * d[i];
    }
    env[f] = Math.sqrt(sum / (frame * b.numberOfChannels));
  }
  const loudest = (from: number, to: number, skip = -1, gap = 0) => {
    let at = -1;
    for (let f = from; f < to; f++) if ((skip < 0 || Math.abs(f - skip) >= gap) && (at < 0 || env[f] > env[at])) at = f;
    return at;
  };
  const first = loudest(0, frames);
  const second = loudest(0, frames, first, 15);
  if (first < 0 || second < 0 || env[second] < env[first] * 0.25) return null;
  const a = Math.min(first, second);
  const z = Math.max(first, second);
  let cut = a + 1;
  for (let f = a + 1; f < z; f++) if (env[f] < env[cut]) cut = f;
  const at = cut * frame;
  return {
    out: fadeOut(ctx, slice(ctx, b, 0, at), Infinity, 0.01),
    in: slice(ctx, b, at, b.length),
    outPeak: (a * frame) / b.sampleRate,
    inPeak: ((z - cut) * frame) / b.sampleRate,
  };
}

/**
 * Cut a recording of several footsteps into single steps: find each step's onset on a 5 ms loudness
 * envelope (rising above 30% of the take's loudest frame after dropping below 12%, at least 0.15 s
 * apart) and keep up to 0.4 s from each. Steps much quieter than the loudest are dropped.
 */
export function splitSteps(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer[] {
  const frame = Math.max(1, Math.floor(0.005 * b.sampleRate));
  const frames = Math.floor(b.length / frame);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = f * frame; i < (f + 1) * frame; i++) sum += d[i] * d[i];
    }
    env[f] = Math.sqrt(sum / (frame * b.numberOfChannels));
  }
  const top = env.reduce((m, v) => Math.max(m, v), 0);
  if (top <= 0) return [fadeOut(ctx, b, 0.5)];
  const onsets: number[] = [];
  let armed = true;
  const minGap = Math.floor(0.15 / 0.005);
  for (let f = 0; f < frames; f++) {
    if (armed && env[f] > top * 0.3 && (onsets.length === 0 || f - onsets[onsets.length - 1] >= minGap)) {
      onsets.push(f);
      armed = false;
    } else if (!armed && env[f] < top * 0.12) armed = true;
  }
  const peak = peakOf(b);
  const steps: AudioBuffer[] = [];
  onsets.forEach((f, k) => {
    const from = Math.max(0, f * frame - Math.floor(0.005 * b.sampleRate));
    const next = k + 1 < onsets.length ? onsets[k + 1] * frame - Math.floor(0.005 * b.sampleRate) : b.length;
    const to = Math.min(next, from + Math.floor(0.4 * b.sampleRate), b.length);
    if (to - from < 0.03 * b.sampleRate || peakOf(b, from, to) < peak * 0.25) return;
    steps.push(fadeOut(ctx, trimSilence(ctx, slice(ctx, b, from, to)), 0.4));
  });
  return steps.length >= 2 ? steps.slice(0, 16) : [fadeOut(ctx, b, 0.5)];
}

