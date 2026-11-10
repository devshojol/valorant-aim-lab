import type { BotTuning, Vec3, WeaponConfig } from '../../types';
import type { MapData } from '../maps/MapData';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { PlayerController } from '../player/PlayerController';
import { WEAPONS, recoilAt } from '../weapons/weaponConfigs';
import { smoothstep } from '../weapons/WeaponSystem';
import { BOT_RADIUS, visibleSampleCount } from './perception/visibility';
import type { BotView } from './BotVisual';

const DEG = Math.PI / 180;
const BOT_RUN = 5.4;
const ACCEL = 45;
const DECEL = 72;
const GRAVITY = 20;

export interface BotContext {
  time: number;
  world: CollisionWorld;
  map: MapData;
  player: PlayerController;
  botsShootBack: boolean;
  bots: Bot[];
  rng: () => number;
  /** Engine resolves the shot against walls and the player. */
  botFire(bot: Bot, origin: Vec3, dir: Vec3): void;
  onBotFootstep(bot: Bot): void;
}

export interface BotBrain {
  readonly kind: string;
  update(bot: Bot, ctx: BotContext, dt: number): void;
  /** Player gunfire / footsteps heard at a position. */
  hear?(bot: Bot, ctx: BotContext, x: number, z: number): void;
  onDamaged?(bot: Bot, ctx: BotContext): void;
  /** Short label for debug overlays/tests. */
  describe(): string;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function gauss(rng: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const NAMES = ['Viper', 'Rook', 'Kestrel', 'Onyx', 'Wraith', 'Ember', 'Nova', 'Talon', 'Jinx', 'Sable', 'Vex', 'Pyre'];

export class Bot {
  static nextId = 1;
  readonly id: number;
  readonly name: string;
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  grounded = true;
  /** Body/aim yaw (radians, 0 = +Z). */
  yaw = 0;
  aimPitch = 0;
  crouch = 0;
  crouchTarget = 0;
  health = 100;
  armor = 50;
  alive = true;
  deathTime = 0;
  weapon: WeaponConfig = WEAPONS.vandal;

  // desired motion (set by the brain)
  moveTarget: [number, number] | null = null;
  moveSpeed = BOT_RUN;
  /** Direction to face when not aiming at the player. */
  faceYaw: number | null = null;
  wantsToShoot = false;
  /** Extra shots per burst for spray behaviours. */
  sprayMode = false;
  preAimed = false;

  // perception
  seesPlayer = false;
  seenAt = -1;
  reactAt = Infinity;
  lastSeenTime = -99;
  lastKnown: [number, number] | null = null;
  private perceptionTimer = 0;

  // aim
  private aimErrYaw = 0;
  private aimErrPitch = 0;
  private errTau = 0.3;
  aimZone: 'head' | 'body' = 'body';

  // shooting
  fireCooldown = 0;
  burstLeft = 0;
  burstPause = 0;
  recoilIdx = 0;
  shotsFired = 0;
  sinceShot = 10;

  // practice metrics
  visibleToPlayer = false;
  visibleSince = -1;
  hitThisExposure = false;
  seenThisPeek = false;
  /** Current peek type (for jiggle-training bait accounting). */
  peekKind = 'none';
  /** Whether this exposure is a committed peek (for escape accounting). */
  committed = false;
  stepTimer = 0;

  brain: BotBrain | null = null;

  constructor(
    public tuning: BotTuning,
    public visual: BotView | null,
  ) {
    this.id = Bot.nextId++;
    this.name = NAMES[(this.id - 1) % NAMES.length];
    this.perceptionTimer = Math.random() / 15;
  }

  get acc() {
    return Math.max(0, Math.min(1, this.tuning.accuracy));
  }
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }
  get maxRun() {
    return BOT_RUN * this.tuning.moveSpeed;
  }
  eye(): Vec3 {
    const legH = 0.86 - 0.55 * this.crouch;
    return [this.x, this.y + legH + 0.75, this.z];
  }

  place(x: number, y: number, z: number, yaw: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.yaw = yaw;
    this.aimPitch = 0;
    this.moveTarget = null;
  }

  reset() {
    this.health = 100;
    this.armor = 50;
    this.alive = true;
    this.crouch = 0;
    this.crouchTarget = 0;
    this.seesPlayer = false;
    this.reactAt = Infinity;
    this.lastKnown = null;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.recoilIdx = 0;
    this.wantsToShoot = false;
    this.sprayMode = false;
    this.visibleToPlayer = false;
    this.visibleSince = -1;
    this.hitThisExposure = false;
    this.seenThisPeek = false;
    this.committed = false;
    this.peekKind = 'none';
    this.visual?.revive();
  }

  /** Returns true when the damage kills the bot. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    const a = Math.min(this.armor, amount);
    this.armor -= a;
    this.health -= amount - a;
    this.visual?.hit();
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.visual?.die();
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------- */
  /* Perception                                                     */
  /* ------------------------------------------------------------- */

  private updatePerception(ctx: BotContext, dt: number) {
    this.perceptionTimer -= dt;
    if (this.perceptionTimer > 0) return;
    this.perceptionTimer = 1 / 15;
    const p = ctx.player;
    if (!p.alive) {
      this.seesPlayer = false;
      return;
    }
    const [ex, ey, ez] = this.eye();
    const dx = p.pos.x - ex;
    const dz = p.pos.z - ez;
    const dist = Math.hypot(dx, dz);
    let visible = false;
    if (dist < 90) {
      // field of view (~130° horizontal)
      const toYaw = Math.atan2(dx, dz);
      const off = Math.abs(angleDiff(toYaw, this.yaw));
      if (off < 65 * DEG || dist < 2.5) {
        visible = visibleSampleCount(ctx.world, ex, ey, ez, p.pos.x, p.pos.y, p.pos.z, p.crouch) > 0;
      }
    }
    if (visible) {
      if (!this.seesPlayer) this.acquire(ctx);
      this.lastKnown = [p.pos.x, p.pos.z];
      this.lastSeenTime = ctx.time;
    }
    this.seesPlayer = visible;
  }

  private acquire(ctx: BotContext) {
    const acc = this.acc;
    this.seenAt = ctx.time;
    const reaction = (this.tuning.reactionMs / 1000) * (0.85 + ctx.rng() * 0.35);
    // A re-acquisition within a moment of losing sight is faster (tracking).
    const recently = ctx.time - this.lastSeenTime < 0.6;
    this.reactAt = ctx.time + (recently ? reaction * 0.35 : reaction);
    const pre = this.preAimed ? 0.55 : 1;
    const sigma0 = lerp(7, 1.1, acc) * pre * (recently ? 0.4 : 1);
    this.aimErrYaw = gauss(ctx.rng) * sigma0;
    this.aimErrPitch = gauss(ctx.rng) * sigma0 * 0.6;
    this.errTau = lerp(0.5, 0.12, acc);
    this.aimZone = ctx.rng() < 0.12 + 0.72 * acc ? 'head' : 'body';
  }

  /** Called by the director when the bot is shot at or hears the player. */
  alertTo(x: number, z: number) {
    this.lastKnown = [x, z];
  }

  /* ------------------------------------------------------------- */
  /* Aim + shooting                                                 */
  /* ------------------------------------------------------------- */

  private aimTargetPoint(ctx: BotContext): Vec3 {
    const p = ctx.player;
    const legH = 0.86 - 0.55 * p.crouch;
    const y = p.pos.y + (this.aimZone === 'head' ? legH + 0.75 : legH + 0.28);
    return [p.pos.x, y, p.pos.z];
  }

  private updateAim(ctx: BotContext, dt: number) {
    const acc = this.acc;
    const decay = Math.exp(-dt / this.errTau);
    this.aimErrYaw *= decay;
    this.aimErrPitch *= decay;

    let wantYaw: number | null = null;
    let wantPitch = 0;
    if (this.seesPlayer) {
      const [ex, ey, ez] = this.eye();
      const [tx, ty, tz] = this.aimTargetPoint(ctx);
      const dx = tx - ex;
      const dy = ty - ey;
      const dz = tz - ez;
      wantYaw = Math.atan2(dx, dz) + this.aimErrYaw * DEG;
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + this.aimErrPitch * DEG;
    } else if (this.faceYaw !== null) {
      wantYaw = this.faceYaw;
    } else if (this.lastKnown) {
      wantYaw = Math.atan2(this.lastKnown[0] - this.x, this.lastKnown[1] - this.z);
    }
    if (wantYaw !== null) {
      const rate = lerp(320, 1100, acc) * DEG * dt;
      const d = angleDiff(wantYaw, this.yaw);
      this.yaw += Math.max(-rate, Math.min(rate, d));
      const dp = wantPitch - this.aimPitch;
      this.aimPitch += Math.max(-rate, Math.min(rate, dp));
    }
  }

  /** Angular error (radians) between current aim and the true target. */
  private aimError(ctx: BotContext): number {
    const [ex, ey, ez] = this.eye();
    const [tx, ty, tz] = this.aimTargetPoint(ctx);
    const yawT = Math.atan2(tx - ex, tz - ez);
    const pitchT = Math.atan2(ty - ey, Math.hypot(tx - ex, tz - ez));
    return Math.hypot(angleDiff(yawT, this.yaw), pitchT - this.aimPitch);
  }

  private updateShooting(ctx: BotContext, dt: number) {
    const w = this.weapon;
    this.fireCooldown -= dt;
    this.sinceShot += dt;
    if (this.sinceShot > Math.max(w.recoil.recoveryDelay, (1 / w.fireRate) * 1.15)) this.recoilIdx = Math.max(0, this.recoilIdx - w.recoil.recoveryRate * dt);
    if (this.burstPause > 0) this.burstPause -= dt;

    const canShoot =
      ctx.botsShootBack &&
      this.wantsToShoot &&
      this.seesPlayer &&
      ctx.player.alive &&
      ctx.time >= this.reactAt &&
      this.burstPause <= 0;
    if (!canShoot) {
      this.fireCooldown = Math.max(0, this.fireCooldown);
      return;
    }
    // Disciplined bots don't fire while running (counter-strafe first).
    const speedFrac = this.speed / BOT_RUN;
    const runAndGunOk = this.acc < 0.3 && speedFrac < 0.8;
    if (speedFrac > 0.3 && !runAndGunOk) return;
    const tolerance = (2.2 + (1 - this.acc) * 3) * DEG;
    if (this.aimError(ctx) > tolerance) return;
    if (this.fireCooldown > 0) return;

    if (this.burstLeft <= 0) {
      const base = Math.max(1, Math.round(this.tuning.burstLength));
      this.burstLeft = this.sprayMode ? base + 6 + Math.floor(ctx.rng() * 6) : base + Math.floor(ctx.rng() * 2);
    }
    this.fireOnce(ctx, speedFrac);
    this.fireCooldown = Math.max(this.fireCooldown, -0.05) + 1 / w.fireRate;
    this.burstLeft--;
    if (this.burstLeft <= 0) this.burstPause = lerp(0.5, 0.22, this.acc) * (0.8 + ctx.rng() * 0.5);
  }

  private fireOnce(ctx: BotContext, speedFrac: number) {
    const w = this.weapon;
    const acc = this.acc;
    const comp = this.sprayMode ? 0.35 + 0.6 * acc : 0.3 + 0.6 * acc;
    const [ry, rp] = recoilAt(w, this.recoilIdx);
    const residual = lerp(1.8, 0.22, acc);
    const move = w.spread.moveMax * smoothstep(w.spread.accurateSpeedFraction, 1, speedFrac);
    const spread = (this.recoilIdx < 0.5 ? w.spread.base : w.spread.base + this.recoilIdx * 0.05) + move;
    const ang = ctx.rng() * Math.PI * 2;
    const rad = spread * Math.sqrt(ctx.rng());
    const yaw = this.yaw + (ry * (1 - comp) + gauss(ctx.rng) * residual + Math.cos(ang) * rad) * DEG;
    const pitch = this.aimPitch + (rp * (1 - comp) + gauss(ctx.rng) * residual * 0.7 + Math.sin(ang) * rad) * DEG;
    const cp = Math.cos(pitch);
    const dir: Vec3 = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
    this.recoilIdx += 1;
    this.sinceShot = 0;
    this.shotsFired++;
    this.visual?.muzzleFlash();
    ctx.botFire(this, this.eye(), dir);
  }

  /* ------------------------------------------------------------- */
  /* Movement                                                       */
  /* ------------------------------------------------------------- */

  private updateMovement(ctx: BotContext, dt: number) {
    let tvx = 0;
    let tvz = 0;
    if (this.moveTarget) {
      const dx = this.moveTarget[0] - this.x;
      const dz = this.moveTarget[1] - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.02) {
        // arrive: decelerate so we stop on the target (sharp, counter-strafe-like stop)
        const sp = Math.min(this.moveSpeed, Math.sqrt(2 * DECEL * 0.8 * dist));
        tvx = (dx / dist) * sp;
        tvz = (dz / dist) * sp;
      }
    }
    const dvx = tvx - this.vx;
    const dvz = tvz - this.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl > 1e-5) {
      const opposing = this.vx * tvx + this.vz * tvz < 0 || Math.hypot(tvx, tvz) < this.speed;
      const step = (opposing ? DECEL : ACCEL) * dt;
      if (step >= dl) {
        this.vx = tvx;
        this.vz = tvz;
      } else {
        this.vx += (dvx / dl) * step;
        this.vz += (dvz / dl) * step;
      }
    }
    this.vy -= GRAVITY * dt;
    const crouchStep = dt / 0.14;
    this.crouch += Math.max(-crouchStep, Math.min(crouchStep, this.crouchTarget - this.crouch));
    const pos = { x: this.x, y: this.y, z: this.z };
    const h = 1.8 - 0.55 * this.crouch;
    const res = ctx.world.moveBody(pos, BOT_RADIUS, h, this.vx * dt, this.vy * dt, this.vz * dt, 0.45, this.grounded);
    this.x = pos.x;
    this.y = pos.y;
    this.z = pos.z;
    if (res.blockedX) this.vx = 0;
    if (res.blockedZ) this.vz = 0;
    if (res.grounded && this.vy < 0) this.vy = 0;
    this.grounded = res.grounded;

    // running footsteps are audible (walking is silent)
    if (this.grounded && this.speed > 3.6) {
      this.stepTimer -= dt * (this.speed / BOT_RUN);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.36;
        ctx.onBotFootstep(this);
      }
    }
  }

  /** Distance to a world point on XZ. */
  distTo(x: number, z: number) {
    return Math.hypot(x - this.x, z - this.z);
  }

  update(ctx: BotContext, dt: number) {
    if (!this.alive) {
      this.visual?.update(dt, this.x, this.y, this.z, this.yaw, 0, this.crouch, 0, this.y);
      return;
    }
    this.updatePerception(ctx, dt);
    this.brain?.update(this, ctx, dt);
    this.updateAim(ctx, dt);
    this.updateMovement(ctx, dt);
    this.updateShooting(ctx, dt);
    this.visual?.update(dt, this.x, this.y, this.z, this.yaw, this.aimPitch, this.crouch, this.speed, this.y);
  }
}
