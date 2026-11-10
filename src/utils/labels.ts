import type { BotBehavior, Difficulty, PracticeMode, SessionStats } from '../types';
import { MAP_SUMMARIES } from '../game/maps/registry';

export const MODE_INFO: Record<PracticeMode, { label: string; short: string; desc: string }> = {
  'angle-hold': {
    label: 'Angle Holding',
    short: 'Angle Hold',
    desc: 'Hold an angle while bots peek from cover with real tactics. Kill them before they retreat — escapes cost points.',
  },
  jiggle: {
    label: 'Jiggle Peek Training',
    short: 'Jiggle',
    desc: 'Bots jiggle and shoulder-peek to bait your shots, then occasionally commit. Wasted bait shots are tracked.',
  },
  deathmatch: {
    label: 'Deathmatch',
    short: 'Deathmatch',
    desc: 'Bots roam the whole map, hunt you by sound and sight, take cover when hurt and re-peek.',
  },
};

export const BEHAVIOR_INFO: Record<BotBehavior, { label: string; desc: string }> = {
  mixed: { label: 'Mixed', desc: 'Varied tactics weighted by aggression.' },
  stationary: { label: 'Stationary', desc: 'Holds an exposed angle and fires on sight.' },
  jiggle: { label: 'Jiggle', desc: 'Rapid out-and-back peeks, sometimes ending in a commit.' },
  shoulder: { label: 'Shoulder', desc: 'Shows only a shoulder to bait shots.' },
  'wide-swing': { label: 'Wide Swing', desc: 'Backs up, sprints wide across your view, stops and fights.' },
  'crouch-spray': { label: 'Crouch Spray', desc: 'Peeks, crouches and sprays with recoil control.' },
  'counter-strafe': { label: 'Counter-Strafe', desc: 'ADAD strafes, stopping sharply before each burst.' },
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  radiant: 'Radiant',
  custom: 'Custom',
};

export function mapName(id: string) {
  return MAP_SUMMARIES.find((m) => m.id === id)?.name ?? id;
}

export function locationName(mapId: string, locId: string) {
  return MAP_SUMMARIES.find((m) => m.id === mapId)?.locations.find((l) => l.id === locId)?.name ?? locId;
}

export function fmtDuration(sec: number) {
  if (sec <= 0) return '∞';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function fmtDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function accuracy(s: Pick<SessionStats, 'hits' | 'shots'>) {
  return s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
}

export function hsPct(s: Pick<SessionStats, 'headshots' | 'hits'>) {
  return s.hits ? Math.round((s.headshots / s.hits) * 100) : 0;
}

export function avgMs(xs: number[]) {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

export function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
