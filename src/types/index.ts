// Shared, engine-agnostic types used by both the React UI layer and the game engine layer.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/* ------------------------------------------------------------------ */
/* Weapons                                                             */
/* ------------------------------------------------------------------ */

export type WeaponId = 'vandal' | 'phantom' | 'sheriff' | 'classic';
export type WeaponSlot = 'primary' | 'secondary';

export interface DamageBracket {
  /** Upper bound (meters) of this bracket. */
  maxRange: number;
  head: number;
  body: number;
  legs: number;
}

export interface SpreadConfig {
  /** Hip-fire first-shot spread (degrees, cone half-angle). */
  base: number;
  /** ADS first-shot spread (degrees). */
  ads: number;
  /** Extra spread added per shot while spraying (degrees). */
  firingPerShot: number;
  /** Cap on accumulated firing spread (degrees). */
  firingMax: number;
  /** Spread at full run speed (degrees). */
  moveMax: number;
  /** Fraction of run speed below which there is no movement error. */
  accurateSpeedFraction: number;
  /** Spread while airborne (degrees). */
  air: number;
  /** Multiplier applied while crouched. */
  crouchMult: number;
}

export interface RecoilConfig {
  /** Cumulative recoil offset per bullet index, [yaw, pitch] degrees. Pitch + = up, yaw + = right. */
  pattern: Vec2[];
  /** Index the pattern loops back to once exhausted. */
  loopFrom: number;
  /** Random jitter added per shot (degrees). */
  jitter: number;
  /** Fraction of the recoil offset that is also applied to the camera (view punch). */
  viewKick: number;
  /** Bullets of recoil index recovered per second once you stop firing. */
  recoveryRate: number;
  /** Delay after the last shot before recovery starts (seconds). */
  recoveryDelay: number;
  /** Multiplier applied while aiming down sights. */
  adsMult: number;
}

export interface WeaponConfig {
  id: WeaponId;
  name: string;
  slot: WeaponSlot;
  category: 'Rifle' | 'Sidearm';
  description: string;
  fireRate: number; // rounds per second
  auto: boolean;
  magazine: number;
  reserve: number;
  reloadTime: number;
  equipTime: number;
  damage: DamageBracket[];
  spread: SpreadConfig;
  recoil: RecoilConfig;
  /** Right-click behaviour. */
  altFire: 'ads' | 'burst';
  ads: { zoom: number; moveSpeedMult: number; fireRateMult: number; transitionTime: number };
  burst?: { count: number; interval: number; spread: number; cooldown: number };
  runSpeedMult: number;
  tracer: boolean;
  sound: 'rifle-heavy' | 'rifle-suppressed' | 'pistol-light' | 'pistol-heavy';
  color: string;
}

/* ------------------------------------------------------------------ */
/* Bots                                                                */
/* ------------------------------------------------------------------ */

export type BotBehavior =
  | 'mixed'
  | 'stationary'
  | 'jiggle'
  | 'shoulder'
  | 'wide-swing'
  | 'crouch-spray'
  | 'counter-strafe';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'radiant' | 'custom';

export interface BotTuning {
  /** Base reaction time in milliseconds. */
  reactionMs: number;
  /** 0..1 — shapes aim error and recoil control. */
  accuracy: number;
  /** 0..1 — chance the bot aims for the head each time it spots the player. At 0 bots never deal headshot damage. */
  headshotChance: number;
  /** Multiplier on the damage bots deal to the player (1 = real weapon damage). */
  damageMult: number;
  /** 0..1 — how often bots initiate peeks. */
  peekFrequency: number;
  /** Seconds a bot stays exposed on a committed peek. */
  peekDuration: number;
  /** Movement speed multiplier. */
  moveSpeed: number;
  /** 0..1 — chance to commit, swing wide, chase. */
  aggression: number;
  /** Shots per burst. */
  burstLength: number;
  /** 0..1 — chance to crouch during a fight. */
  crouchChance: number;
}

/* ------------------------------------------------------------------ */
/* Maps                                                                */
/* ------------------------------------------------------------------ */

export type Side = 'attack' | 'defend';

export interface SpawnPoint {
  id: string;
  name: string;
  /** World position of the feet. */
  pos: Vec3;
  /** Yaw in degrees (0 = +Z / north, 90 = +X / east). */
  yaw: number;
}

export interface EnemySpot {
  id: string;
  name: string;
  /** Hidden position (feet). */
  cover: Vec3;
  /** Horizontal strafe direction that exposes the bot. */
  peekDir: Vec2;
  /** Maximum distance a bot can travel along peekDir. */
  maxPeek: number;
}

export interface SideSetup {
  playerSpawns: SpawnPoint[];
  enemySpots: EnemySpot[];
}

export interface MapLocation {
  id: string;
  name: string;
  description: string;
  /** Preview focus area in world units (x/z). */
  focus: { minX: number; minZ: number; maxX: number; maxZ: number };
  sides: Record<Side, SideSetup>;
}

export interface MapSummary {
  id: string;
  name: string;
  inspiredBy: string;
  theme: string;
  playable: boolean;
  locations: { id: string; name: string }[];
}

/* ------------------------------------------------------------------ */
/* Practice                                                            */
/* ------------------------------------------------------------------ */

export type PracticeMode = 'angle-hold' | 'jiggle' | 'deathmatch' | 'spray';

export interface PracticeConfig {
  mapId: string;
  locationId: string;
  side: Side;
  playerSpawnId: string;
  enemySpotIds: string[];
  mode: PracticeMode;
  primary: WeaponId;
  secondary: WeaponId;
  botCount: number;
  behavior: BotBehavior;
  difficulty: Difficulty;
  tuning: BotTuning;
  /** Session length in seconds; 0 = unlimited. */
  durationSec: number;
  botsShootBack: boolean;
  infiniteAmmo: boolean;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface SensitivitySettings {
  /** In-game sensitivity on the same scale as Valorant (0.07° per count). */
  sensitivity: number;
  dpi: number;
  horizontalMult: number;
  verticalMult: number;
  adsMult: number;
  scopedMult: number;
  invertY: boolean;
  /** Request unadjusted (raw) movement from the Pointer Lock API when supported. */
  rawInput: boolean;
}

export interface CrosshairLineSettings {
  show: boolean;
  opacity: number;
  length: number;
  thickness: number;
  offset: number;
  movementError: boolean;
  movementMult: number;
  firingError: boolean;
  firingMult: number;
}

export interface CrosshairSettings {
  color: string;
  outlines: boolean;
  outlineOpacity: number;
  outlineThickness: number;
  centerDot: boolean;
  centerDotOpacity: number;
  centerDotThickness: number;
  /** When false the crosshair is static regardless of per-line error toggles. */
  dynamic: boolean;
  inner: CrosshairLineSettings;
  outer: CrosshairLineSettings;
}

export interface CrosshairPreset {
  id: string;
  name: string;
  settings: CrosshairSettings;
}

export type GraphicsPreset = 'potato' | 'low' | 'medium' | 'high' | 'custom';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  shadows: 'off' | 'medium' | 'high';
  /** Render scale relative to the device pixel ratio (0.5 .. 1). */
  resolutionScale: number;
  antialias: boolean;
  effects: 'low' | 'medium' | 'high';
  /** Tone mapping, contrast and vignette. Off saves per-pixel work on integrated GPUs. */
  postFx: boolean;
  /** 'simple' drops the fill light (one light less per pixel); the sky light is raised to compensate. */
  lighting: 'simple' | 'full';
  /** 'low' halves the map texture size and turns anisotropic filtering off. */
  textureQuality: 'low' | 'high';
  /** Lower the render resolution automatically while the frame rate is under target, and restore it after. */
  adaptiveResolution: boolean;
  /** Frame-rate limit in frames per second (0 = unlimited). */
  fpsCap: number;
  renderer: 'webgl2' | 'webgpu';
  /** Enter fullscreen (with Keyboard Lock) when a session starts — stops Ctrl+W closing the tab. */
  fullscreen: boolean;
  /** Bot look: the rigged agent model (public/models) or the built-in blocky training dummy. */
  botModel: 'agent' | 'dummy';
  /** Weapon look: GLB skins from public/models/weapons, or the built-in simple guns. */
  gunModels: 'skins' | 'simple';
  /**
   * First-person arms: the animated arms pack (fp-arms-anim.glb: draw/fire/reload clips), the posed
   * glove-arm model (fp-arms.glb), or the simple block hands. Missing files fall back to built-in jointed arms.
   */
  fpArms: 'animated' | 'rigged' | 'simple';
}

export interface AudioSettings {
  master: number;
  weapons: number;
  effects: number;
  footsteps: number;
  hitSounds: boolean;
}

export interface HudSettings {
  showFps: boolean;
  showTimer: boolean;
  showKills: boolean;
  showHealth: boolean;
  showAmmo: boolean;
  showKillFeed: boolean;
  showHitmarkers: boolean;
  showDamageIndicator: boolean;
  showPerfMetrics: boolean;
  /** Minimap in the top-left corner. */
  showMinimap: boolean;
  /** Enemies closer than this many metres are always shown on the minimap (0 = never). */
  minimapEnemyRange: number;
}

export interface GameSettings {
  sensitivity: SensitivitySettings;
  crosshair: CrosshairSettings;
  graphics: GraphicsSettings;
  audio: AudioSettings;
  hud: HudSettings;
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export interface WeaponStatLine {
  shots: number;
  hits: number;
  headshots: number;
  kills: number;
}

/** One bullet of a spray, as offsets in degrees from the first-shot aim point (x right, y up). */
export interface SprayPoint {
  /** Where the bullet went (control + random spread). */
  bullet: Vec2;
  /** Centre of the spread cone: aim movement + recoil pattern. This is the part the player controls. */
  control: Vec2;
  /** The recoil pattern's offset for this bullet (where it goes with no control). */
  recoil: Vec2;
}

export interface SprayResult {
  weapon: WeaponId;
  bullets: number;
  /** Average distance of the cone centre from the first-shot point. */
  avgErrorDeg: number;
  /** Share of bullets whose cone centre stayed within the tight radius. */
  tightPct: number;
  /** 0 = mouse held still, 100 = recoil fully cancelled. */
  score: number;
  points: SprayPoint[];
}

/** Spray-control totals for a session. */
export interface SpraySummary {
  sprays: number;
  avgScore: number;
  bestScore: number;
  avgErrorDeg: number;
  avgTightPct: number;
}

export interface SessionStats {
  id: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  mapId: string;
  locationId: string;
  side: Side;
  mode: PracticeMode;
  difficulty: Difficulty;
  behavior: BotBehavior;
  primary: WeaponId;
  shots: number;
  hits: number;
  headshots: number;
  bodyshots: number;
  legshots: number;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  firstShots: number;
  firstShotHits: number;
  sprayShots: number;
  sprayHits: number;
  movingShots: number;
  movingHits: number;
  reactionTimes: number[];
  killTimes: number[];
  /** Bots that were visible and returned to cover alive. */
  escapes: number;
  /** Shots fired at bots that were only jiggling/shoulder peeking. */
  baitedShots: number;
  perWeapon: Partial<Record<WeaponId, WeaponStatLine>>;
  /** Spray-control results (spray mode only). */
  spray?: SpraySummary;
  score: number;
}

/* ------------------------------------------------------------------ */
/* Engine <-> UI                                                       */
/* ------------------------------------------------------------------ */

export interface HudState {
  health: number;
  armor: number;
  weaponId: WeaponId;
  weaponName: string;
  ammo: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  ads: boolean;
  kills: number;
  deaths: number;
  score: number;
  escapes: number;
  timeLeft: number; // seconds, -1 if unlimited
  elapsed: number;
  fps: number;
  frameMs: number;
  drawCalls: number;
  activeBots: number;
  accuracy: number;
  headshotPct: number;
  avgReaction: number;
  speed: number;
  dead: boolean;
  modeLabel: string;
}

export interface KillFeedEntry {
  id: number;
  victim: string;
  weapon: string;
  headshot: boolean;
  byPlayer: boolean;
  time: number;
}

export type EngineStatus = 'loading' | 'ready' | 'running' | 'paused' | 'ended' | 'error';

export interface PauseInfo {
  reason: 'user' | 'pointer-lock' | 'blur' | 'hidden' | 'context-lost' | 'start';
}
