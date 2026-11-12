import type {
  BotTuning,
  CrosshairSettings,
  Difficulty,
  GameSettings,
  GraphicsPreset,
  GraphicsSettings,
  PracticeConfig,
} from '../types';
import { DEFAULT_MAP_ID } from '../game/maps/registry';

export const DIFFICULTY_PRESETS: Record<Exclude<Difficulty, 'custom'>, BotTuning> = {
  easy: {
    reactionMs: 650,
    accuracy: 0.22,
    headshotChance: 0.05,
    damageMult: 0.6,
    peekFrequency: 0.3,
    peekDuration: 1.4,
    moveSpeed: 0.75,
    aggression: 0.2,
    burstLength: 3,
    crouchChance: 0.08,
  },
  normal: {
    reactionMs: 420,
    accuracy: 0.45,
    headshotChance: 0.18,
    damageMult: 0.85,
    peekFrequency: 0.5,
    peekDuration: 1.0,
    moveSpeed: 0.9,
    aggression: 0.4,
    burstLength: 4,
    crouchChance: 0.2,
  },
  hard: {
    reactionMs: 270,
    accuracy: 0.68,
    headshotChance: 0.4,
    damageMult: 1,
    peekFrequency: 0.7,
    peekDuration: 0.75,
    moveSpeed: 1.0,
    aggression: 0.6,
    burstLength: 5,
    crouchChance: 0.3,
  },
  radiant: {
    reactionMs: 175,
    accuracy: 0.86,
    headshotChance: 0.65,
    damageMult: 1,
    peekFrequency: 0.9,
    peekDuration: 0.55,
    moveSpeed: 1.05,
    aggression: 0.8,
    burstLength: 6,
    crouchChance: 0.4,
  },
};

export const DEFAULT_CROSSHAIR: CrosshairSettings = {
  color: '#00ff7b',
  outlines: true,
  outlineOpacity: 0.5,
  outlineThickness: 1,
  centerDot: false,
  centerDotOpacity: 1,
  centerDotThickness: 2,
  dynamic: true,
  inner: {
    show: true,
    opacity: 0.8,
    length: 6,
    thickness: 2,
    offset: 3,
    movementError: false,
    movementMult: 1,
    firingError: true,
    firingMult: 1,
  },
  outer: {
    show: true,
    opacity: 0.35,
    length: 2,
    thickness: 2,
    offset: 10,
    movementError: true,
    movementMult: 1,
    firingError: true,
    firingMult: 1,
  },
};

export const CROSSHAIR_COLORS: { name: string; hex: string }[] = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Green', hex: '#00ff7b' },
  { name: 'Yellow Green', hex: '#c8ff00' },
  { name: 'Green Yellow', hex: '#e6ff4f' },
  { name: 'Yellow', hex: '#ffff00' },
  { name: 'Cyan', hex: '#00ffff' },
  { name: 'Pink', hex: '#ff4ff0' },
  { name: 'Red', hex: '#ff2a2a' },
];

/** Everything a preset decides. Renderer, fullscreen, adaptive resolution and the FPS cap stay as the user set them. */
export type GraphicsPresetValues = Omit<GraphicsSettings, 'preset' | 'renderer' | 'fullscreen' | 'adaptiveResolution' | 'fpsCap'>;

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPreset, 'custom'>, GraphicsPresetValues> = {
  // For machines with no dedicated GPU (or software rendering): nothing that costs per-pixel work.
  potato: {
    shadows: 'off', resolutionScale: 0.6, antialias: false, effects: 'low', postFx: false, lighting: 'simple', textureQuality: 'low',
    botModel: 'dummy', gunModels: 'simple', fpArms: 'simple',
  },
  low: {
    shadows: 'off', resolutionScale: 0.75, antialias: false, effects: 'low', postFx: true, lighting: 'simple', textureQuality: 'high',
    botModel: 'dummy', gunModels: 'skins', fpArms: 'animated',
  },
  medium: {
    shadows: 'medium', resolutionScale: 1, antialias: true, effects: 'medium', postFx: true, lighting: 'full', textureQuality: 'high',
    botModel: 'agent', gunModels: 'skins', fpArms: 'animated',
  },
  high: {
    shadows: 'high', resolutionScale: 1, antialias: true, effects: 'high', postFx: true, lighting: 'full', textureQuality: 'high',
    botModel: 'agent', gunModels: 'skins', fpArms: 'animated',
  },
};

export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: {
    sensitivity: 0.4,
    dpi: 800,
    horizontalMult: 1,
    verticalMult: 1,
    adsMult: 1,
    scopedMult: 1,
    invertY: false,
    rawInput: true,
  },
  crosshair: DEFAULT_CROSSHAIR,
  graphics: { preset: 'medium', renderer: 'webgl2', fullscreen: true, adaptiveResolution: true, fpsCap: 0, ...GRAPHICS_PRESETS.medium },
  audio: { master: 0.8, weapons: 0.8, effects: 0.8, footsteps: 0.9, hitSounds: true },
  hud: {
    showFps: true,
    showTimer: true,
    showKills: true,
    showHealth: true,
    showAmmo: true,
    showKillFeed: true,
    showHitmarkers: true,
    showDamageIndicator: true,
    showPerfMetrics: false,
    showMinimap: true,
    minimapEnemyRange: 30,
  },
};

export const DEFAULT_PRACTICE: PracticeConfig = {
  mapId: DEFAULT_MAP_ID,
  locationId: 'a-main',
  side: 'attack',
  playerSpawnId: 'a-main-arch',
  enemySpotIds: [],
  mode: 'angle-hold',
  primary: 'vandal',
  secondary: 'classic',
  botCount: 2,
  behavior: 'mixed',
  difficulty: 'normal',
  tuning: DIFFICULTY_PRESETS.normal,
  durationSec: 120,
  botsShootBack: true,
  infiniteAmmo: true,
};

/** Degrees of rotation per mouse count per unit of sensitivity (Valorant scale). */
export const YAW_DEG_PER_COUNT = 0.07;

export function edpi(dpi: number, sens: number) {
  return dpi * sens;
}

/** Centimetres of mouse travel for a full 360° turn. */
export function cmPer360(dpi: number, sens: number) {
  if (dpi <= 0 || sens <= 0) return 0;
  return (360 / (sens * YAW_DEG_PER_COUNT * dpi)) * 2.54;
}
