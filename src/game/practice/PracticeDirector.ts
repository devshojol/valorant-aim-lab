/**
 * Runs a practice mode: owns the bots, assigns peek spots, handles deaths/respawns
 * and mode-specific bookkeeping (escapes, bait shots, deathmatch spawns).
 */

import type { EnemySpot, MapLocation, PracticeConfig, SpawnPoint } from '../../types';
import { Bot, type BotContext } from '../bots/Bot';
import type { BotView } from '../bots/BotVisual';
import { DeathmatchBehavior } from '../bots/behaviors/DeathmatchBehavior';
import { PeekBehavior } from '../bots/behaviors/PeekBehavior';
import { analysePeekLine, isHumanoidVisible } from '../bots/perception/visibility';
import type { MapData } from '../maps/MapData';
import { STAND_EYE } from '../player/PlayerController';
import type { SessionTracker } from './SessionTracker';

/** Bots never peek closer than this to the player's spawn (horizontal metres). */
export const MIN_SPOT_DISTANCE = 6;

/** Closest horizontal distance between a spawn and a spot's whole peek line (cover → full peek). */
export function spotDistance(spawn: SpawnPoint, spot: EnemySpot): number {
  const ax = spot.cover[0], az = spot.cover[2];
  const bx = ax + spot.peekDir[0] * spot.maxPeek, bz = az + spot.peekDir[1] * spot.maxPeek;
  const px = spawn.pos[0], pz = spawn.pos[2];
  const vx = bx - ax, vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0;
  return Math.hypot(ax + vx * t - px, az + vz * t - pz);
}

/**
 * Whether a spot works from a spawn: the bot can hide behind its cover and become visible by
 * peeking, and its peek line stays a sensible distance away (spots are shared by all spawns of a
 * side, so one generated for a far spawn can sit right next to another spawn).
 */
export function spotUsableFrom(world: MapData['world'], spawn: SpawnPoint, spot: EnemySpot): boolean {
  if (spotDistance(spawn, spot) < MIN_SPOT_DISTANCE) return false;
  const eye: [number, number, number] = [spawn.pos[0], spawn.pos[1] + STAND_EYE, spawn.pos[2]];
  const info = analysePeekLine(world, eye, spot.cover[0], spot.cover[1], spot.cover[2], spot.peekDir[0], spot.peekDir[1], spot.maxPeek);
  return info.exposeAt !== null && info.hideAt !== null;
}

interface PendingRespawn {
  bot: Bot;
  at: number;
}

export interface DirectorDeps {
  map: MapData;
  location: MapLocation;
  config: PracticeConfig;
  tracker: SessionTracker;
  /** Builds the on-screen body for a new bot (null = headless, e.g. tests). */
  createVisual: ((id: number) => BotView) | null;
  rng: () => number;
}

export const MODE_LABELS: Record<PracticeConfig['mode'], string> = {
  'angle-hold': 'Angle Holding',
  jiggle: 'Jiggle Peek Training',
  deathmatch: 'Deathmatch',
};

export class PracticeDirector {
  readonly bots: Bot[] = [];
  readonly spots: EnemySpot[];
  readonly playerSpawn: SpawnPoint;
  readonly unusableSpots: string[] = [];
  private pending: PendingRespawn[] = [];
  private playerRespawnAt = -1;
  private spawnCells: [number, number, number][] = [];

  constructor(private readonly d: DirectorDeps) {
    const setup = d.location.sides[d.config.side];
    this.playerSpawn = setup.playerSpawns.find((s) => s.id === d.config.playerSpawnId) ?? setup.playerSpawns[0];
    const chosen = d.config.enemySpotIds.length
      ? setup.enemySpots.filter((s) => d.config.enemySpotIds.includes(s.id))
      : setup.enemySpots;
    const usable = (list: EnemySpot[]) =>
      list.filter((s) => {
        const ok = spotUsableFrom(d.map.world, this.playerSpawn, s);
        if (!ok && !this.unusableSpots.includes(s.id)) this.unusableSpots.push(s.id);
        return ok;
      });
    let spots = usable(chosen);
    if (spots.length === 0) spots = usable(setup.enemySpots);
    if (spots.length === 0) spots = setup.enemySpots.filter((s) => spotDistance(this.playerSpawn, s) >= MIN_SPOT_DISTANCE);
    if (spots.length === 0) spots = setup.enemySpots;
    this.spots = spots;

    // Deathmatch spawn cells: walkable ground cells.
    const { nav, space } = d.map;
    for (let r = 0; r < nav.rows; r++)
      for (let c = 0; c < nav.cols; c++) {
        const i = r * nav.cols + c;
        if (nav.walkable[i]) this.spawnCells.push([space.x(c), nav.height[i], space.z(r)]);
      }
  }

  get mode() {
    return this.d.config.mode;
  }

  private makeBot(): Bot {
    const visual = this.d.createVisual ? this.d.createVisual(Bot.nextId) : null;
    const bot = new Bot(this.d.config.tuning, visual);
    this.bots.push(bot);
    return bot;
  }

  private claimed(except?: Bot): Set<string> {
    const s = new Set<string>();
    for (const b of this.bots) {
      if (b === except || !b.alive) continue;
      if (b.brain instanceof PeekBehavior) s.add(b.brain.spot.id);
    }
    for (const p of this.pending) if (p.bot.brain instanceof PeekBehavior) s.add(p.bot.brain.spot.id);
    return s;
  }

  private pickSpot(bot: Bot, ctx: BotContext, avoid?: string): EnemySpot {
    const claimed = this.claimed(bot);
    let free = this.spots.filter((s) => !claimed.has(s.id) && s.id !== avoid);
    if (free.length === 0) free = this.spots.filter((s) => !claimed.has(s.id));
    if (free.length === 0) free = this.spots;
    return free[Math.floor(ctx.rng() * free.length)];
  }

  private spawnPeekBot(bot: Bot, ctx: BotContext, avoid?: string) {
    const spot = this.pickSpot(bot, ctx, avoid);
    const mode = this.d.config.mode === 'jiggle' ? 'jiggle' : 'angle-hold';
    const brain = new PeekBehavior(spot, this.d.config.behavior, mode, {
      onEscape: () => this.d.tracker.escape(),
      claimed: () => this.claimed(bot),
      spots: this.spots,
    });
    bot.reset();
    bot.brain = brain;
    brain.start(bot, ctx);
    bot.visual?.setVisible(true);
  }

  /** Find a deathmatch spawn far from (and hidden from) the given eye and away from other bots. */
  private dmSpawnPoint(ctx: BotContext, avoidEye: [number, number, number], avoidBots: boolean): [number, number, number] {
    let best: [number, number, number] | null = null;
    for (let i = 0; i < 60; i++) {
      const c = this.spawnCells[Math.floor(ctx.rng() * this.spawnCells.length)];
      const dist = Math.hypot(c[0] - avoidEye[0], c[2] - avoidEye[2]);
      if (dist < 16) continue;
      if (Math.abs(c[1]) > 0.01) continue;
      if (isHumanoidVisible(ctx.world, avoidEye[0], avoidEye[1], avoidEye[2], c[0], c[1], c[2], 0)) continue;
      if (avoidBots) {
        let ok = true;
        for (const b of this.bots) {
          if (!b.alive) continue;
          if (Math.hypot(b.x - c[0], b.z - c[2]) < 12) ok = false;
          else if (isHumanoidVisible(ctx.world, b.x, b.y + 1.6, b.z, c[0], c[1], c[2], 0)) ok = false;
          if (!ok) break;
        }
        if (!ok) continue;
      }
      best = c;
      break;
    }
    return best ?? this.spawnCells[Math.floor(ctx.rng() * this.spawnCells.length)];
  }

  private spawnDmBot(bot: Bot, ctx: BotContext) {
    const eye = ctx.player.eye();
    const [x, y, z] = this.dmSpawnPoint(ctx, eye, false);
    bot.reset();
    bot.brain = new DeathmatchBehavior();
    bot.place(x, y, z, ctx.rng() * Math.PI * 2);
    bot.preAimed = false;
    bot.committed = true;
    bot.visual?.setVisible(true);
  }

  start(ctx: BotContext) {
    const n = Math.max(1, Math.min(this.d.config.botCount, this.mode === 'deathmatch' ? 10 : this.spots.length));
    for (let i = 0; i < n; i++) {
      const bot = this.makeBot();
      if (this.mode === 'deathmatch') this.spawnDmBot(bot, ctx);
      else this.spawnPeekBot(bot, ctx);
    }
  }

  onBotKilled(bot: Bot, ctx: BotContext) {
    const delay = this.mode === 'deathmatch' ? 3 : 0.8 + ctx.rng() * 0.8;
    this.pending.push({ bot, at: ctx.time + delay });
  }

  /** Returns seconds until respawn. */
  onPlayerDeath(ctx: BotContext): number {
    const delay = this.mode === 'deathmatch' ? 2 : 1.5;
    this.playerRespawnAt = ctx.time + delay;
    return delay;
  }

  /** Player gunfire / footsteps alert nearby deathmatch bots. */
  hear(ctx: BotContext, x: number, z: number, radius: number) {
    for (const b of this.bots) {
      if (!b.alive || !b.brain?.hear) continue;
      if (Math.hypot(b.x - x, b.z - z) <= radius) b.brain.hear(b, ctx, x, z);
    }
  }

  update(ctx: BotContext, dt: number, respawnPlayer: (x: number, y: number, z: number, yawDeg: number) => void) {
    for (const b of this.bots) b.update(ctx, dt);

    // bot respawns
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (ctx.time >= p.at - 0.6) p.bot.visual?.setVisible(false);
      if (ctx.time < p.at) continue;
      this.pending.splice(i, 1);
      const prevSpot = p.bot.brain instanceof PeekBehavior ? p.bot.brain.spot.id : undefined;
      if (this.mode === 'deathmatch') this.spawnDmBot(p.bot, ctx);
      else this.spawnPeekBot(p.bot, ctx, prevSpot);
    }

    // player respawn
    if (this.playerRespawnAt >= 0 && ctx.time >= this.playerRespawnAt) {
      this.playerRespawnAt = -1;
      if (this.mode === 'deathmatch') {
        const [x, y, z] = this.dmSpawnPoint(ctx, ctx.player.eye(), true);
        // face towards map centre
        const yaw = (Math.atan2(-x, -z) * 180) / Math.PI;
        respawnPlayer(x, y, z, yaw);
      } else {
        const s = this.playerSpawn;
        respawnPlayer(s.pos[0], s.pos[1], s.pos[2], s.yaw);
        // reset peekers so the player isn't instantly traded
        for (const b of this.bots) {
          if (b.alive && b.brain instanceof PeekBehavior) b.brain.start(b, ctx);
        }
      }
    }
  }

  get activeBots() {
    return this.bots.filter((b) => b.alive).length;
  }

  dispose() {
    for (const b of this.bots) b.visual?.dispose();
    this.bots.length = 0;
    this.pending.length = 0;
  }
}
