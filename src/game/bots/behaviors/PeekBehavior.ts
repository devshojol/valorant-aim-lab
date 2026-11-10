/**
 * Tactical peek behaviours used by the angle-holding and jiggle-training modes.
 *
 * Every bot owns an enemy spot: a hidden cover anchor plus a strafe direction. Before each
 * peek the bot re-analyses that line against the player's *current* eye position to find
 * where it becomes visible, so peeks expose exactly as intended even if the player moves.
 *
 * State machine:
 *   HIDDEN ──timer──▶ (PREP) ──▶ OUT ──▶ HOLD / ENGAGE ──▶ BACK ──▶ HIDDEN
 *                                         └──────▶ RELOCATE (reposition to another spot)
 */

import type { BotBehavior, EnemySpot } from '../../../types';
import { analysePeekLine, BOT_HEIGHT, BOT_RADIUS, type ExposureInfo } from '../perception/visibility';
import { type Bot, type BotBrain, type BotContext, lerp } from '../Bot';

type State = 'hidden' | 'prep' | 'out' | 'hold' | 'engage' | 'back' | 'relocate' | 'unusable';
export type PeekKind = 'stationary' | 'jiggle' | 'shoulder' | 'full' | 'swing' | 'spray' | 'adad';

export interface PeekHooks {
  /** Bot returned to cover alive after a committed peek where the player saw it. */
  onEscape(bot: Bot): void;
  /** Spot ids currently claimed by other bots. */
  claimed(): Set<string>;
  /** Candidate spots for repositioning. */
  spots: EnemySpot[];
}

export class PeekBehavior implements BotBrain {
  readonly kind = 'peek';
  state: State = 'hidden';
  private timer = 0;
  private info: ExposureInfo | null = null;
  private targetD = 0;
  private speed = 5.4;
  private plan: PeekKind = 'full';
  private repeats = 0;
  private adadCycles = 0;
  private engagedShots = 0;
  private relocateTarget: EnemySpot | null = null;

  constructor(
    public spot: EnemySpot,
    private readonly behavior: BotBehavior,
    private readonly mode: 'angle-hold' | 'jiggle',
    private readonly hooks: PeekHooks,
  ) {}

  describe() {
    return `${this.state}:${this.plan}`;
  }

  /** Position on the peek line at distance d from the cover anchor. */
  private pointAt(d: number): [number, number] {
    return [this.spot.cover[0] + this.spot.peekDir[0] * d, this.spot.cover[2] + this.spot.peekDir[1] * d];
  }

  private analyse(ctx: BotContext): ExposureInfo {
    const eye = ctx.player.eye();
    this.info = analysePeekLine(
      ctx.world,
      eye,
      this.spot.cover[0],
      this.spot.cover[1],
      this.spot.cover[2],
      this.spot.peekDir[0],
      this.spot.peekDir[1],
      this.spot.maxPeek,
    );
    return this.info;
  }

  private get hideD() {
    return this.info?.hideAt ?? 0;
  }
  private get exposeD() {
    return this.info?.exposeAt ?? this.info?.reach ?? 1;
  }
  private get reach() {
    return this.info?.reach ?? this.spot.maxPeek;
  }

  /** Called when the bot (re)spawns at its spot. */
  start(bot: Bot, ctx: BotContext) {
    const info = this.analyse(ctx);
    if (info.exposeAt === null || info.hideAt === null) {
      this.state = 'unusable';
    }
    const faceYaw = Math.atan2(ctx.player.pos.x - this.spot.cover[0], ctx.player.pos.z - this.spot.cover[2]);
    bot.preAimed = true;
    if (this.behavior === 'stationary') {
      this.plan = 'stationary';
      const d = Math.min(this.reach, this.exposeD + lerp(0.6, 1.4, ctx.rng()));
      const [x, z] = this.pointAt(d);
      bot.place(x, this.spot.cover[1], z, faceYaw);
      bot.moveTarget = [x, z];
      bot.crouchTarget = ctx.rng() < bot.tuning.crouchChance * 0.5 ? 1 : 0;
      bot.wantsToShoot = true;
      bot.committed = true;
      bot.peekKind = 'stationary';
      this.state = 'engage';
      this.timer = Infinity;
      return;
    }
    const [x, z] = this.pointAt(this.hideD);
    bot.place(x, this.spot.cover[1], z, faceYaw);
    bot.moveTarget = [x, z];
    this.enterHidden(bot, ctx, lerp(0.6, 1.6, ctx.rng()));
  }

  private waitTime(bot: Bot, ctx: BotContext) {
    const f = bot.tuning.peekFrequency;
    const base = this.mode === 'jiggle' ? lerp(2.0, 0.45, f) : lerp(3.4, 0.8, f);
    return base * (0.6 + ctx.rng() * 0.8);
  }

  private enterHidden(bot: Bot, ctx: BotContext, wait: number) {
    this.state = 'hidden';
    this.timer = wait;
    bot.wantsToShoot = false;
    bot.sprayMode = false;
    bot.crouchTarget = 0;
    bot.moveTarget = this.pointAt(this.hideD);
    bot.peekKind = 'none';
    // pre-aim the angle while waiting
    bot.faceYaw = Math.atan2(ctx.player.pos.x - bot.x, ctx.player.pos.z - bot.z);
  }

  private choosePlan(bot: Bot, ctx: BotContext): PeekKind {
    const r = ctx.rng();
    const ag = bot.tuning.aggression;
    if (this.mode === 'jiggle') {
      if (r < 0.55) return 'jiggle';
      if (r < 0.85) return 'shoulder';
      return ctx.rng() < 0.5 + ag * 0.3 ? 'full' : 'swing';
    }
    switch (this.behavior) {
      case 'jiggle':
        return 'jiggle';
      case 'shoulder':
        return 'shoulder';
      case 'wide-swing':
        return 'swing';
      case 'crouch-spray':
        return 'spray';
      case 'counter-strafe':
        return 'adad';
      default: {
        // mixed: weights shift with aggression
        const table: [PeekKind, number][] = [
          ['jiggle', 1.2 - ag * 0.5],
          ['shoulder', 0.5 - ag * 0.2],
          ['full', 1],
          ['swing', 0.6 + ag],
          ['spray', 0.4 + bot.tuning.crouchChance],
          ['adad', 0.5 + ag * 0.4],
        ];
        const total = table.reduce((a, [, w]) => a + w, 0);
        let x = ctx.rng() * total;
        for (const [k, w] of table) {
          x -= w;
          if (x <= 0) return k;
        }
        return 'full';
      }
    }
  }

  private beginPeek(bot: Bot, ctx: BotContext, plan: PeekKind) {
    const info = this.analyse(ctx);
    if (info.exposeAt === null) {
      // Player moved somewhere this spot cannot see: try again later.
      this.enterHidden(bot, ctx, 1 + ctx.rng());
      return;
    }
    this.plan = plan;
    bot.peekKind = plan;
    bot.seenThisPeek = false;
    bot.faceYaw = null;
    const run = bot.maxRun;
    const r = ctx.rng;
    switch (plan) {
      case 'jiggle':
        this.repeats = this.repeats > 0 ? this.repeats : 2 + Math.floor(r() * 3);
        this.targetD = Math.min(this.reach, this.exposeD + lerp(0.3, 0.7, r()));
        this.speed = run;
        bot.committed = false;
        bot.wantsToShoot = false;
        break;
      case 'shoulder':
        this.repeats = this.repeats > 0 ? this.repeats : 1 + Math.floor(r() * 3);
        this.targetD = Math.min(this.reach, this.exposeD + lerp(0.06, 0.2, r()));
        this.speed = run * 0.9;
        bot.committed = false;
        bot.wantsToShoot = false;
        break;
      case 'full':
        this.targetD = Math.min(this.reach, this.exposeD + lerp(0.9, 1.8, r()));
        this.speed = run;
        bot.committed = true;
        bot.wantsToShoot = true;
        break;
      case 'spray':
        this.targetD = Math.min(this.reach, this.exposeD + lerp(0.6, 1.1, r()));
        this.speed = run;
        bot.committed = true;
        bot.wantsToShoot = true;
        break;
      case 'adad':
        this.adadCycles = 2 + Math.floor(r() * 2);
        this.targetD = Math.min(this.reach, this.exposeD + lerp(0.9, 1.5, r()));
        this.speed = run;
        bot.committed = true;
        bot.wantsToShoot = true;
        break;
      case 'swing': {
        bot.committed = true;
        bot.wantsToShoot = true;
        // back up behind cover to build speed first
        const back = this.backReach(bot, ctx, lerp(1.2, 2.2, r()));
        this.state = 'prep';
        bot.moveSpeed = run * 0.8;
        bot.moveTarget = this.pointAt(this.hideD - back);
        bot.wantsToShoot = false;
        return;
      }
      default:
        break;
    }
    this.state = 'out';
    bot.moveSpeed = this.speed;
    bot.moveTarget = this.pointAt(this.targetD);
  }

  /** How far the bot can step back from the hide point along -peekDir (meters). */
  private backReach(bot: Bot, ctx: BotContext, want: number) {
    let d = 0;
    for (let s = 0.1; s <= want; s += 0.1) {
      const [x, z] = this.pointAt(this.hideD - s);
      if (ctx.world.overlap(x, bot.y + 0.05, z, BOT_RADIUS, BOT_HEIGHT)) break;
      d = s;
    }
    return d;
  }

  private arrived(bot: Bot) {
    if (!bot.moveTarget) return true;
    return bot.distTo(bot.moveTarget[0], bot.moveTarget[1]) < 0.06 && bot.speed < 0.6;
  }

  update(bot: Bot, ctx: BotContext, dt: number) {
    if (bot.seesPlayer || bot.visibleToPlayer) bot.seenThisPeek = bot.seenThisPeek || bot.visibleToPlayer;
    this.timer -= dt;
    switch (this.state) {
      case 'unusable':
        bot.wantsToShoot = false;
        return;
      case 'hidden':
        if (this.timer <= 0 && ctx.player.alive) this.beginPeek(bot, ctx, this.repeats > 0 ? this.plan : this.choosePlan(bot, ctx));
        return;
      case 'prep':
        if (this.arrived(bot) || this.timer < -1.5) {
          this.targetD = Math.min(this.reach, this.exposeD + lerp(2.4, 4.2, ctx.rng()));
          this.speed = bot.maxRun * 1.08;
          bot.moveSpeed = this.speed;
          bot.moveTarget = this.pointAt(this.targetD);
          bot.wantsToShoot = true;
          this.state = 'out';
        }
        return;
      case 'out':
        if (this.arrived(bot)) {
          if (this.plan === 'jiggle' || this.plan === 'shoulder') {
            this.state = 'hold';
            this.timer = this.plan === 'jiggle' ? lerp(0.05, 0.16, ctx.rng()) : lerp(0.15, 0.4, ctx.rng());
          } else {
            this.state = 'engage';
            this.engagedShots = bot.shotsFired;
            const dur = bot.tuning.peekDuration * lerp(0.8, 1.5, ctx.rng());
            this.timer = this.plan === 'adad' ? lerp(0.35, 0.6, ctx.rng()) : dur;
            if (this.plan === 'spray') {
              bot.crouchTarget = 1;
              bot.sprayMode = true;
              this.timer = dur + 0.6;
            } else if (ctx.rng() < bot.tuning.crouchChance * 0.4) bot.crouchTarget = 1;
          }
        }
        return;
      case 'hold':
        if (this.timer <= 0) this.retreat(bot);
        return;
      case 'engage': {
        if (this.plan === 'stationary') return; // holds until killed
        // While the player is visible and we are mid-burst, keep fighting a little longer.
        const fighting = bot.seesPlayer && bot.burstLeft > 0;
        if (this.timer <= 0 && !fighting) {
          if (this.plan === 'adad' && this.adadCycles > 0) {
            this.adadCycles--;
            // strafe to a new offset on the same line (wider or tighter), then stop and shoot again
            const wide = ctx.rng() < 0.5;
            this.targetD = Math.min(this.reach, this.exposeD + (wide ? lerp(1.6, 2.6, ctx.rng()) : lerp(0.3, 0.7, ctx.rng())));
            bot.moveSpeed = bot.maxRun;
            bot.moveTarget = this.pointAt(this.targetD);
            this.state = 'out';
            return;
          }
          this.retreat(bot);
        }
        return;
      }
      case 'back':
        if (this.arrived(bot)) {
          if (bot.seenThisPeek && bot.committed && bot.alive) this.hooks.onEscape(bot);
          bot.committed = false;
          if ((this.plan === 'jiggle' || this.plan === 'shoulder') && this.repeats > 1) {
            this.repeats--;
            this.enterHidden(bot, ctx, lerp(0.2, 0.75, ctx.rng()));
            return;
          }
          // Jiggle sequences can end in a committed peek.
          if ((this.plan === 'jiggle' || this.plan === 'shoulder') && ctx.rng() < 0.2 + bot.tuning.aggression * 0.4) {
            this.repeats = 0;
            this.enterHidden(bot, ctx, lerp(0.15, 0.5, ctx.rng()));
            this.plan = ctx.rng() < 0.5 ? 'full' : 'swing';
            this.repeats = 1;
            return;
          }
          this.repeats = 0;
          const shot = bot.shotsFired - this.engagedShots > 0;
          const repositionChance = Math.max(0, bot.tuning.aggression - 0.3) * 0.8 + (shot ? 0.15 : 0);
          if (shot && ctx.rng() < repositionChance && this.tryRelocate(bot, ctx)) return;
          this.enterHidden(bot, ctx, this.waitTime(bot, ctx));
        }
        return;
      case 'relocate':
        if (this.arrived(bot) || this.timer < -6) {
          if (this.relocateTarget) this.spot = this.relocateTarget;
          this.relocateTarget = null;
          this.analyse(ctx);
          this.enterHidden(bot, ctx, this.waitTime(bot, ctx) * 0.7);
        }
        return;
    }
  }

  private retreat(bot: Bot) {
    this.state = 'back';
    bot.wantsToShoot = false;
    bot.sprayMode = false;
    bot.crouchTarget = 0;
    bot.moveSpeed = bot.maxRun;
    bot.moveTarget = this.pointAt(this.hideD);
  }

  /** Move to another unclaimed spot within reach (straight-line walkable and hidden). */
  private tryRelocate(bot: Bot, ctx: BotContext): boolean {
    const claimed = this.hooks.claimed();
    const options = this.hooks.spots.filter((s) => {
      if (s.id === this.spot.id || claimed.has(s.id)) return false;
      if (Math.hypot(s.cover[0] - bot.x, s.cover[2] - bot.z) > 16) return false;
      if (Math.abs(s.cover[1] - bot.y) > 0.5) return false;
      return ctx.world.segmentClear(bot.x, bot.y + 0.5, bot.z, s.cover[0], s.cover[1] + 0.5, s.cover[2]);
    });
    if (options.length === 0) return false;
    const target = options[Math.floor(ctx.rng() * options.length)];
    this.relocateTarget = target;
    this.state = 'relocate';
    this.timer = 0;
    bot.moveSpeed = bot.maxRun;
    bot.moveTarget = [target.cover[0], target.cover[2]];
    bot.wantsToShoot = false;
    bot.faceYaw = Math.atan2(target.cover[0] - bot.x, target.cover[2] - bot.z);
    return true;
  }

  onDamaged(bot: Bot, ctx: BotContext) {
    // Tagged during a bait peek → duck back; committed fighters keep shooting unless timid.
    if (this.state === 'out' || this.state === 'hold') {
      if (!bot.committed || ctx.rng() > bot.tuning.aggression) this.retreat(bot);
    }
  }

  /** Whether the bot is currently performing a bait (non-committed) peek. */
  get baiting() {
    return (this.plan === 'jiggle' || this.plan === 'shoulder') && (this.state === 'out' || this.state === 'hold');
  }
}
