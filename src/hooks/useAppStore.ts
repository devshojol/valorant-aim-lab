import { useSyncExternalStore } from 'react';
import type { CrosshairPreset, GameSettings, PracticeConfig, SessionStats } from '../types';
import { DEFAULT_PRACTICE, DEFAULT_SETTINGS, DIFFICULTY_PRESETS, GRAPHICS_PRESETS } from '../settings/defaults';
import { detectDevice } from '../settings/deviceProfile';
import { load, mergeDefaults, save } from '../services/storage';
import { enterGameFullscreen } from '../utils/fullscreen';

export type Page = 'home' | 'practice' | 'maps' | 'weapons' | 'crosshair' | 'sensitivity' | 'statistics' | 'settings';

export interface AppState {
  page: Page;
  settings: GameSettings;
  practice: PracticeConfig;
  sessions: SessionStats[];
  presets: CrosshairPreset[];
  /** Config of the running session (null = in menus). */
  playing: PracticeConfig | null;
  lastSession: SessionStats | null;
}

const MAX_SESSIONS = 300;

/** Map values saved by older builds onto the current options. */
function migrateSettings(s: GameSettings): GameSettings {
  let fpArms: GameSettings['graphics']['fpArms'] = s.graphics.fpArms;
  if (fpArms !== 'animated' && fpArms !== 'rigged' && fpArms !== 'simple') fpArms = 'animated';
  // 'rigged' was the default before the animated arms existed: move it to the new default once
  if (fpArms === 'rigged' && !load('arms-anim-migrated', false)) fpArms = 'animated';
  save('arms-anim-migrated', true);
  return fpArms === s.graphics.fpArms ? s : { ...s, graphics: { ...s.graphics, fpArms } };
}

/** Settings on first run: the defaults with a graphics preset picked for this machine. */
function firstRunSettings(): GameSettings {
  if (typeof document === 'undefined') return DEFAULT_SETTINGS;
  const { preset } = detectDevice();
  const settings = { ...DEFAULT_SETTINGS, graphics: { ...DEFAULT_SETTINGS.graphics, ...GRAPHICS_PRESETS[preset], preset } };
  save('settings', settings);
  return settings;
}

/** A saved setup on a named difficulty always uses that difficulty's current values (presets gain fields over time). */
function loadPractice(): PracticeConfig {
  const p = mergeDefaults(DEFAULT_PRACTICE, load('practice', DEFAULT_PRACTICE));
  return p.difficulty === 'custom' ? p : { ...p, tuning: DIFFICULTY_PRESETS[p.difficulty] ?? p.tuning };
}

function initialState(): AppState {
  const stored = load<GameSettings | null>('settings', null);
  return {
    page: 'home',
    settings: stored ? migrateSettings(mergeDefaults(DEFAULT_SETTINGS, stored)) : firstRunSettings(),
    practice: loadPractice(),
    sessions: load<SessionStats[]>('sessions', []),
    presets: load<CrosshairPreset[]>('crosshair-presets', []),
    playing: null,
    lastSession: null,
  };
}

let state: AppState = initialState();
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const store = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  go(page: Page) {
    set({ page });
  },
  updateSettings(fn: (s: GameSettings) => GameSettings) {
    const settings = fn(state.settings);
    save('settings', settings);
    set({ settings });
  },
  updatePractice(patch: Partial<PracticeConfig>) {
    const practice = { ...state.practice, ...patch };
    save('practice', practice);
    set({ practice });
  },
  /** Launch a session. Call from a click handler: fullscreen is requested here, on the launching click,
   *  so the later "Click to start" click keeps its user activation for pointer lock. */
  play(cfg: PracticeConfig) {
    if (state.settings.graphics.fullscreen) void enterGameFullscreen();
    save('practice', cfg);
    set({ playing: cfg, practice: cfg });
  },
  stopPlaying() {
    set({ playing: null });
  },
  addSession(s: SessionStats) {
    const sessions = [s, ...state.sessions].slice(0, MAX_SESSIONS);
    save('sessions', sessions);
    set({ sessions, lastSession: s });
  },
  clearSessions() {
    save('sessions', []);
    set({ sessions: [] });
  },
  savePresets(presets: CrosshairPreset[]) {
    save('crosshair-presets', presets);
    set({ presets });
  },
};

export function useAppStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
