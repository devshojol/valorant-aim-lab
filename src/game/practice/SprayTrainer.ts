/**
 * Spray-control trainer: groups the player's shots into sprays and scores how well each one was
 * controlled.
 *
 * Every bullet leaves along (aim + recoil pattern + random spread). The part the player controls is
 * aim + recoil pattern, the centre of the spread cone, so that is what is scored: a perfect spray
 * moves the aim by exactly minus the pattern and keeps the cone centre on the first-shot point.
 * Offsets are in degrees from that point (x to the right, y up).
 */
import type { SprayResult, SprayPoint, Vec2 } from '../../types';
import type { ShotInfo } from '../weapons/WeaponSystem';

const DEG = Math.PI / 180;
/** A spray ends after this long without a shot (seconds). */
const SPRAY_GAP = 0.4;
/** Shorter bursts are taps, not sprays, and are not scored. */
export const MIN_SPRAY_BULLETS = 5;
/** "Tight" radius in degrees: about a head at 15 m. */
export const TIGHT_DEG = 0.6;

interface ActiveSpray {
  weapon: ShotInfo['weapon'];
  refYaw: number;
  refPitch: number;
  lastShot: number;
  points: SprayPoint[];
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Score a finished spray; null when it is too short to count. */
export function scoreSpray(weapon: ShotInfo['weapon'], points: SprayPoint[]): SprayResult | null {
  if (points.length < MIN_SPRAY_BULLETS) return null;
  let err = 0;
  let pattern = 0;
  let tight = 0;
  for (const p of points) {
    const e = Math.hypot(p.control[0], p.control[1]);
    err += e;
    pattern += Math.hypot(p.recoil[0], p.recoil[1]);
    if (e <= TIGHT_DEG) tight++;
  }
  const n = points.length;
  const avgError = err / n;
  const uncontrolled = pattern / n; // the average error of holding the mouse still
  const score = uncontrolled > 0.05 ? Math.max(0, Math.min(100, Math.round(100 * (1 - avgError / uncontrolled)))) : 0;
  return { weapon: weapon.id, bullets: n, avgErrorDeg: avgError, tightPct: Math.round((tight / n) * 100), score, points };
}

export class SprayTrainer {
  private active: ActiveSpray | null = null;
  /** The last scored spray (kept on screen until the next one starts). */
  last: SprayResult | null = null;

  /** Points of the spray being fired right now, if any. */
  get livePoints(): SprayPoint[] | null {
    return this.active ? this.active.points : null;
  }

  private close(): SprayResult | null {
    const a = this.active;
    this.active = null;
    if (!a) return null;
    const r = scoreSpray(a.weapon, a.points);
    if (r) this.last = r;
    return r;
  }

  /** Record a shot. Returns the previous spray's result when this shot starts a new one. */
  onShot(shot: ShotInfo, time: number): SprayResult | null {
    let finished: SprayResult | null = null;
    if (this.active && (shot.firstShot || shot.weapon !== this.active.weapon)) finished = this.close();
    if (!this.active) this.active = { weapon: shot.weapon, refYaw: shot.aimYaw, refPitch: shot.aimPitch, lastShot: time, points: [] };
    const a = this.active;
    a.lastShot = time;
    const cp = Math.cos(a.refPitch);
    const d = shot.dir;
    const bullet: Vec2 = [(wrap(Math.atan2(d[0], d[2]) - a.refYaw) / DEG) * cp, (Math.asin(Math.max(-1, Math.min(1, d[1]))) - a.refPitch) / DEG];
    const control: Vec2 = [(wrap(shot.aimYaw - a.refYaw) / DEG) * cp + shot.recoil[0], (shot.aimPitch - a.refPitch) / DEG + shot.recoil[1]];
    a.points.push({ bullet, control, recoil: [shot.recoil[0], shot.recoil[1]] });
    return finished;
  }

  /** Call every simulation step. Returns a result once, when a spray has ended. */
  update(time: number): SprayResult | null {
    if (this.active && time - this.active.lastShot > SPRAY_GAP) return this.close();
    return null;
  }

  /** Close whatever is in progress (session end). */
  finish(): SprayResult | null {
    return this.close();
  }
}
