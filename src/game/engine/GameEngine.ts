/**
 * GameEngine — the boundary between React and the Babylon.js simulation.
 *
 * React creates one engine per practice session, subscribes to throttled HUD snapshots and
 * discrete events, and calls a small imperative API (start/resume/pause/end/updateSettings).
 * The game loop (input → physics → weapons → bots → render) runs independently of React.
 */

import type {
  EngineStatus,
  GameSettings,
  HudState,
  KillFeedEntry,
  PauseInfo,
  PracticeConfig,
  SessionStats,
  Vec3,
  WeaponId,
} from '../../types';
import { AudioEngine } from '../audio/AudioEngine';
import { encodeWav, renderAllGuns } from '../audio/gunSynth';
import { Bot, type BotContext } from '../bots/Bot';
import { BotAssets, BotVisual } from '../bots/BotVisual';
import type { AgentAssets } from '../bots/AgentVisual';
import type { WeaponSkin } from '../weapons/WeaponSkins';
import { ArmsTemplate } from '../weapons/FirstPersonArms';
import { PeekBehavior } from '../bots/behaviors/PeekBehavior';
import { BOT_SCALE, visibleSampleCount } from '../bots/perception/visibility';
import { Input } from '../core/Input';
import { drawCrosshair } from '../hud/crosshairRenderer';
import { Minimap } from '../hud/Minimap';
import { buildMapData, findLocation, type MapData } from '../maps/MapData';
import { getMapDefinition } from '../maps/registry';
import { COL_BULLET, humanoidHitboxes, rayHumanoid, type HitZone } from '../physics/CollisionWorld';
import { PlayerController } from '../player/PlayerController';
import { MODE_LABELS, PracticeDirector } from '../practice/PracticeDirector';
import { avg, pct, SessionTracker } from '../practice/SessionTracker';
import { SprayTrainer } from '../practice/SprayTrainer';
import { drawSprayPanel } from '../hud/sprayPanel';
import {
  Camera,
  Color3,
  CreateBox,
  Mesh,
  StandardMaterial,
  Color4,
  DirectionalLight,
  FreeCamera,
  FxaaPostProcess,
  HemisphericLight,
  PointLight,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  Vector3,
  type AbstractEngine,
} from '../rendering/babylon';
import { Effects } from '../rendering/Effects';
import { renderMap, type MapRenderResult } from '../rendering/MapRenderer';
import { muzzleFlashTexture, radialTexture, setTextureQuality } from '../rendering/textures';
import { ViewModel } from '../weapons/ViewModel';
import { damageAt, recoilAt, WEAPONS } from '../weapons/weaponConfigs';
import { WeaponSystem, type ShotInfo } from '../weapons/WeaponSystem';
import { enterGameFullscreen } from '../../utils/fullscreen';
import { acquireRenderHost, releaseRenderHost, webglAvailable } from './RenderHost';

const DEG = Math.PI / 180;
const BASE_HFOV = 103 * DEG;
const SIM_STEP = 1 / 120;

/** True when running inside an iframe (pointer lock may be disallowed by the embedder's sandbox). */
function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent
  }
}

export type EngineEvent =
  | { type: 'status'; status: EngineStatus; pause?: PauseInfo }
  | { type: 'hud'; hud: HudState }
  | { type: 'killfeed'; entry: KillFeedEntry }
  | { type: 'ended'; stats: SessionStats }
  | { type: 'notice'; message: string | null }
  | { type: 'error'; message: string };

export interface EngineOptions {
  /** Element the shared 3D canvas is mounted into (first child, under the overlay). */
  container: HTMLElement;
  overlay: HTMLCanvasElement;
  config: PracticeConfig;
  settings: GameSettings;
}

interface DamageIndicator {
  yaw: number;
  t: number;
}

export class GameEngine {
  private engine!: AbstractEngine;
  private scene!: Scene;
  private camera!: FreeCamera;
  private map!: MapData;
  private mapRender!: MapRenderResult;
  private shadow: ShadowGenerator | null = null;
  private fxaa: FxaaPostProcess | null = null;
  private muzzleLight: PointLight | null = null;
  private input!: Input;
  private player!: PlayerController;
  private weapons!: WeaponSystem;
  private viewModel!: ViewModel;
  private effects!: Effects;
  private audio!: AudioEngine;
  private director!: PracticeDirector;
  private tracker!: SessionTracker;
  private botAssets!: BotAssets;
  private agentAssets: AgentAssets | null = null;
  private weaponSkins = new Map<WeaponId, WeaponSkin>();
  private armsTemplate: ArmsTemplate | null = null;
  private hitboxMeshes: Mesh[] | null = null;
  private minimap!: Minimap;
  /** Spray-control mode only. */
  private spray: SprayTrainer | null = null;
  private sprayPattern: { id: WeaponId; points: [number, number][] } | null = null;
  /** Kills since the player's last death (drives the 1–5 kill sounds). */
  private killStreak = 0;
  private ctx!: BotContext;

  status: EngineStatus = 'loading';
  private listeners = new Set<(e: EngineEvent) => void>();
  private settings: GameSettings;
  private config: PracticeConfig;
  private time = 0;
  private elapsed = 0;
  private lastFrame = 0;
  private fps = 60;
  private frameMs = 16;
  /** Debug only: game-time multiplier (0 freezes the simulation; see debug.timeScale). */
  private debugTimeScale = 1;
  private hudTimer = 0;
  private visTimer = 0;
  private lastHud: HudState | null = null;
  private hitmarker = { t: 0, kind: 'body' as 'body' | 'head' | 'kill' };
  private damageIndicators: DamageIndicator[] = [];
  private deathFlash = 0;
  private killFeedId = 1;
  private ended = false;
  private disposed = false;
  private rendererName = 'WebGL2';
  private reloadCues = { out: false, in: false, bolt: false };
  /** A recorded reload is playing, and how far the reload had got (to tell a cancel from a finish). */
  private reloadClip = false;
  private lastReloadProgress = 0;
  /** Adaptive resolution: extra render-scale factor (1 = the user's setting) and its controller state. */
  private dynScale = 1;
  private adaptT = 0;
  private adaptFrames = 0;
  private adaptHold = 0;
  private adaptBackoff = 4;
  private adaptLastUp = -1e9;
  private slowTime = 0;
  private slowWarned = false;
  private drawCallsTotal = 0;
  private drawCallsFrame = 0;
  private canvas!: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private readonly frameFn = () => this.frame();
  private readonly ctxObservers: { remove: () => void }[] = [];
  /** Resolves when the scene is built and shaders are compiled (status 'ready'). */
  readonly ready: Promise<void>;
  private readonly overlay: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private readonly onBlur = () => this.pause('blur');
  private readonly onVisibility = () => {
    if (document.hidden) this.pause('hidden');
  };
  private readonly onResize = () => this.resize();
  /** Milliseconds from init start to each loading phase (diagnostics). */
  readonly loadTimings: Record<string, number> = {};

  private constructor(opts: EngineOptions) {
    this.container = opts.container;
    this.overlay = opts.overlay;
    this.settings = opts.settings;
    this.config = opts.config;
    const octx = this.overlay.getContext('2d');
    if (!octx) throw new Error('2D canvas unavailable');
    this.overlayCtx = octx;
    this.ready = this.init();
  }

  get isDisposed() {
    return this.disposed;
  }

  /**
   * Start building a session. Returns at once; await `engine.ready` for the scene.
   * `dispose()` may be called at any time, including while it is still loading.
   */
  static create(opts: EngineOptions): GameEngine {
    const g = new GameEngine(opts);
    return g;
  }

  /* ------------------------------------------------------------------ */
  /* Setup                                                               */
  /* ------------------------------------------------------------------ */

  private async init() {
    const T0 = performance.now();
    const mark = (name: string) => { (this.loadTimings as Record<string, number>)[name] = Math.round(performance.now() - T0); };
    if (!webglAvailable()) throw new Error('WebGL is not available in this browser. Enable hardware acceleration or try Chrome/Edge.');
    // Reuse the shared engine so shaders compiled in earlier sessions stay cached.
    const host = await acquireRenderHost(this, this.settings.graphics.renderer === 'webgpu' ? 'webgpu' : 'webgl2');
    if (this.disposed) {
      releaseRenderHost(this);
      return;
    }
    this.engine = host.engine;
    this.canvas = host.canvas;
    this.rendererName = host.name;
    if (host.fallback) this.emit({ type: 'notice', message: 'WebGPU unavailable here — using WebGL 2.' });
    this.container.insertBefore(this.canvas, this.container.firstChild);
    mark('renderEngine');
    this.engine.disablePerformanceMonitorInBackground = true;
    this.applyResolution();
    this.applyFpsCap();
    setTextureQuality(this.settings.graphics.textureQuality);

    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.skipPointerMovePicking = true;
    scene.constantlyUpdateMeshUnderPointer = false;
    const def = getMapDefinition(this.config.mapId);
    scene.clearColor = Color4.FromHexString(def.palette.sky[1] + 'ff');
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0045;
    scene.fogColor = Color3.FromHexString(def.palette.fog);
    if (this.settings.graphics.postFx) {
      scene.imageProcessingConfiguration.contrast = 1.18;
      scene.imageProcessingConfiguration.exposure = 1.05;
      scene.imageProcessingConfiguration.toneMappingEnabled = true;
      scene.imageProcessingConfiguration.toneMappingType = 1; // ACES
      scene.imageProcessingConfiguration.vignetteEnabled = true;
      scene.imageProcessingConfiguration.vignetteWeight = 0.6;
    } else {
      // low-end: skip the per-pixel grading maths in every material
      scene.imageProcessingConfiguration.isEnabled = false;
    }
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);

    // camera
    const cam = new FreeCamera('player-cam', new Vector3(0, 2, 0), scene);
    cam.minZ = 0.03;
    cam.maxZ = 500;
    cam.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    cam.fov = BASE_HFOV;
    cam.inputs.clear();
    this.camera = cam;

    // lights (created before materials compile/freeze)
    // Bright, even stylised lighting: sky/ground hemisphere + warm sun (shadows) + cool fill.
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, -0.1), scene);
    const simpleLight = this.settings.graphics.lighting === 'simple';
    hemi.intensity = simpleLight ? 1.0 : 0.85;
    hemi.diffuse = Color3.FromHexString('#dfeaff');
    hemi.groundColor = Color3.FromHexString('#8f7d6a');
    hemi.specular = Color3.Black();
    const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.38).normalize(), scene);
    sun.position = new Vector3(60, 90, -50);
    sun.intensity = 1.25;
    sun.diffuse = Color3.FromHexString('#fff1d8');
    if (!simpleLight) {
      const fill = new DirectionalLight('fill', new Vector3(0.5, -0.6, -0.6).normalize(), scene);
      fill.intensity = 0.38;
      fill.diffuse = Color3.FromHexString('#c9dcff');
      fill.specular = Color3.Black();
      fill.shadowEnabled = false;
    }
    const fx = this.settings.graphics.effects;
    if (fx !== 'low') {
      this.muzzleLight = new PointLight('muzzle-light', new Vector3(0, -100, 0), scene);
      this.muzzleLight.diffuse = Color3.FromHexString('#ffc27a');
      this.muzzleLight.specular = Color3.Black();
      this.muzzleLight.range = 7;
      this.muzzleLight.intensity = 0;
    }

    const shadows = this.settings.graphics.shadows;
    if (shadows !== 'off') {
      const size = shadows === 'high' ? 4096 : 2048;
      const sg = new ShadowGenerator(size, sun);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = shadows === 'high' ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_LOW;
      sg.bias = 0.0015;
      sg.normalBias = 0.02;
      sg.darkness = 0.45;
      this.shadow = sg;
    }

    // map
    this.map = buildMapData(def);
    this.minimap = new Minimap(this.map);
    mark('mapData');
    this.mapRender = renderMap(scene, this.map, this.shadow);
    mark('mapRender');
    if (this.shadow) {
      const sm = this.shadow.getShadowMap();
      if (sm) sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    }

    // gameplay
    this.input = new Input(this.canvas);
    this.input.rawRequested = this.settings.sensitivity.rawInput;
    this.input.onLockChange = (locked) => {
      if (!locked && this.status === 'running' && !this.input.unlockedLook) this.pause('pointer-lock');
    };
    this.input.onEscape = () => this.pause('user');
    this.player = new PlayerController(this.map.world);
    this.player.events = {
      onFootstep: () => {
        this.audio.play('step', { bus: 'foot', volume: 0.35, rate: 0.94 + Math.random() * 0.12, group: 'step-player' });
        this.director?.hear(this.ctx, this.player.pos.x, this.player.pos.z, 14);
      },
      onJump: () => this.audio.play('jump', { bus: 'foot', volume: 0.5 }),
      onLand: (impact) => this.audio.play('land', { bus: 'foot', volume: Math.min(1, 0.3 + impact * 0.08) }),
    };
    this.weapons = new WeaponSystem(this.config.primary, this.config.secondary);
    this.weapons.infiniteAmmo = this.config.infiniteAmmo;
    this.weapons.events = {
      onShot: (s) => this.resolvePlayerShot(s),
      onReloadStart: () => {
        this.reloadCues = { out: false, in: false, bolt: false };
      },
      onEquip: () => this.audio.play('equip', { bus: 'effects', volume: 0.5 }),
      onDryFire: () => this.audio.play('dry', { bus: 'effects', volume: 0.6 }),
    };
    mark('gameplay');
    this.effects = new Effects(scene, fx);
    this.audio = new AudioEngine(this.settings.audio);
    this.botAssets = new BotAssets(
      scene,
      muzzleFlashTexture(scene),
      radialTexture(scene, 'blob', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 64),
    );

    mark('fxBots');

    // Optional local 3D models (public/models): weapon skins and the rigged agent for bots.
    // Each falls back to the built-in simple model if its file is missing or broken.
    let skins = new Map<WeaponId, WeaponSkin>();
    if (__LOCAL_MODELS__) {
      const g = this.settings.graphics;
      const wantAgent = g.botModel === 'agent';
      const skinIds: WeaponId[] = g.gunModels === 'skins' ? [this.config.primary, this.config.secondary, ...(wantAgent ? (['vandal'] as WeaponId[]) : [])] : [];
      const failed: string[] = [];
      const [loadedSkins, agents, arms] = await Promise.all([
        skinIds.length
          ? import('../weapons/WeaponSkins').then((m) => m.loadWeaponSkins(scene, skinIds)).catch((err) => {
              console.warn('[weapons] skins unavailable', err);
              failed.push('weapon skins');
              return new Map<WeaponId, WeaponSkin>();
            })
          : Promise.resolve(new Map<WeaponId, WeaponSkin>()),
        wantAgent
          ? import('../bots/AgentVisual').then((m) => m.AgentAssets.load(scene, 'models/sage.glb', this.botAssets)).catch((err) => {
              console.warn('[bots] agent model unavailable — using training dummies', err);
              failed.push('the agent bot model');
              return null;
            })
          : Promise.resolve(null),
        // animated arms pack first (if chosen), then the glove-arm model, then the built-in arms
        g.fpArms === 'animated'
          ? ArmsTemplate.loadAnimated(scene).catch((err) => {
              console.warn('[viewmodel] animated arms unavailable — trying the glove-arm model', err);
              return ArmsTemplate.load(scene).catch(() => null);
            })
          : g.fpArms === 'rigged'
            ? ArmsTemplate.load(scene).catch((err) => {
                console.warn('[viewmodel] arm model unavailable — using the built-in arms', err);
                return null;
              })
            : Promise.resolve(null),
      ]);
      if (this.disposed) {
        agents?.dispose();
        arms?.dispose();
        for (const k of loadedSkins.values()) k.dispose();
        return;
      }
      skins = loadedSkins;
      this.weaponSkins = loadedSkins;
      this.agentAssets = agents;
      this.armsTemplate = arms;
      if (agents) agents.rifle = loadedSkins.get('vandal') ?? null;
      if (failed.length) this.emit({ type: 'notice', message: `Couldn't load ${failed.join(' and ')} — using the simple models.` });
      mark('models');
    }
    // First-person arms: the arm model when it loaded, else the built-in rig (no file needed).
    if (!this.armsTemplate && this.settings.graphics.fpArms !== 'simple') this.armsTemplate = new ArmsTemplate();
    this.viewModel = new ViewModel(scene, cam, [this.config.primary, this.config.secondary], skins, this.armsTemplate);
    this.tracker = new SessionTracker(this.config);
    if (this.config.mode === 'spray') this.spray = new SprayTrainer();
    const location = findLocation(def, this.config.locationId);
    this.director = new PracticeDirector({
      map: this.map,
      location,
      config: this.config,
      tracker: this.tracker,
      createVisual: (id) =>
        this.agentAssets ? this.agentAssets.create(id, fx !== 'low') : new BotVisual(this.botAssets, id, fx !== 'low'),
      rng: Math.random,
    });

    const sp = this.director.playerSpawn;
    this.player.spawn(sp.pos[0], sp.pos[1], sp.pos[2], sp.yaw);

    this.ctx = {
      time: 0,
      world: this.map.world,
      map: this.map,
      player: this.player,
      botsShootBack: this.config.botsShootBack || this.config.mode === 'deathmatch',
      bots: this.director.bots,
      rng: Math.random,
      botFire: (bot, origin, dir) => this.resolveBotShot(bot, origin, dir),
      onBotFootstep: (bot) => {
        const occluded = !this.map.world.segmentClear(bot.x, bot.y + 1.5, bot.z, ...this.player.eye());
        this.audio.play('step', { pos: [bot.x, bot.y + 0.1, bot.z], bus: 'foot', volume: 0.9, occluded, rate: 0.94 + Math.random() * 0.12, group: `step-bot-${bot.id}` });
      },
    };
    this.director.start(this.ctx);
    mark('director');
    if (this.director.unusableSpots.length) {
      console.info('[TAL] spots not visible from this spawn were skipped:', this.director.unusableSpots);
    }

    this.applyAntialias();
    this.updateCamera();

    // robustness hooks
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    const lost = this.engine.onContextLostObservable.add(() => {
      this.pause('context-lost');
      this.emit({ type: 'notice', message: 'Graphics context lost — waiting for the browser to restore it…' });
    });
    const restored = this.engine.onContextRestoredObservable.add(() => {
      this.emit({ type: 'notice', message: 'Graphics restored. Click to resume.' });
    });
    this.ctxObservers.push({ remove: () => this.engine.onContextLostObservable.remove(lost) }, { remove: () => this.engine.onContextRestoredObservable.remove(restored) });

    this.resize();
    this.lastFrame = performance.now();
    this.engine.runRenderLoop(this.frameFn);
    mark('renderLoop');
    // warm-up render (compiles shaders, renders the static shadow map once)
    await scene.whenReadyAsync();
    if (this.disposed) return;
    mark('whenReady');
    this.setStatus('ready');
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  on(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EngineEvent) {
    for (const l of this.listeners) l(e);
  }

  private setStatus(status: EngineStatus, pause?: PauseInfo) {
    this.status = status;
    this.emit({ type: 'status', status, pause });
  }

  /** Why the last start() call did not begin play ('cooldown' = re-lock too soon after Esc, 'blocked' = browser refused). */
  startIssue: 'cooldown' | 'blocked' | null = null;

  /**
   * Begin or resume play. Must be called from a click handler (pointer lock + audio need a gesture).
   *
   * Order matters: pointer lock is requested FIRST, fullscreen only after the lock is granted.
   * Fullscreen consumes the click's transient user activation while pointer lock doesn't, so the
   * reverse order makes the lock request fail with NotAllowedError.
   *
   * `freeMouse` skips pointer lock and aims with the plain (visible) cursor — the user's explicit
   * choice when the browser keeps refusing capture. Inside an embedded frame where capture is not
   * permitted, free-mouse aiming is used automatically.
   */
  async start(opts: { freeMouse?: boolean } = {}): Promise<boolean> {
    if (this.ended || this.disposed) return false;
    this.audio.init();
    this.audio.resume();
    this.input.rawRequested = this.settings.sensitivity.rawInput;
    this.startIssue = null;
    const embedded = isEmbedded();
    const locked = opts.freeMouse ? false : await this.input.requestLock();
    if (locked) {
      this.input.unlockedLook = false;
      if (this.settings.graphics.fullscreen) this.enterFullscreen();
      this.emit({ type: 'notice', message: null });
    } else {
      const cooldown = performance.now() - this.input.lastUnlock < 2500;
      if (!opts.freeMouse && (cooldown || !embedded)) {
        // Top-level tab: never silently degrade aiming — stay paused and ask for another click.
        this.startIssue = cooldown ? 'cooldown' : 'blocked';
        return false;
      }
      this.input.unlockedLook = true;
      this.emit({
        type: 'notice',
        message: embedded
          ? 'Mouse capture is not allowed inside this embedded page — aiming uses the free cursor. Open the app in its own tab for proper aiming. Press Esc to pause.'
          : 'Playing without mouse capture — aiming uses the free cursor. Press Esc to pause, then "Click to resume" to try capture again.',
      });
    }
    this.input.enabled = true;
    this.input.releaseAll();
    this.lastFrame = performance.now();
    this.setStatus('running');
    return true;
  }

  private updateHitboxView() {
    const meshes = this.hitboxMeshes!;
    this.director.bots.forEach((b, i) => {
      const boxes = humanoidHitboxes(b.crouch, BOT_SCALE);
      (['legs', 'body', 'head'] as HitZone[]).forEach((zone, k) => {
        const m = meshes[i * 3 + k];
        if (!m) return;
        const bx = boxes[zone];
        m.setEnabled(b.alive);
        m.scaling.set(bx.hx * 2, bx.hy * 2, bx.hz * 2);
        m.rotation.y = b.yaw;
        const c = Math.cos(b.yaw);
        const sn = Math.sin(b.yaw);
        m.position.set(b.x + bx.cx * c + bx.cz * sn, b.y + bx.cy, b.z - bx.cx * sn + bx.cz * c);
      });
    });
  }

  /** Fullscreen (+ Keyboard Lock). Only called once the pointer is locked — see start(). */
  private enterFullscreen() {
    void enterGameFullscreen();
  }

  pause(reason: PauseInfo['reason']) {
    if (this.status !== 'running') return;
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.exitLock();
    this.setStatus('paused', { reason });
  }

  /** End the session and return the final statistics. */
  end(): SessionStats {
    if (!this.ended) {
      this.ended = true;
      this.input.enabled = false;
      this.input.exitLock();
      const lastSpray = this.spray?.finish();
      if (lastSpray) this.tracker.spray(lastSpray);
      const stats = this.tracker.finish(this.elapsed);
      this.setStatus('ended');
      this.emit({ type: 'ended', stats });
      return stats;
    }
    return this.tracker.finish(this.elapsed);
  }

  updateSettings(s: GameSettings) {
    const prev = this.settings;
    this.settings = s;
    if (this.status === 'loading' || this.disposed) return; // init reads this.settings as it builds
    this.audio.applySettings(s.audio);
    this.input.rawRequested = s.sensitivity.rawInput;
    if (prev.graphics.resolutionScale !== s.graphics.resolutionScale || prev.graphics.adaptiveResolution !== s.graphics.adaptiveResolution) {
      if (!s.graphics.adaptiveResolution) this.dynScale = 1;
      this.applyResolution();
    }
    if (prev.graphics.fpsCap !== s.graphics.fpsCap) this.applyFpsCap();
    if (prev.graphics.antialias !== s.graphics.antialias) this.applyAntialias();
  }

  get rendererLabel() {
    return this.rendererName;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    this.engine?.stopRenderLoop(this.frameFn);
    for (const o of this.ctxObservers) o.remove();
    this.input?.dispose();
    this.director?.dispose();
    this.viewModel?.dispose();
    this.effects?.dispose();
    this.agentAssets?.dispose();
    for (const k of this.weaponSkins.values()) k.dispose();
    this.armsTemplate?.dispose();
    this.botAssets?.dispose();
    this.mapRender?.dispose();
    this.audio?.dispose();
    this.scene?.dispose();
    // The engine itself stays alive (shared across sessions); just hand it back.
    releaseRenderHost(this);
    this.listeners.clear();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering setup helpers                                             */
  /* ------------------------------------------------------------------ */

  private applyResolution() {
    const g = this.settings.graphics;
    // Low-end tiers never render above one canvas pixel per CSS pixel.
    const dprCap = g.preset === 'high' ? 2 : g.preset === 'potato' || g.textureQuality === 'low' ? 1 : 1.5;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const scale = Math.max(0.35, Math.max(0.4, Math.min(1, g.resolutionScale)) * this.dynScale * dpr);
    this.engine.setHardwareScalingLevel(1 / scale);
  }

  private applyFpsCap() {
    const cap = this.settings.graphics.fpsCap;
    this.engine.maxFPS = cap > 0 ? cap : undefined;
  }

  /**
   * Adaptive resolution. Every half second of play, compare the measured frame rate with the target
   * (60, or the FPS cap if lower): drop the render scale a step when it's short, and try a step back
   * up after a quiet spell. If stepping up caused a drop, wait twice as long before trying again, so
   * a machine that can't hold the higher scale doesn't flip back and forth.
   */
  private adaptResolution(rawDt: number) {
    const g = this.settings.graphics;
    this.adaptT += rawDt;
    this.adaptFrames++;
    if (this.adaptT < 0.5) return;
    const fps = this.adaptFrames / this.adaptT;
    const span = this.adaptT;
    this.adaptT = 0;
    this.adaptFrames = 0;
    const target = g.fpsCap > 0 ? Math.min(60, g.fpsCap) : 60;

    // Still slow at the floor: tell the player once that a lower preset would help.
    const atFloor = !g.adaptiveResolution || this.dynScale <= 0.5;
    this.slowTime = fps < Math.min(40, target * 0.7) && atFloor ? this.slowTime + span : 0;
    if (this.slowTime > 6 && !this.slowWarned && g.preset !== 'potato') {
      this.slowWarned = true;
      this.emit({ type: 'notice', message: 'Low frame rate — try a lower graphics preset (Settings → Graphics → Potato or Low).' });
    }

    if (!g.adaptiveResolution) return;
    const wall = performance.now() / 1000;
    if (fps < target * 0.85) {
      if (this.dynScale > 0.5) {
        // a drop soon after stepping up means that step was too much: back off for longer
        this.adaptBackoff = wall - this.adaptLastUp < 3 ? Math.min(60, this.adaptBackoff * 2) : this.adaptBackoff;
        this.dynScale = Math.max(0.5, this.dynScale - (fps < target * 0.6 ? 0.2 : 0.1));
        this.applyResolution();
      }
      this.adaptHold = 0;
    } else if (this.dynScale < 1 && fps > target * 0.95) {
      this.adaptHold += span;
      if (this.adaptHold >= this.adaptBackoff) {
        this.adaptHold = 0;
        this.adaptLastUp = wall;
        this.dynScale = Math.min(1, this.dynScale + 0.1);
        this.applyResolution();
      }
    } else this.adaptHold = 0;
  }

  private applyAntialias() {
    if (!this.camera) return;
    if (this.settings.graphics.antialias && !this.fxaa) this.fxaa = new FxaaPostProcess('fxaa', 1, this.camera);
    else if (!this.settings.graphics.antialias && this.fxaa) {
      this.fxaa.dispose(this.camera);
      this.fxaa = null;
    }
  }

  private resize() {
    this.engine?.resize();
    const dpr = window.devicePixelRatio || 1;
    const r = this.overlay.getBoundingClientRect();
    this.overlay.width = Math.max(1, Math.round(r.width * dpr));
    this.overlay.height = Math.max(1, Math.round(r.height * dpr));
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */

  private frame() {
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) dt = 1 / 240;
    this.frameMs = this.frameMs * 0.9 + dt * 1000 * 0.1;
    this.fps = 1000 / this.frameMs;
    const running = this.status === 'running';
    if (running) this.adaptResolution(dt);
    dt *= this.debugTimeScale; // tests can slow or freeze game time (rendering continues)

    let mdx = 0;
    let mdy = 0;
    if (running) {
      // Apply look first for minimum input latency.
      [mdx, mdy] = this.input.takeMouse();
      if (this.player.alive) this.player.applyLook(mdx, mdy, this.settings.sensitivity, this.weapons.isAds);
      const steps = Math.ceil(dt / SIM_STEP);
      const sdt = steps > 0 ? dt / steps : 0;
      for (let i = 0; i < steps; i++) this.simulate(sdt);
      this.elapsed += dt;
      if (this.config.durationSec > 0 && this.elapsed >= this.config.durationSec) this.end();
    }

    this.updateCamera();
    this.viewModel.visible = this.player.alive;
    this.viewModel.update(dt, this.weapons, this.player.speed, this.player.grounded, mdx, mdy);
    this.effects.update(dt);
    if (this.muzzleLight) this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 40);
    const [ex, ey, ez] = this.player.eye();
    this.audio.setListener(ex, ey, ez, this.player.yaw, this.player.pitch);

    if (this.hitboxMeshes) this.updateHitboxView();
    this.scene.render();
    const dc = (this.engine as unknown as { _drawCalls?: { current: number } })._drawCalls?.current ?? 0;
    this.drawCallsFrame = dc >= this.drawCallsTotal ? dc - this.drawCallsTotal : dc;
    this.drawCallsTotal = dc;
    this.drawOverlay(dt);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 12;
      this.emitHud();
    }
  }

  private simulate(dt: number) {
    this.time += dt;
    this.ctx.time = this.time;
    this.player.update(dt, this.input);
    this.weapons.update(dt, this.input, this.player);
    this.reloadSounds();
    this.director.update(this.ctx, dt, (x, y, z, yaw) => this.respawnPlayer(x, y, z, yaw));
    const sprayDone = this.spray?.update(this.time);
    if (sprayDone) this.tracker.spray(sprayDone);
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 1 / 30;
      this.trackVisibility();
    }
  }

  private reloadSounds() {
    if (!this.weapons.reloading) {
      // a reload cut short (weapon switch, death) silences its recording instead of letting it run on
      if (this.reloadClip && this.lastReloadProgress < 0.95) this.audio.stopGroup('reload');
      this.reloadClip = false;
      return;
    }
    this.lastReloadProgress = this.weapons.reloadProgress;
    const p = this.viewModel.reloadCueProgress(this.weapons); // cues follow the animation
    const c = this.reloadCues;
    // a recorded full reload (public/sounds) replaces the three synthesized cues
    const recorded = [`reload-${this.weapons.weapon.id}`, 'reload'].find((n) => this.audio.isRecorded(n));
    if (recorded) {
      if (!c.out) {
        c.out = c.in = c.bolt = true;
        this.reloadClip = true;
        this.audio.play(recorded, { volume: 0.8, group: 'reload' });
      }
      return;
    }
    if (!c.out && p > 0.08) {
      c.out = true;
      this.audio.play('mag-out', { volume: 0.6 });
    }
    if (!c.in && p > 0.6) {
      c.in = true;
      this.audio.play('mag-in', { volume: 0.7 });
    }
    if (!c.bolt && p > 0.86 && this.weapons.weapon.slot === 'primary') {
      c.bolt = true;
      this.audio.play('bolt', { volume: 0.6 });
    }
  }

  private updateCamera() {
    const [x, y, z] = this.player.eye();
    this.camera.position.set(x, y, z);
    const [py, pp] = this.weapons.viewPunch();
    this.camera.rotation.y = this.player.yaw + py * DEG;
    this.camera.rotation.x = -(this.player.pitch + pp * DEG);
    const w = this.weapons.weapon;
    const zoom = w.altFire === 'ads' ? 1 + (w.ads.zoom - 1) * this.weapons.ads : 1;
    this.camera.fov = 2 * Math.atan(Math.tan(BASE_HFOV / 2) / zoom);
  }

  private respawnPlayer(x: number, y: number, z: number, yaw: number) {
    this.player.spawn(x, y, z, yaw);
    this.weapons.refill();
    this.damageIndicators.length = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Combat resolution                                                   */
  /* ------------------------------------------------------------------ */

  private resolvePlayerShot(shot: ShotInfo) {
    const { origin: o, dir: d, weapon } = shot;
    this.tracker.shot(shot);
    if (this.spray) {
      const done = this.spray.onShot(shot, this.time);
      if (done) this.tracker.spray(done);
    }
    this.audio.play(weapon.sound, { bus: 'weapons', volume: weapon.sound === 'rifle-suppressed' ? 0.65 : 0.8, rate: 0.97 + Math.random() * 0.06 });
    this.viewModel.onShot();
    if (this.muzzleLight && weapon.sound !== 'rifle-suppressed') {
      const m = this.viewModel.muzzleWorld();
      this.muzzleLight.position.set(m[0], m[1], m[2]);
      this.muzzleLight.intensity = 2.2;
    }

    const wall = this.map.world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 250, COL_BULLET);
    const maxT = wall ? wall.t : 250;
    let best: { bot: Bot; t: number; zone: HitZone } | null = null;
    for (const bot of this.director.bots) {
      if (!bot.alive) continue;
      const h = rayHumanoid(o[0], o[1], o[2], d[0], d[1], d[2], bot.x, bot.y, bot.z, bot.yaw, bot.crouch, best ? best.t : maxT, BOT_SCALE);
      if (h && (!best || h.t < best.t)) best = { bot, t: h.t, zone: h.zone };
    }

    let end: Vec3;
    if (best) {
      const { bot, t, zone } = best;
      end = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      const dmg = damageAt(weapon, t)[zone];
      this.tracker.hit(shot, zone, dmg);
      if (bot.visibleToPlayer && !bot.hitThisExposure && bot.visibleSince >= 0) {
        this.tracker.reaction((this.time - bot.visibleSince) * 1000);
      }
      bot.hitThisExposure = true;
      const exposureStart = bot.visibleSince;
      const killed = bot.damage(dmg);
      this.effects.fleshImpact(end[0], end[1], end[2], zone === 'head');
      bot.alertTo(this.player.pos.x, this.player.pos.z);
      bot.brain?.onDamaged?.(bot, this.ctx);
      if (killed) {
        const killMs = exposureStart >= 0 ? (this.time - exposureStart) * 1000 : null;
        this.tracker.kill(weapon.id, zone === 'head', killMs);
        this.hitmarker = { t: 0.35, kind: 'kill' };
        this.killStreak++;
        if (this.audio.hitSounds) {
          // kill-streak sound 1–5 (5 repeats after the fifth); a weapon's own set wins if recorded
          const n = Math.min(5, this.killStreak);
          const own = `${weapon.id}-kill${n}`;
          const killSound = this.audio.isRecorded(own) ? own : `kill${n}`;
          // A recorded kill sound already carries its own cue, so the synthesized headshot ping would
          // clash with it; keep the ping only when it's recorded too or the kill sound is synthesized.
          if (zone === 'head' && (!this.audio.isRecorded(killSound) || this.audio.isRecorded('headshot'))) this.audio.play('headshot', { volume: 0.7 });
          // one kill sound at a time: a quick second kill cuts the first instead of stacking on it
          this.audio.play(killSound, { volume: 0.55, delay: 0.03, group: 'kill' });
        }
        this.emit({
          type: 'killfeed',
          entry: { id: this.killFeedId++, victim: bot.name, weapon: weapon.name, headshot: zone === 'head', byPlayer: true, time: Date.now() },
        });
        this.director.onBotKilled(bot, this.ctx);
      } else {
        this.hitmarker = { t: 0.2, kind: zone === 'head' ? 'head' : 'body' };
        if (this.audio.hitSounds) this.audio.play(zone === 'head' ? 'headshot' : 'hit', { volume: zone === 'head' ? 0.55 : 0.5 });
      }
    } else {
      if (wall) {
        end = [wall.x, wall.y, wall.z];
        this.effects.wallImpact(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz);
        this.audio.play('impact', { pos: end, volume: 0.35 });
      } else end = [o[0] + d[0] * 250, o[1] + d[1] * 250, o[2] + d[2] * 250];
      if (this.config.mode === 'jiggle') {
        const baiting = this.director.bots.some(
          (b) => b.alive && b.visibleToPlayer && b.brain instanceof PeekBehavior && b.brain.baiting,
        );
        if (baiting) this.tracker.baited();
      }
    }
    if (weapon.tracer) {
      const m = this.viewModel.muzzleWorld();
      this.effects.tracer(m, end);
    }
    // gunfire is loud: alert roaming bots
    this.director.hear(this.ctx, this.player.pos.x, this.player.pos.z, 45);
  }

  private resolveBotShot(bot: Bot, o: Vec3, d: Vec3) {
    const world = this.map.world;
    const p = this.player;
    const eye = p.eye();
    const muzzle = bot.visual ? bot.visual.muzzleWorld() : o;
    // enemy shots use the same recording and level as the player's own gun, only placed left/right
    this.audio.play(bot.weapon.sound, {
      pos: muzzle,
      clean: true,
      bus: 'weapons',
      volume: bot.weapon.sound === 'rifle-suppressed' ? 0.65 : 0.8,
      rate: 0.97 + Math.random() * 0.06,
    });

    const wall = world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 200, COL_BULLET);
    const maxT = wall ? wall.t : 200;
    let end: Vec3;
    const h = p.alive ? rayHumanoid(o[0], o[1], o[2], d[0], d[1], d[2], p.pos.x, p.pos.y, p.pos.z, p.yaw, p.crouch, maxT) : null;
    if (h) {
      end = [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t];
      // Headshot chance 0 means no headshot damage at all, so a stray bullet to the head counts as a body hit.
      const zone = h.zone === 'head' && (bot.tuning.headshotChance ?? 0.2) <= 0 ? 'body' : h.zone;
      const dmg = Math.round(damageAt(bot.weapon, h.t)[zone] * Math.max(0, bot.tuning.damageMult ?? 1));
      const before = p.health + p.armor;
      const killed = p.damage(dmg);
      this.tracker.damageTaken(Math.min(before, dmg));
      this.audio.play('hurt', { volume: 0.6 });
      this.damageIndicators.push({ yaw: Math.atan2(bot.x - p.pos.x, bot.z - p.pos.z), t: 1.2 });
      if (killed) {
        this.tracker.death();
        this.killStreak = 0;
        this.deathFlash = 1;
        this.emit({
          type: 'killfeed',
          entry: { id: this.killFeedId++, victim: 'You', weapon: `${bot.name} · ${bot.weapon.name}`, headshot: zone === 'head', byPlayer: false, time: Date.now() },
        });
        this.director.onPlayerDeath(this.ctx);
      }
    } else {
      if (wall) {
        end = [wall.x, wall.y, wall.z];
        this.effects.wallImpact(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz);
      } else end = [o[0] + d[0] * 200, o[1] + d[1] * 200, o[2] + d[2] * 200];
      // near miss whiz
      const tx = eye[0] - o[0];
      const ty = eye[1] - o[1];
      const tz = eye[2] - o[2];
      const proj = tx * d[0] + ty * d[1] + tz * d[2];
      if (proj > 0 && proj < maxT) {
        const cx = o[0] + d[0] * proj - eye[0];
        const cy = o[1] + d[1] * proj - eye[1];
        const cz = o[2] + d[2] * proj - eye[2];
        if (cx * cx + cy * cy + cz * cz < 1.5 * 1.5) this.audio.play('whiz', { pos: [eye[0] + cx, eye[1] + cy, eye[2] + cz], volume: 0.5 });
      }
    }
    this.effects.tracer(muzzle, end, 260);
  }

  /** Track when each bot becomes visible on the player's screen (for reaction-time metrics). */
  private trackVisibility() {
    const [ex, ey, ez] = this.player.eye();
    const hfov = this.camera.fov;
    const aspect = this.engine.getAspectRatio(this.camera);
    const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    for (const b of this.director.bots) {
      let visible = false;
      if (b.alive && this.player.alive) {
        const dx = b.x - ex;
        const dz = b.z - ez;
        const dy = b.y + 1.2 * BOT_SCALE - ey;
        let yawDiff = Math.atan2(dx, dz) - this.player.yaw;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
        const pitchDiff = Math.atan2(dy, Math.hypot(dx, dz)) - this.player.pitch;
        if (Math.abs(yawDiff) < hfov / 2 && Math.abs(pitchDiff) < vfov / 2) {
          visible = visibleSampleCount(this.map.world, ex, ey, ez, b.x, b.y, b.z, b.crouch) > 0;
        }
      }
      if (visible && !b.visibleToPlayer) {
        b.visibleToPlayer = true;
        b.visibleSince = this.time;
        b.hitThisExposure = false;
      } else if (!visible && b.visibleToPlayer) {
        b.visibleToPlayer = false;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Overlay (crosshair, hitmarkers, damage direction)                   */
  /* ------------------------------------------------------------------ */

  private drawOverlay(dt: number) {
    const ctx = this.overlayCtx;
    const W = this.overlay.width;
    const H = this.overlay.height;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, W, H);
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);

    if (this.player.alive && this.status !== 'ended') {
      // convert spread (degrees) to crosshair pixels
      const halfW = W / dpr / 2;
      const k = halfW / Math.tan(this.camera.fov / 2);
      const toPx = (deg: number) => Math.tan(deg * DEG) * k;
      drawCrosshair(ctx, this.settings.crosshair, cx, cy, dpr, {
        movementPx: toPx(this.weapons.lastMovementError) * 0.6,
        firingPx: toPx(this.weapons.lastFiringError) * 1.6,
      });
    }

    if (this.settings.hud.showHitmarkers && this.hitmarker.t > 0) {
      this.hitmarker.t -= dt;
      const a = Math.min(1, this.hitmarker.t / 0.15);
      const kind = this.hitmarker.kind;
      ctx.strokeStyle = kind === 'kill' ? `rgba(255,70,85,${a})` : kind === 'head' ? `rgba(255,230,120,${a})` : `rgba(255,255,255,${a})`;
      ctx.lineWidth = (kind === 'kill' ? 3 : 2) * dpr;
      const r0 = (kind === 'kill' ? 9 : 7) * dpr;
      const r1 = (kind === 'kill' ? 18 : 13) * dpr;
      ctx.beginPath();
      for (const [sx, sy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        ctx.moveTo(cx + sx * r0, cy + sy * r0);
        ctx.lineTo(cx + sx * r1, cy + sy * r1);
      }
      ctx.stroke();
    }

    if (this.settings.hud.showMinimap && this.status !== 'ended') {
      this.minimap.draw(
        ctx,
        dpr,
        12,
        12,
        { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw, alive: this.player.alive },
        this.director.bots.map((b) => ({ x: b.x, z: b.z, alive: b.alive, visible: b.visibleToPlayer })),
        { size: 220, viewRange: 26, enemyRange: this.settings.hud.minimapEnemyRange, fov: this.camera.fov },
      );
    }

    if (this.spray && this.status !== 'ended') {
      const w = this.weapons.weapon;
      if (this.sprayPattern?.id !== w.id) {
        const points: [number, number][] = [];
        for (let i = 0; i < w.magazine; i++) points.push(recoilAt(w, i));
        this.sprayPattern = { id: w.id, points };
      }
      drawSprayPanel(ctx, dpr, W, H, {
        weaponName: w.name,
        pattern: this.sprayPattern.points,
        live: this.spray.livePoints,
        last: this.spray.last,
        summary: this.tracker.stats.spray,
      });
    }

    if (this.settings.hud.showDamageIndicator) {
      for (let i = this.damageIndicators.length - 1; i >= 0; i--) {
        const di = this.damageIndicators[i];
        di.t -= dt;
        if (di.t <= 0) {
          this.damageIndicators.splice(i, 1);
          continue;
        }
        const rel = di.yaw - this.player.yaw; // 0 = in front
        const a = Math.min(1, di.t / 0.6);
        const r = 110 * dpr;
        // screen angle: front = up (-PI/2)
        const ang = rel - Math.PI / 2;
        ctx.strokeStyle = `rgba(255,60,70,${0.85 * a})`;
        ctx.lineWidth = 6 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, r, ang - 0.32, ang + 0.32);
        ctx.stroke();
      }
    }

    if (this.deathFlash > 0) this.deathFlash = Math.max(0, this.deathFlash - dt * 0.8);
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                 */
  /* ------------------------------------------------------------------ */

  private emitHud() {
    const st = this.tracker.stats;
    const w = this.weapons.weapon;
    const hud: HudState = {
      health: Math.ceil(this.player.health),
      armor: Math.ceil(this.player.armor),
      weaponId: w.id,
      weaponName: w.name,
      ammo: this.weapons.slot.ammo,
      reserve: this.weapons.infiniteAmmo ? -1 : this.weapons.slot.reserve,
      reloading: this.weapons.reloading,
      reloadProgress: Math.round(this.weapons.reloadProgress * 20) / 20,
      ads: this.weapons.isAds,
      kills: st.kills,
      deaths: st.deaths,
      score: this.tracker.computeScore(),
      escapes: st.escapes,
      timeLeft: this.config.durationSec > 0 ? Math.max(0, Math.ceil(this.config.durationSec - this.elapsed)) : -1,
      elapsed: Math.floor(this.elapsed),
      fps: Math.round(this.fps),
      frameMs: Math.round(this.frameMs * 10) / 10,
      drawCalls: this.drawCallsFrame,
      activeBots: this.director.activeBots,
      accuracy: Math.round(pct(st.hits, st.shots)),
      headshotPct: Math.round(pct(st.headshots, st.hits)),
      avgReaction: Math.round(avg(st.reactionTimes)),
      speed: Math.round(this.player.speed * 10) / 10,
      dead: !this.player.alive,
      modeLabel: MODE_LABELS[this.config.mode],
    };
    const prev = this.lastHud;
    if (prev && (Object.keys(hud) as (keyof HudState)[]).every((k) => prev[k] === hud[k])) return;
    this.lastHud = hud;
    this.emit({ type: 'hud', hud });
  }

  /* ------------------------------------------------------------------ */
  /* Debug / automation API (used by tests)                              */
  /* ------------------------------------------------------------------ */

  readonly debug = {
    state: () => ({
      status: this.status,
      renderer: this.rendererName,
      renderScale: this.dynScale,
      time: this.time,
      elapsed: this.elapsed,
      fps: Math.round(this.fps),
      drawCalls: this.drawCallsFrame,
      meshes: this.scene.getActiveMeshes().length,
      player: {
        pos: { ...this.player.pos },
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        alive: this.player.alive,
        health: this.player.health,
        armor: this.player.armor,
        speed: this.player.speed,
        crouch: this.player.crouch,
      },
      weapon: { id: this.weapons.weapon.id, ammo: this.weapons.slot.ammo, reloading: this.weapons.reloading, recoilIndex: this.weapons.recoilIndex },
      bots: this.director.bots.map((b) => ({
        id: b.id,
        name: b.name,
        alive: b.alive,
        pos: [b.x, b.y, b.z],
        yaw: b.yaw,
        crouch: b.crouch,
        health: b.health + b.armor,
        brain: b.brain?.describe(),
        seesPlayer: b.seesPlayer,
        visibleToPlayer: b.visibleToPlayer,
        shots: b.shotsFired,
      })),
      stats: { ...this.tracker.stats },
      unusableSpots: this.director.unusableSpots,
    }),
    /** Start without pointer lock (automation). */
    forceRun: () => {
      this.audio.init();
      this.input.unlockedLook = true;
      this.input.enabled = true;
      this.setStatus('running');
    },
    key: (action: Parameters<Input['inject']>[0], down: boolean) => this.input.inject(action, down),
    mouse: (dx: number, dy: number) => this.input.injectMouse(dx, dy),
    setView: (yawDeg: number, pitchDeg: number) => {
      this.player.yaw = yawDeg * DEG;
      this.player.pitch = pitchDeg * DEG;
    },
    /** Point the camera at a bot's head (or chest). */
    aimAtBot: (index: number, zone: 'head' | 'body' = 'head') => {
      const b = this.director.bots.filter((x) => x.alive)[index];
      if (!b) return false;
      const [ex, ey, ez] = this.player.eye();
      const legH = 0.86 - 0.55 * b.crouch;
      const ty = b.y + (zone === 'head' ? legH + 0.75 : legH + 0.3) * BOT_SCALE;
      this.player.yaw = Math.atan2(b.x - ex, b.z - ez);
      this.player.pitch = Math.atan2(ty - ey, Math.hypot(b.x - ex, b.z - ez));
      return true;
    },
    teleport: (x: number, y: number, z: number) => {
      this.player.pos.x = x;
      this.player.pos.y = y;
      this.player.pos.z = z;
    },
    /** Show the bots' hit boxes as wireframes (model/hitbox alignment checks). */
    hitboxes: (on: boolean) => {
      if (!on) {
        for (const m of this.hitboxMeshes ?? []) m.dispose();
        this.hitboxMeshes = null;
        return;
      }
      if (this.hitboxMeshes) return;
      const mat = new StandardMaterial('hitbox-wire', this.scene);
      mat.wireframe = true;
      mat.emissiveColor = new Color3(0.2, 1, 0.4);
      mat.disableLighting = true;
      this.hitboxMeshes = [];
      for (let i = 0; i < this.director.bots.length * 3; i++) {
        const m = CreateBox('hitbox', { size: 1 }, this.scene);
        m.material = mat;
        m.isPickable = false;
        m.rotationQuaternion = null;
        this.hitboxMeshes.push(m);
      }
    },
    /** Scale game time (0 = frozen, 1 = normal) so screenshots can be taken at exact moments. */
    timeScale: (s: number) => {
      this.debugTimeScale = Math.max(0, s);
    },
    godMode: (on: boolean) => {
      this.ctx.botsShootBack = !on;
    },
    weapons: () => Object.keys(WEAPONS),
    audio: () => ({ ready: this.audio.ready, gunsReady: this.audio.gunsReady, overrides: this.audio.sampleOverrides }),
    /** Render every gunshot variant to base64 WAV (for listening tests / previews). */
    renderGunWavs: async (sampleRate = 48000) => {
      const guns = await renderAllGuns(sampleRate, 2);
      const out: Record<string, string[]> = {};
      for (const [id, list] of guns) {
        out[id] = list.map((b) => {
          const bytes = new Uint8Array(encodeWav(b));
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(bin);
        });
      }
      return out;
    },
  };
}
