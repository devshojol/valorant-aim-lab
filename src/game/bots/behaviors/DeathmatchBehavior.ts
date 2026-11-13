/**
 * Free-roaming deathmatch AI.
 *
 *   PATROL ──sees player──▶ ENGAGE ──lost sight──▶ HOLD (watch the angle) ──▶ CHASE ──▶ SEARCH ──▶ PATROL
 *      ▲                      │  low HP / empty magazine
 *      │                      ▼
 *      └── SEARCH ◀── PEEK ◀── HOLD-COVER ◀── COVER
 *
 * In a fight the bot stops to shoot and moves between bursts: it sidesteps, closes in when its gun
 * is out of range and backs off when the player is on top of it. When the player disappears it
 * either holds the angle or pushes, then checks the way the player was heading. Noise (shots,
 * footsteps, a nearby bot opening fire) pulls roaming bots in or makes careful ones hold an angle.
 *
 * Navigation uses grid A*; cover is any nearby walkable cell with no line of sight to the player.
 */

import { findPath, nearestWalkable, type NavPoint } from '../navigation/GridNavigator';
import { BOT_EYE, BOT_HEIGHT, BOT_RADIUS, BOT_SCALE } from '../perception/visibility';
import { type Bot, type BotBrain, type BotContext, CLOSE_RANGE, lerp } from '../Bot';

type State = 'patrol' | 'engage' | 'hold' | 'chase' | 'search' | 'cover' | 'hold-cover' | 'peek';

/** Distance each kind of gun likes to fight at (metres). */
const IDEAL_RANGE = { Rifle: 22, SMG: 11, Sidearm: 13, Sniper: 34 } as const;
/** Other bots this close hear a bot spot the player. */
const CALLOUT_RADIUS = 28;
/** Minimum time between two re-plans caused by noise (the player's footsteps come several a second). */
const HEAR_REPATH = 0.6;

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
  private reloadCoverChecked = false;
  private engagedCrouch = false;
  /** Whether the bot already chose to move (or not) in the current pause between bursts. */
  private pauseHandled = false;
  private wantDodge = false;
  private lastHeard = -99;
  /** After holding an angle: push to the last known position (otherwise go back to roaming). */
  private pushAfterHold = true;
  /** Directions still to check while searching. */
  private scan: number[] = [];
  private scanStarted = false;

  describe() {
    return this.state;
  }

  /* ------------------------------------------------------------- */
  /* Navigation helpers                                             */
  /* ------------------------------------------------------------- */

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
      if (Math.hypot(x - bot.x, z - bot.z) < 6) continue;
      // spread out: don't head for a place another bot is already standing in
      if (i < 20 && ctx.bots.some((o) => o !== bot && o.alive && Math.hypot(o.x - x, o.z - z) < 6)) continue;
      return [x, z];
    }
    return [bot.x, bot.z];
  }

  private followPath(bot: Bot, speed: number): boolean {
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
    return false;
  }

  /**
   * Look where the route goes: at the waypoint ahead, and already at the one after it when the
   * corner is close, so the bot comes round a corner with its gun on the new lane.
   */
  private facePath(bot: Bot) {
    const wp = this.path[this.pathIdx];
    if (!wp) return;
    const next = this.path[this.pathIdx + 1];
    const d = bot.distTo(wp[0], wp[1]);
    const t = next && d < 2.5 ? next : wp;
    if (bot.distTo(t[0], t[1]) > 0.6) bot.faceYaw = Math.atan2(t[0] - bot.x, t[1] - bot.z);
  }

  private faceLastKnown(bot: Bot) {
    if (bot.lastKnown && bot.distTo(bot.lastKnown[0], bot.lastKnown[1]) > 0.8) {
      bot.faceYaw = Math.atan2(bot.lastKnown[0] - bot.x, bot.lastKnown[1] - bot.z);
    }
  }

  private stop(bot: Bot) {
    bot.moveTarget = [bot.x, bot.z];
  }

  /** Whether the bot can stand at a point: level walkable ground, clear of geometry. */
  private standable(bot: Bot, ctx: BotContext, x: number, z: number): boolean {
    const { nav, space } = ctx.map;
    const c = space.col(x);
    const r = space.row(z);
    if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) return false;
    const i = r * nav.cols + c;
    if (!nav.walkable[i] || Math.abs(nav.height[i] - bot.y) > 0.45) return false;
    return !ctx.world.overlap(x, bot.y + 0.05, z, BOT_RADIUS, BOT_HEIGHT);
  }

  /** Whether the player's eyes would see a bot standing at a point. */
  private exposedAt(bot: Bot, ctx: BotContext, x: number, z: number): boolean {
    const eye = ctx.player.eye();
    return ctx.world.segmentClear(x, bot.y + BOT_EYE, z, eye[0], eye[1], eye[2]);
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

  private takeCover(bot: Bot, ctx: BotContext): boolean {
    const cover = this.findCover(bot, ctx);
    if (!cover || !this.setPath(bot, ctx, cover[0], cover[1])) return false;
    this.state = 'cover';
    bot.wantsToShoot = false;
    bot.crouchTarget = 0;
    return true;
  }

  /* ------------------------------------------------------------- */
  /* Fighting                                                       */
  /* ------------------------------------------------------------- */

  /**
   * Pick a short move for the pause between bursts: sideways, plus forwards when the gun is out of
   * its range or backwards when the player is too close. A reloading bot prefers a step that breaks
   * line of sight; otherwise the step must keep the player in view.
   */
  private startStrafe(bot: Bot, ctx: BotContext, dist: number, hide: boolean): boolean {
    const px = ctx.player.pos.x - bot.x;
    const pz = ctx.player.pos.z - bot.z;
    const len = Math.hypot(px, pz) || 1;
    const fx = px / len;
    const fz = pz / len;
    const ideal = IDEAL_RANGE[bot.weapon.category] ?? 20;
    let fwd = 0;
    if (dist > ideal * 1.4) fwd = 0.5 + bot.tuning.aggression * 0.5;
    else if (dist < Math.min(5, ideal * 0.4)) fwd = -0.6;
    const time = lerp(0.2, 0.42, ctx.rng());
    const reach = bot.maxRun * time;
    const first = ctx.rng() < 0.3 ? this.strafeDir : -this.strafeDir;
    let fallback: [number, number, number] | null = null;
    for (const dir of [first, -first]) {
      // right of the line to the player is (fz, -fx)
      let sx = fz * dir + fx * fwd;
      let sz = -fx * dir + fz * fwd;
      const sl = Math.hypot(sx, sz);
      sx /= sl;
      sz /= sl;
      const tx = bot.x + sx * reach;
      const tz = bot.z + sz * reach;
      if (!this.standable(bot, ctx, tx, tz) || !this.standable(bot, ctx, bot.x + sx * reach * 0.5, bot.z + sz * reach * 0.5)) continue;
      const exposed = this.exposedAt(bot, ctx, tx, tz);
      if (exposed === !hide) {
        this.beginStrafe(bot, tx, tz, time, dir);
        return true;
      }
      // a reloading bot with no cover a step away still keeps moving
      if (hide && !fallback) fallback = [tx, tz, dir];
    }
    if (fallback) {
      this.beginStrafe(bot, fallback[0], fallback[1], time, fallback[2]);
      return true;
    }
    return false;
  }

  private beginStrafe(bot: Bot, tx: number, tz: number, time: number, dir: number) {
    this.strafeDir = dir;
    this.strafeTimer = time + 0.15;
    bot.moveTarget = [tx, tz];
    bot.moveSpeed = bot.maxRun;
  }

  private engage(bot: Bot, ctx: BotContext, dt: number) {
    bot.wantsToShoot = true;
    bot.faceYaw = null;
    if (!bot.seesPlayer) {
      // Keep the gun on the spot where the player vanished for a moment, then decide.
      this.lostTimer += dt;
      bot.crouchTarget = 0;
      if (this.strafeTimer > 0) this.strafeTimer -= dt;
      else this.stop(bot);
      if (this.lostTimer > lerp(0.7, 0.35, bot.tuning.aggression) && bot.lastKnown) this.afterLost(bot, ctx);
      return;
    }
    this.lostTimer = 0;
    const dist = bot.distTo(ctx.player.pos.x, ctx.player.pos.z);

    // Hurt: break line of sight (once per fight). Timid bots do it far more often.
    if (!this.coverChecked && bot.health < 60) {
      this.coverChecked = true;
      if (ctx.rng() < 0.15 + (1 - bot.tuning.aggression) * 0.55 && this.takeCover(bot, ctx)) return;
    }
    // Empty magazine: better bots reload behind cover instead of in the open.
    if (bot.reloading && !this.reloadCoverChecked) {
      this.reloadCoverChecked = true;
      if (ctx.rng() < 0.25 + bot.acc * 0.6 && this.takeCover(bot, ctx)) return;
    }
    if (!bot.reloading) this.reloadCoverChecked = false;

    // Crouch for the burst: by habit, or to steady a spray at close range.
    bot.crouchTarget = this.engagedCrouch && bot.burstLeft > 0 ? 1 : 0;

    // Still reacting: brake.
    if (ctx.time < bot.reactAt) {
      bot.moveTarget = [bot.x + bot.vx * 0.05, bot.z + bot.vz * 0.05];
      return;
    }

    if (this.strafeTimer > 0) {
      this.strafeTimer -= dt;
      return;
    }
    const pause = bot.burstPause > 0 || bot.reloading;
    if (!pause) this.pauseHandled = false;
    if (pause && (!this.pauseHandled || bot.reloading || this.wantDodge)) {
      this.pauseHandled = true;
      const dodge = this.wantDodge || bot.reloading || ctx.rng() < 0.25 + bot.tuning.aggression * 0.35 + bot.acc * 0.25;
      this.wantDodge = false;
      if (dodge && !this.engagedCrouch && this.startStrafe(bot, ctx, dist, bot.reloading)) return;
    }
    // Stop (counter-strafe) to shoot.
    this.stop(bot);
  }

  /** The player broke line of sight: hold the angle or push, depending on temperament. */
  private afterLost(bot: Bot, ctx: BotContext) {
    this.strafeTimer = 0;
    const ag = bot.tuning.aggression;
    // Don't push with an empty gun.
    if (!bot.reloading && ctx.rng() < 0.25 + ag * 0.65) {
      this.startChase(bot, ctx);
      return;
    }
    this.state = 'hold';
    this.timer = Math.max(lerp(1.6, 4, ctx.rng()), bot.reloadLeft + 0.2);
    this.pushAfterHold = ctx.rng() < 0.45 + ag * 0.5;
    bot.crouchTarget = ctx.rng() < bot.tuning.crouchChance ? 1 : 0;
    this.stop(bot);
  }

  private startChase(bot: Bot, ctx: BotContext) {
    if (bot.lastKnown && this.setPath(bot, ctx, bot.lastKnown[0], bot.lastKnown[1])) this.state = 'chase';
    else this.toPatrol();
  }

  private toPatrol() {
    this.state = 'patrol';
    this.path = [];
  }

  /**
   * Arrived where the player was last seen or heard: follow the way they were heading for a few
   * metres, then check the longest open lanes from there before giving up.
   */
  private startSearch(bot: Bot, ctx: BotContext) {
    this.state = 'search';
    this.path = [];
    this.scan = [];
    this.scanStarted = false;
    const [vx, vz] = bot.lastVel;
    const sp = Math.hypot(vx, vz);
    if (sp > 1.5 && bot.lastKnown) {
      const { nav, space } = ctx.map;
      const dist = lerp(4, 8, ctx.rng());
      const tx = bot.lastKnown[0] + (vx / sp) * dist;
      const tz = bot.lastKnown[1] + (vz / sp) * dist;
      const idx = nearestWalkable(nav, space.col(tx), space.row(tz), 2);
      if (idx >= 0) this.setPath(bot, ctx, space.x(idx % nav.cols), space.z(Math.floor(idx / nav.cols)));
      bot.lastVel = [0, 0];
    }
    this.timer = 0;
  }

  /** The two longest sight lines from where the bot stands, well apart from each other. */
  private openLanes(bot: Bot, ctx: BotContext): number[] {
    const [ex, ey, ez] = bot.eye();
    const lanes: [number, number][] = [];
    for (let i = 0; i < 12; i++) {
      const yaw = (i / 12) * Math.PI * 2;
      const hit = ctx.world.raycast(ex, ey, ez, Math.sin(yaw), 0, Math.cos(yaw), 40);
      lanes.push([yaw, hit ? hit.t : 40]);
    }
    lanes.sort((a, b) => b[1] - a[1]);
    const out = [lanes[0][0]];
    const second = lanes.find(([yaw]) => Math.abs(Math.atan2(Math.sin(yaw - out[0]), Math.cos(yaw - out[0]))) > 1);
    if (second) out.push(second[0]);
    return out;
  }

  /* ------------------------------------------------------------- */
  /* Update                                                         */
  /* ------------------------------------------------------------- */

  update(bot: Bot, ctx: BotContext, dt: number) {
    this.timer -= dt;
    const run = bot.maxRun;
    bot.separate = true;

    // stuck detection while travelling
    const travelling = this.state === 'patrol' || this.state === 'chase' || this.state === 'cover' || this.state === 'peek' || this.state === 'search';
    if (bot.moveTarget && travelling && this.path.length > 0) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.2) {
        if (Math.hypot(bot.x - this.lastPos[0], bot.z - this.lastPos[1]) < 0.4) this.toPatrol();
        this.stuckTimer = 0;
        this.lastPos = [bot.x, bot.z];
      }
    }

    if (bot.seesPlayer && this.state !== 'engage' && this.state !== 'cover') {
      const fresh = this.state === 'patrol' || this.state === 'search';
      this.state = 'engage';
      this.lostTimer = 0;
      this.coverChecked = false;
      this.reloadCoverChecked = false;
      this.pauseHandled = false;
      this.wantDodge = false;
      this.engagedCrouch = ctx.rng() < bot.tuning.crouchChance * (bot.distTo(ctx.player.pos.x, ctx.player.pos.z) < CLOSE_RANGE ? 1 : 0.6);
      this.strafeTimer = 0;
      if (fresh) this.callOut(bot, ctx);
    }

    switch (this.state) {
      case 'patrol': {
        bot.wantsToShoot = false;
        bot.preAimed = false;
        bot.crouchTarget = 0;
        if (bot.ammo < bot.weapon.magazine * 0.6) bot.reload();
        if (this.path.length === 0 || this.pathIdx >= this.path.length) {
          const [x, z] = this.randomDestination(bot, ctx);
          if (!this.setPath(bot, ctx, x, z)) {
            bot.moveTarget = null;
            return;
          }
        }
        if (this.followPath(bot, run)) this.path = [];
        this.facePath(bot);
        return;
      }
      case 'engage':
        this.engage(bot, ctx, dt);
        return;
      case 'hold': {
        // Watch the spot where the player disappeared (or where the noise came from).
        bot.wantsToShoot = true;
        bot.preAimed = true;
        this.faceLastKnown(bot);
        if (bot.moveTarget && bot.distTo(bot.moveTarget[0], bot.moveTarget[1]) < 0.1) this.stop(bot);
        if (this.timer <= 0 && !bot.reloading) {
          bot.crouchTarget = 0;
          if (this.pushAfterHold) this.startChase(bot, ctx);
          else this.toPatrol();
        }
        return;
      }
      case 'chase': {
        bot.wantsToShoot = true;
        bot.crouchTarget = 0;
        const close = bot.lastKnown ? bot.distTo(bot.lastKnown[0], bot.lastKnown[1]) < 12 : false;
        bot.preAimed = close;
        // Walk (silent) when closing in, like a real player.
        const done = this.followPath(bot, close ? run * 0.65 : run);
        this.facePath(bot);
        // the last stretch is walked with the gun on the spot itself
        if (close && this.pathIdx >= this.path.length - 1) this.faceLastKnown(bot);
        if (done) this.startSearch(bot, ctx);
        return;
      }
      case 'search': {
        bot.wantsToShoot = true;
        bot.preAimed = true;
        bot.crouchTarget = 0;
        if (this.path.length > 0) {
          const done = this.followPath(bot, run * 0.65);
          this.facePath(bot);
          if (!done) return;
          this.path = [];
        }
        this.stop(bot);
        if (this.timer > 0) return;
        if (!this.scanStarted) {
          this.scanStarted = true;
          this.scan = this.openLanes(bot, ctx);
        }
        const yaw = this.scan.shift();
        if (yaw === undefined) {
          this.toPatrol();
          return;
        }
        bot.faceYaw = yaw;
        this.timer = lerp(0.6, 1, ctx.rng());
        return;
      }
      case 'cover': {
        bot.wantsToShoot = false;
        bot.preAimed = false;
        if (this.followPath(bot, run)) {
          this.state = 'hold-cover';
          bot.reload();
          this.timer = Math.max(lerp(0.8, 2.2, ctx.rng()), bot.reloadLeft + 0.15);
          this.stop(bot);
        }
        this.facePath(bot);
        return;
      }
      case 'hold-cover': {
        bot.wantsToShoot = true;
        bot.preAimed = true;
        this.faceLastKnown(bot);
        if (this.timer <= 0) {
          // re-peek towards the last known position
          this.state = 'peek';
          if (bot.lastKnown) this.setPath(bot, ctx, bot.lastKnown[0], bot.lastKnown[1]);
        }
        return;
      }
      case 'peek': {
        bot.wantsToShoot = true;
        bot.preAimed = true;
        const done = this.followPath(bot, run * 0.8);
        this.faceLastKnown(bot);
        if (done) this.startSearch(bot, ctx);
        return;
      }
    }
  }

  /* ------------------------------------------------------------- */
  /* Senses                                                         */
  /* ------------------------------------------------------------- */

  /** A bot that spots the player tells the roaming bots around it. */
  private callOut(bot: Bot, ctx: BotContext) {
    if (!bot.lastKnown) return;
    for (const o of ctx.bots) {
      if (o === bot || !o.alive || !o.brain?.hear) continue;
      if (Math.hypot(o.x - bot.x, o.z - bot.z) > CALLOUT_RADIUS) continue;
      if (ctx.rng() < 0.35 + o.tuning.aggression * 0.5) o.brain.hear(o, ctx, bot.lastKnown[0], bot.lastKnown[1]);
    }
  }

  hear(bot: Bot, ctx: BotContext, x: number, z: number) {
    if (this.state === 'engage' || this.state === 'cover' || this.state === 'hold-cover' || this.state === 'peek') return;
    // The further away the noise, the rougher the guess of where it came from.
    const dist = bot.distTo(x, z);
    const blur = Math.min(6, 1 + dist * 0.12);
    const nx = x + (ctx.rng() - 0.5) * blur;
    const nz = z + (ctx.rng() - 0.5) * blur;
    const moved = bot.lastKnown ? Math.hypot(bot.lastKnown[0] - nx, bot.lastKnown[1] - nz) : Infinity;
    bot.lastKnown = [nx, nz];
    bot.lastVel = [0, 0];
    if (this.state === 'hold') return; // already watching: just follow the noise with the gun
    if (ctx.time - this.lastHeard < HEAR_REPATH || (this.state === 'chase' && moved < 4)) return;
    this.lastHeard = ctx.time;
    // Something close: careful bots stop and hold the angle instead of running into it.
    if (dist < 16 && this.state !== 'chase' && ctx.rng() > 0.2 + bot.tuning.aggression * 0.75) {
      this.state = 'hold';
      this.timer = lerp(1.5, 3.5, ctx.rng());
      this.pushAfterHold = true;
      this.path = [];
      this.stop(bot);
      return;
    }
    if (this.setPath(bot, ctx, nx, nz)) this.state = 'chase';
  }

  onDamaged(bot: Bot, ctx: BotContext) {
    if (bot.seesPlayer) {
      // Hit mid-fight: move at the next pause instead of standing in the same spot.
      if (this.state === 'engage') this.wantDodge = true;
      return;
    }
    // Shot from an unseen angle: turn on the shooter, and step aside if quick enough.
    const p = ctx.player.pos;
    bot.lastKnown = [p.x, p.z];
    bot.lastVel = [0, 0];
    if (this.state === 'cover' || this.state === 'engage') return;
    this.state = 'hold';
    this.timer = lerp(1, 1.8, ctx.rng());
    this.pushAfterHold = true;
    this.path = [];
    this.stop(bot);
    if (ctx.rng() < bot.acc) {
      this.startStrafe(bot, ctx, bot.distTo(p.x, p.z), false);
      this.strafeTimer = 0;
    }
  }
}
