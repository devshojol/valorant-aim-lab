/**
 * Free-roaming deathmatch AI.
 *
 *   PATROL ──sees player──▶ ENGAGE ──lost sight──▶ CHASE ──arrived──▶ PATROL
 *      ▲                      │  low HP
 *      │                      ▼
 *      └──── PEEK ◀──wait── COVER
 *
 * Navigation uses grid A*; cover is any nearby walkable cell with no line of sight to the player.
 */

import { findPath, nearestWalkable, type NavPoint } from '../navigation/GridNavigator';
import { BOT_SCALE } from '../perception/visibility';
import { type Bot, type BotBrain, type BotContext, lerp } from '../Bot';

type State = 'patrol' | 'engage' | 'chase' | 'cover' | 'hold-cover' | 'peek';

export class DeathmatchBehavior implements BotBrain {
  readonly kind = 'deathmatch';
  state: State = 'patrol';
  private path: NavPoint[] = [];
  private pathIdx = 0;
  private timer = 0;
  private strafeTimer = 0;
  private strafeDir = 1;
  private lostTimer = 0;
  private stuckTimer = 0;
  private lastPos: [number, number] = [0, 0];
  private coverChecked = false;
  private engagedCrouch = false;

  describe() {
    return this.state;
  }

  private setPath(bot: Bot, ctx: BotContext, tx: number, tz: number): boolean {
    const p = findPath(ctx.map.nav, ctx.map.space, bot.x, bot.z, tx, tz);
    if (!p || p.length === 0) {
      this.path = [];
      return false;
    }
    this.path = p;
    this.pathIdx = 0;
    return true;
  }

  private randomDestination(bot: Bot, ctx: BotContext): [number, number] {
    const { nav, space } = ctx.map;
    // Hunt: bias towards the player's area, otherwise roam the map.
    const hunt = ctx.rng() < 0.35 + bot.tuning.aggression * 0.3;
    for (let i = 0; i < 30; i++) {
      let c: number;
      let r: number;
      if (hunt) {
        c = space.col(ctx.player.pos.x + (ctx.rng() - 0.5) * 24);
        r = space.row(ctx.player.pos.z + (ctx.rng() - 0.5) * 24);
      } else {
        c = Math.floor(ctx.rng() * nav.cols);
        r = Math.floor(ctx.rng() * nav.rows);
      }
      const idx = nearestWalkable(nav, c, r, 2);
      if (idx < 0) continue;
      const x = space.x(idx % nav.cols);
      const z = space.z(Math.floor(idx / nav.cols));
      if (Math.hypot(x - bot.x, z - bot.z) > 6) return [x, z];
    }
    return [bot.x, bot.z];
  }

  private followPath(bot: Bot, ctx: BotContext, speed: number): boolean {
    if (this.pathIdx >= this.path.length) {
      bot.moveTarget = null;
      return true;
    }
    const wp = this.path[this.pathIdx];
    const last = this.pathIdx === this.path.length - 1;
    const d = bot.distTo(wp[0], wp[1]);
    if (d < (last ? 0.35 : 0.9)) {
      this.pathIdx++;
      return this.pathIdx >= this.path.length;
    }
    // Aim the move target slightly beyond the waypoint so the bot doesn't brake at every corner.
    if (!last) {
      const k = 1.5 / Math.max(d, 0.001);
      bot.moveTarget = [wp[0] + (wp[0] - bot.x) * k, wp[1] + (wp[1] - bot.z) * k];
    } else bot.moveTarget = [wp[0], wp[1]];
    bot.moveSpeed = speed;
    void ctx;
    return false;
  }

  private faceMovement(bot: Bot) {
    if (bot.speed > 0.5) bot.faceYaw = Math.atan2(bot.vx, bot.vz);
  }

  private findCover(bot: Bot, ctx: BotContext): [number, number] | null {
    const { nav, space, world } = { nav: ctx.map.nav, space: ctx.map.space, world: ctx.world };
    const eye = ctx.player.eye();
    const c0 = space.col(bot.x);
    const r0 = space.row(bot.z);
    const startIdx = nearestWalkable(nav, c0, r0, 1);
    if (startIdx < 0) return null;
    // BFS outward up to 6 cells
    const seen = new Set<number>([startIdx]);
    let frontier = [startIdx];
    let checks = 0;
    for (let ring = 0; ring < 6 && frontier.length; ring++) {
      const next: number[] = [];
      for (const idx of frontier) {
        const c = idx % nav.cols;
        const r = Math.floor(idx / nav.cols);
        if (ring > 0 && checks < 80) {
          checks++;
          const x = space.x(c);
          const z = space.z(r);
          const y = nav.height[idx];
          const hidden =
            !world.segmentClear(x, y + 1.6 * BOT_SCALE, z, eye[0], eye[1], eye[2]) && !world.segmentClear(x, y + 1.1 * BOT_SCALE, z, eye[0], eye[1], eye[2]);
          if (hidden) return [x, z];
        }
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
          const ni = nr * nav.cols + nc;
          if (seen.has(ni) || !nav.walkable[ni]) continue;
          if (Math.abs(nav.height[ni] - nav.height[idx]) > 0.45) continue;
          seen.add(ni);
          next.push(ni);
        }
      }
      frontier = next;
    }
    return null;
  }

  update(bot: Bot, ctx: BotContext, dt: number) {
    this.timer -= dt;
    const run = bot.maxRun;

    // stuck detection while travelling
    if (bot.moveTarget && (this.state === 'patrol' || this.state === 'chase' || this.state === 'cover' || this.state === 'peek')) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.2) {
        if (Math.hypot(bot.x - this.lastPos[0], bot.z - this.lastPos[1]) < 0.4) {
          this.path = [];
          this.state = 'patrol';
        }
        this.stuckTimer = 0;
        this.lastPos = [bot.x, bot.z];
      }
    }

    if (bot.seesPlayer && this.state !== 'engage' && this.state !== 'cover') {
      this.state = 'engage';
      this.lostTimer = 0;
      this.coverChecked = false;
      this.engagedCrouch = ctx.rng() < bot.tuning.crouchChance * 0.6;
      this.strafeTimer = 0;
    }

    switch (this.state) {
      case 'patrol': {
        bot.wantsToShoot = false;
        bot.crouchTarget = 0;
        if (this.path.length === 0 || this.pathIdx >= this.path.length) {
          const [x, z] = this.randomDestination(bot, ctx);
          if (!this.setPath(bot, ctx, x, z)) {
            bot.moveTarget = null;
            return;
          }
        }
        if (this.followPath(bot, ctx, run)) this.path = [];
        this.faceMovement(bot);
        return;
      }
      case 'engage': {
        bot.wantsToShoot = true;
        bot.faceYaw = null;
        if (!bot.seesPlayer) {
          this.lostTimer += dt;
          if (this.lostTimer > 0.9 && bot.lastKnown) {
            this.state = 'chase';
            this.setPath(bot, ctx, bot.lastKnown[0], bot.lastKnown[1]);
            return;
          }
        } else this.lostTimer = 0;

        // low HP: break line of sight (once per engagement)
        if (!this.coverChecked && bot.health < 60) {
          this.coverChecked = true;
          const chance = 0.15 + (1 - bot.tuning.aggression) * 0.55;
          if (ctx.rng() < chance) {
            const cover = this.findCover(bot, ctx);
            if (cover && this.setPath(bot, ctx, cover[0], cover[1])) {
              this.state = 'cover';
              bot.wantsToShoot = false;
              bot.crouchTarget = 0;
              return;
            }
          }
        }

        // Stop to shoot; strafe (ADAD) between bursts, then counter-strafe.
        bot.crouchTarget = this.engagedCrouch && bot.burstLeft > 0 ? 1 : 0;
        if (ctx.time < bot.reactAt) {
          bot.moveTarget = [bot.x + bot.vx * 0.05, bot.z + bot.vz * 0.05];
          return;
        }
        if (bot.burstPause > 0 && !this.engagedCrouch && ctx.rng() < bot.tuning.aggression * dt * 6) {
          this.strafeTimer = lerp(0.18, 0.4, ctx.rng());
          this.strafeDir = ctx.rng() < 0.5 ? -1 : 1;
        }
        if (this.strafeTimer > 0) {
          this.strafeTimer -= dt;
          const toP = Math.atan2(ctx.player.pos.x - bot.x, ctx.player.pos.z - bot.z);
          const sx = Math.cos(toP) * this.strafeDir;
          const sz = -Math.sin(toP) * this.strafeDir;
          const tx = bot.x + sx * 1.5;
          const tz = bot.z + sz * 1.5;
          if (!ctx.world.overlap(tx, bot.y + 0.05, tz, 0.3, 1.8)) {
            bot.moveTarget = [tx, tz];
            bot.moveSpeed = run;
          } else this.strafeTimer = 0;
        } else {
          bot.moveTarget = [bot.x, bot.z];
        }
        return;
      }
      case 'chase': {
        bot.wantsToShoot = true;
        bot.crouchTarget = 0;
        const close = bot.lastKnown ? bot.distTo(bot.lastKnown[0], bot.lastKnown[1]) < 10 : false;
        // Walk (silent) when closing in, like a real player.
        const done = this.followPath(bot, ctx, close ? run * 0.65 : run);
        this.faceMovement(bot);
        if (bot.lastKnown && close) bot.faceYaw = Math.atan2(bot.lastKnown[0] - bot.x, bot.lastKnown[1] - bot.z);
        if (done) {
          this.state = 'patrol';
          this.path = [];
        }
        return;
      }
      case 'cover': {
        bot.wantsToShoot = false;
        if (this.followPath(bot, ctx, run)) {
          this.state = 'hold-cover';
          this.timer = lerp(0.8, 2.2, ctx.rng());
          bot.moveTarget = [bot.x, bot.z];
        }
        this.faceMovement(bot);
        return;
      }
      case 'hold-cover': {
        bot.wantsToShoot = true;
        if (bot.lastKnown) bot.faceYaw = Math.atan2(bot.lastKnown[0] - bot.x, bot.lastKnown[1] - bot.z);
        if (this.timer <= 0) {
          // re-peek towards the last known position
          this.state = 'peek';
          if (bot.lastKnown) this.setPath(bot, ctx, bot.lastKnown[0], bot.lastKnown[1]);
        }
        return;
      }
      case 'peek': {
        bot.wantsToShoot = true;
        const done = this.followPath(bot, ctx, run * 0.8);
        if (bot.lastKnown) bot.faceYaw = Math.atan2(bot.lastKnown[0] - bot.x, bot.lastKnown[1] - bot.z);
        if (done) {
          this.state = 'patrol';
          this.path = [];
        }
        return;
      }
    }
  }

  hear(bot: Bot, ctx: BotContext, x: number, z: number) {
    if (this.state === 'engage' || this.state === 'cover') return;
    const nx = x + (ctx.rng() - 0.5) * 4;
    const nz = z + (ctx.rng() - 0.5) * 4;
    bot.lastKnown = [nx, nz];
    if (this.setPath(bot, ctx, nx, nz)) this.state = 'chase';
  }

  onDamaged(bot: Bot, ctx: BotContext) {
    // Getting shot from an unseen angle: turn towards the player's position.
    if (!bot.seesPlayer) {
      bot.lastKnown = [ctx.player.pos.x, ctx.player.pos.z];
      bot.faceYaw = Math.atan2(ctx.player.pos.x - bot.x, ctx.player.pos.z - bot.z);
      if (this.state === 'patrol') {
        this.state = 'chase';
        this.setPath(bot, ctx, ctx.player.pos.x, ctx.player.pos.z);
      }
    }
  }
}
