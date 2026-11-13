import type { SensitivitySettings } from '../../types';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Input } from '../core/Input';
import { YAW_DEG_PER_COUNT } from '../../settings/defaults';

const PLAYER_RADIUS = 0.3;
const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.25;
export const STAND_EYE = 1.62;
const CROUCH_EYE = 1.08;
/** Full running speed in m/s (raised from 5.4, about 8% faster). Walk and crouch speeds scale from it. */
export const RUN_SPEED = 5.85;
const WALK_MULT = 0.65;
const CROUCH_MULT = 0.5;
const ACCEL = 48;
const DECEL_RELEASE = 34;
const DECEL_COUNTER = 75;
const AIR_ACCEL = 9;
const GRAVITY = 20;
const JUMP_VELOCITY = 6.6;
const STEP_HEIGHT = 0.45;
const CROUCH_TIME = 0.12;
const MAX_PITCH = (89 * Math.PI) / 180;

export interface PlayerEvents {
  onFootstep?: (speed: number) => void;
  onJump?: () => void;
  onLand?: (impact: number) => void;
}

export class PlayerController {
  pos = { x: 0, y: 0, z: 0 };
  vel = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  grounded = true;
  crouch = 0;
  crouching = false;
  walking = false;
  health = 100;
  armor = 50;
  alive = true;
  /** Multiplier from weapon / ADS. */
  speedMult = 1;
  /** Visual eye offset used to smooth step-ups. */
  private eyeLag = 0;
  private stepTimer = 0;
  private airTime = 0;
  events: PlayerEvents = {};

  constructor(private readonly world: CollisionWorld) {}

  spawn(x: number, y: number, z: number, yawDeg: number) {
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = 0;
    this.crouch = 0;
    this.crouching = false;
    this.grounded = true;
    this.health = 100;
    this.armor = 50;
    this.alive = true;
    this.eyeLag = 0;
  }

  /** Raw mouse counts → camera rotation using Valorant-scale sensitivity (0.07°/count). */
  /**
   * `zoom`: a scope's magnification. Scoped look speed is divided by it, so at a scoped multiplier of 1
   * the picture moves across the screen as fast as it does unscoped, at either zoom level.
   */
  applyLook(dx: number, dy: number, s: SensitivitySettings, zoomed: boolean, scoped = false, zoom = 1) {
    if (dx === 0 && dy === 0) return;
    const mult = zoomed ? (scoped ? s.scopedMult / zoom : s.adsMult) : 1;
    const k = ((s.sensitivity * YAW_DEG_PER_COUNT * Math.PI) / 180) * mult;
    this.yaw += dx * k * s.horizontalMult;
    this.pitch -= dy * k * s.verticalMult * (s.invertY ? -1 : 1);
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;
    // keep yaw bounded for numerical stability
    if (this.yaw > Math.PI * 4 || this.yaw < -Math.PI * 4) this.yaw %= Math.PI * 2;
  }

  get height() {
    return STAND_HEIGHT + (CROUCH_HEIGHT - STAND_HEIGHT) * this.crouch;
  }

  get eyeHeight() {
    return STAND_EYE + (CROUCH_EYE - STAND_EYE) * this.crouch;
  }

  eye(): [number, number, number] {
    return [this.pos.x, this.pos.y + this.eyeHeight - this.eyeLag, this.pos.z];
  }

  /** Horizontal speed in m/s. */
  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get maxSpeed() {
    let s = RUN_SPEED * this.speedMult;
    if (this.crouching) s *= CROUCH_MULT;
    else if (this.walking) s *= WALK_MULT;
    return s;
  }

  update(dt: number, input: Input | null) {
    if (!this.alive) {
      this.vel.x = this.vel.z = 0;
      return;
    }
    // ---- intent
    let fx = 0;
    let fz = 0;
    if (input) {
      if (input.isDown('forward')) fz += 1;
      if (input.isDown('back')) fz -= 1;
      if (input.isDown('right')) fx += 1;
      if (input.isDown('left')) fx -= 1;
      this.walking = input.isDown('walk');
      const wantCrouch = input.isDown('crouch');
      if (wantCrouch) this.crouching = true;
      else if (this.crouching) {
        // stand up only if there is head room
        if (!this.world.overlap(this.pos.x, this.pos.y + 0.01, this.pos.z, PLAYER_RADIUS, STAND_HEIGHT)) this.crouching = false;
      }
      if (input.consume('jump') && this.grounded && !this.crouching) {
        this.vel.y = JUMP_VELOCITY;
        this.grounded = false;
        this.events.onJump?.();
      }
    }
    const crouchTarget = this.crouching ? 1 : 0;
    const cstep = dt / CROUCH_TIME;
    this.crouch += Math.max(-cstep, Math.min(cstep, crouchTarget - this.crouch));

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = fx * cos + fz * sin;
    let wz = -fx * sin + fz * cos;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
    }
    const maxSpeed = this.maxSpeed;
    const tx = wx * maxSpeed;
    const tz = wz * maxSpeed;

    // ---- horizontal velocity
    const dvx = tx - this.vel.x;
    const dvz = tz - this.vel.z;
    const dvl = Math.hypot(dvx, dvz);
    if (dvl > 1e-5) {
      let rate: number;
      if (!this.grounded) rate = AIR_ACCEL;
      else if (this.vel.x * tx + this.vel.z * tz < 0) rate = DECEL_COUNTER;
      else if (wl === 0 || Math.hypot(tx, tz) < this.speed) rate = DECEL_RELEASE;
      else rate = ACCEL;
      const step = rate * dt;
      if (step >= dvl) {
        if (this.grounded || wl > 0) {
          this.vel.x = tx;
          this.vel.z = tz;
        }
      } else if (this.grounded || wl > 0) {
        this.vel.x += (dvx / dvl) * step;
        this.vel.z += (dvz / dvl) * step;
      }
    }

    // ---- gravity
    this.vel.y -= GRAVITY * dt;
    const wasGrounded = this.grounded;
    const res = this.world.moveBody(
      this.pos,
      PLAYER_RADIUS,
      this.height,
      this.vel.x * dt,
      this.vel.y * dt,
      this.vel.z * dt,
      STEP_HEIGHT,
      wasGrounded && this.vel.y <= 0.01,
    );
    if (res.blockedX) this.vel.x = 0;
    if (res.blockedZ) this.vel.z = 0;
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;
    if (res.grounded) {
      if (!wasGrounded && this.airTime > 0.15) this.events.onLand?.(-this.vel.y);
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
      this.airTime = 0;
    } else {
      this.grounded = false;
      this.airTime += dt;
    }
    if (res.steppedUp > 0) this.eyeLag += res.steppedUp;
    this.eyeLag = Math.max(0, this.eyeLag - dt * 3.5);

    // ---- footsteps (running only; walking & crouching are silent)
    const sp = this.speed;
    if (this.grounded && !this.walking && !this.crouching && sp > 3.6) {
      this.stepTimer -= dt * (sp / RUN_SPEED);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.36;
        this.events.onFootstep?.(sp);
      }
    } else this.stepTimer = Math.min(this.stepTimer, 0.12);
  }

  /** Apply damage; armor soaks damage first. Returns true when this kills the player. */
  damage(amount: number): boolean {
    if (!this.alive) return false;
    const fromArmor = Math.min(this.armor, amount);
    this.armor -= fromArmor;
    this.health -= amount - fromArmor;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      return true;
    }
    return false;
  }
}
