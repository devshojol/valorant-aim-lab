import type { PracticeConfig, SessionStats, SprayResult, WeaponId } from '../../types';
import type { HitZone } from '../physics/CollisionWorld';
import type { ShotInfo } from '../weapons/WeaponSystem';

function emptyStats(cfg: PracticeConfig): SessionStats {
  const now = Date.now();
  return {
    id: `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    startedAt: now,
    endedAt: now,
    durationSec: 0,
    mapId: cfg.mapId,
    locationId: cfg.locationId,
    side: cfg.side,
    mode: cfg.mode,
    difficulty: cfg.difficulty,
    behavior: cfg.behavior,
    primary: cfg.primary,
    shots: 0,
    hits: 0,
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
    kills: 0,
    deaths: 0,
    damageDealt: 0,
    damageTaken: 0,
    firstShots: 0,
    firstShotHits: 0,
    sprayShots: 0,
    sprayHits: 0,
    movingShots: 0,
    movingHits: 0,
    reactionTimes: [],
    killTimes: [],
    escapes: 0,
    baitedShots: 0,
    perWeapon: {},
    score: 0,
  };
}

export class SessionTracker {
  readonly stats: SessionStats;
  private hsKills = 0;

  constructor(readonly config: PracticeConfig) {
    this.stats = emptyStats(config);
  }

  private weapon(id: WeaponId) {
    let w = this.stats.perWeapon[id];
    if (!w) {
      w = { shots: 0, hits: 0, headshots: 0, kills: 0 };
      this.stats.perWeapon[id] = w;
    }
    return w;
  }

  shot(s: ShotInfo) {
    const st = this.stats;
    st.shots++;
    this.weapon(s.weapon.id).shots++;
    if (s.firstShot) st.firstShots++;
    if (s.bulletIndex >= 3) st.sprayShots++;
    if (s.moving) st.movingShots++;
  }

  hit(s: ShotInfo, zone: HitZone, damage: number) {
    const st = this.stats;
    st.hits++;
    st.damageDealt += damage;
    const w = this.weapon(s.weapon.id);
    w.hits++;
    if (zone === 'head') {
      st.headshots++;
      w.headshots++;
    } else if (zone === 'body') st.bodyshots++;
    else st.legshots++;
    if (s.firstShot) st.firstShotHits++;
    if (s.bulletIndex >= 3) st.sprayHits++;
    if (s.moving) st.movingHits++;
  }

  kill(weapon: WeaponId, headshot: boolean, killTimeMs: number | null) {
    this.stats.kills++;
    this.weapon(weapon).kills++;
    if (headshot) this.hsKills++;
    if (killTimeMs !== null && killTimeMs > 0 && killTimeMs < 10000) this.stats.killTimes.push(Math.round(killTimeMs));
  }

  reaction(ms: number) {
    if (ms > 60 && ms < 3000) this.stats.reactionTimes.push(Math.round(ms));
  }

  death() {
    this.stats.deaths++;
  }

  damageTaken(d: number) {
    this.stats.damageTaken += d;
  }

  escape() {
    this.stats.escapes++;
  }

  /** Add a scored spray to the session's running averages. */
  spray(r: SprayResult) {
    const s = this.stats.spray ?? { sprays: 0, avgScore: 0, bestScore: 0, avgErrorDeg: 0, avgTightPct: 0 };
    const n = s.sprays + 1;
    this.stats.spray = {
      sprays: n,
      avgScore: (s.avgScore * s.sprays + r.score) / n,
      bestScore: Math.max(s.bestScore, r.score),
      avgErrorDeg: (s.avgErrorDeg * s.sprays + r.avgErrorDeg) / n,
      avgTightPct: (s.avgTightPct * s.sprays + r.tightPct) / n,
    };
  }

  baited() {
    this.stats.baitedShots++;
  }

  computeScore(): number {
    const st = this.stats;
    if (st.mode === 'spray') {
      st.score = Math.round(st.spray?.avgScore ?? 0);
      return st.score;
    }
    const reactionBonus = st.reactionTimes.reduce((a, rt) => a + Math.max(0, 700 - rt) / 10, 0);
    let score = st.kills * 100 + this.hsKills * 50 - st.deaths * 120;
    if (st.mode === 'angle-hold') score += reactionBonus - st.escapes * 50;
    else if (st.mode === 'jiggle') score += reactionBonus * 0.5 - st.baitedShots * 10 - st.escapes * 40;
    st.score = Math.round(score);
    return st.score;
  }

  finish(durationSec: number): SessionStats {
    this.stats.endedAt = Date.now();
    this.stats.durationSec = Math.round(durationSec);
    this.computeScore();
    return { ...this.stats, spray: this.stats.spray && { ...this.stats.spray }, reactionTimes: [...this.stats.reactionTimes], killTimes: [...this.stats.killTimes] };
  }
}

export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
