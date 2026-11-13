import type { WeaponConfig, WeaponId } from '../../types';
import type { Input } from '../core/Input';
import type { PlayerController } from '../player/PlayerController';
import { RUN_SPEED } from '../player/PlayerController';
import { WEAPONS, recoilAt } from './weaponConfigs';

const DEG = Math.PI / 180;
/** Share of the reload time the reload animation takes (1 = the animation ends exactly when the gun can fire). */
export const RELOAD_ANIM_SHARE = 1;
/** Bolt action: the scope starts coming back up this long before the next shot is ready (seconds). */
export const RESCOPE_LEAD = 0.5;
/**
 * Working the bolt after a shot, in seconds after it (for a gun firing every 1.67 s; scaled to others):
 * the trigger hand goes to the handle (`reach`), lifts it (`lift`), draws the bolt back (`back`), pushes it
 * home (`forward`), turns the handle down (`down`) and is back on the grip at `done`.
 */
export const BOLT_CYCLE = { reach: 0.26, lift: 0.46, back: 0.56, forward: 0.74, down: 0.9, release: 0.98, done: 1.15, per: 1 / 0.6 };
/** Bolt action: the wait between the last round of a magazine and its reload (no bolt to work). */
const LAST_ROUND_DELAY = 0.45;

export interface ShotInfo {
  origin: [number, number, number];
  dir: [number, number, number];
  weapon: WeaponConfig;
  bulletIndex: number;
  firstShot: boolean;
  moving: boolean;
  spreadDeg: number;
  /** The player's aim (radians) when the bullet left, before recoil and spread. */
  aimYaw: number;
  aimPitch: number;
  /** Recoil-pattern offset [yaw, pitch] in degrees applied to this bullet (no jitter or spread). */
  recoil: [number, number];
}

export interface WeaponEvents {
  onShot?: (shot: ShotInfo) => void;
  onReloadStart?: (w: WeaponConfig) => void;
  onReloadEnd?: (w: WeaponConfig) => void;
  onEquip?: (w: WeaponConfig) => void;
  onDryFire?: (w: WeaponConfig) => void;
}

interface Slot {
  cfg: WeaponConfig;
  ammo: number;
  reserve: number;
}

export function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class WeaponSystem {
  slots: Slot[];
  current = 0;
  cooldown = 0;
  equipTimer = 0;
  reloadTimer = 0;
  recoilIndex = 0;
  firingError = 0;
  sinceShot = 10;
  ads = 0; // 0..1 blend
  adsHeld = false;
  /** Scoped weapons: 0 = not scoped, 1 and 2 = the zoom levels (right click cycles through them). */
  scopeLevel = 0;
  /** Scoped weapons: the zoom the scope is at now (eased between the two levels). */
  scopeZoom = 1;
  burstQueue = 0;
  burstTimer = 0;
  burstCooldown = 0;
  infiniteAmmo = true;
  /** Seconds since the last shot (for viewmodel kick). */
  lastShotAge = 10;
  lastMovementError = 0;
  lastFiringError = 0;
  rng: () => number = Math.random;
  events: WeaponEvents = {};

  constructor(primary: WeaponId, secondary: WeaponId) {
    this.slots = [primary, secondary].map((id) => {
      const cfg = WEAPONS[id];
      return { cfg, ammo: cfg.magazine, reserve: cfg.reserve };
    });
    this.equipTimer = this.weapon.equipTime * 0.5;
  }

  get weapon(): WeaponConfig {
    return this.slots[this.current].cfg;
  }
  get slot(): Slot {
    return this.slots[this.current];
  }
  get reloading() {
    return this.reloadTimer > 0;
  }
  get reloadProgress() {
    return this.reloadTimer > 0 ? 1 - this.reloadTimer / this.weapon.reloadTime : 0;
  }
  /**
   * Progress of the reload *animation* (0 → 1). The animation and its sound cues last the whole
   * reload (RELOAD_ANIM_SHARE). 1 when not reloading.
   */
  get reloadAnimProgress() {
    if (this.reloadTimer <= 0) return 1;
    const elapsed = this.weapon.reloadTime - this.reloadTimer;
    return Math.min(1, elapsed / (this.weapon.reloadTime * RELOAD_ANIM_SHARE));
  }
  get equipProgress() {
    return this.equipTimer > 0 ? 1 - this.equipTimer / this.weapon.equipTime : 1;
  }
  get isAds() {
    return this.ads > 0.5 && this.weapon.altFire === 'ads';
  }
  /** View magnification right now (1 = not aiming). */
  get zoom() {
    const w = this.weapon;
    if (w.altFire !== 'ads') return 1;
    return 1 + ((w.ads.scope ? this.scopeZoom : w.ads.zoom) - 1) * this.ads;
  }
  /** Bolt action: seconds into working the bolt after a shot, or −1 when it isn't being worked. */
  get boltCycleAge() {
    const w = this.weapon;
    if (!w.boltAction || this.reloadTimer > 0 || this.equipTimer > 0 || this.slot.ammo <= 0 || this.cooldown <= 0) return -1;
    return this.lastShotAge;
  }

  refill() {
    for (const s of this.slots) {
      s.ammo = s.cfg.magazine;
      s.reserve = s.cfg.reserve;
    }
    this.reloadTimer = 0;
    this.recoilIndex = 0;
    this.firingError = 0;
  }

  /** Put a different weapon in a slot (full magazine). The gun is re-drawn if it is the one in hand. */
  setSlot(index: number, id: WeaponId) {
    const s = this.slots[index];
    if (!s || s.cfg.id === id) return;
    const cfg = WEAPONS[id];
    this.slots[index] = { cfg, ammo: cfg.magazine, reserve: cfg.reserve };
    if (index !== this.current) return;
    this.reloadTimer = 0;
    this.burstQueue = 0;
    this.adsHeld = false;
    this.scopeLevel = 0;
    this.ads = 0;
    this.recoilIndex = 0;
    this.firingError = 0;
    this.cooldown = 0;
    this.equipTimer = cfg.equipTime * 0.6;
    this.events.onEquip?.(cfg);
  }

  switchTo(index: number) {
    if (index === this.current || !this.slots[index]) return;
    this.current = index;
    this.reloadTimer = 0;
    this.burstQueue = 0;
    this.adsHeld = false;
    this.scopeLevel = 0;
    this.ads = 0;
    this.recoilIndex = 0;
    this.firingError = 0;
    this.cooldown = Math.min(this.cooldown, 0); // a bolt cycle doesn't carry over to the other gun
    this.equipTimer = this.weapon.equipTime;
    this.events.onEquip?.(this.weapon);
  }

  startReload() {
    const s = this.slot;
    if (this.reloadTimer > 0 || s.ammo >= s.cfg.magazine) return;
    if (!this.infiniteAmmo && s.reserve <= 0) return;
    this.reloadTimer = s.cfg.reloadTime;
    this.adsHeld = false;
    this.scopeLevel = 0; // reloading takes you out of the scope; it does not come back by itself
    this.burstQueue = 0;
    this.events.onReloadStart?.(s.cfg);
  }

  /** Spread components in degrees for the current state. */
  spread(player: PlayerController): { total: number; movement: number; firing: number; base: number } {
    const w = this.weapon;
    // a scope is only accurate once it is all the way up
    let base = (w.ads.scope ? this.ads > 0.95 : this.isAds) ? w.spread.ads : w.spread.base;
    if (player.crouch > 0.5) base *= w.spread.crouchMult;
    const speedFrac = player.speed / (RUN_SPEED * w.runSpeedMult);
    let movement = w.spread.moveMax * smoothstep(w.spread.accurateSpeedFraction, 1, speedFrac);
    if (!player.grounded) movement = Math.max(movement, w.spread.air);
    const firing = this.firingError;
    return { total: base + movement + firing, movement, firing, base };
  }

  update(dt: number, input: Input | null, player: PlayerController) {
    const w = this.weapon;
    this.cooldown -= dt;
    this.sinceShot += dt;
    this.lastShotAge += dt;
    this.burstCooldown = Math.max(0, this.burstCooldown - dt);

    if (this.equipTimer > 0) this.equipTimer = Math.max(0, this.equipTimer - dt);

    // recoil + firing error recovery
    // Recovery only starts once you actually stop firing (never between consecutive auto shots).
    if (this.sinceShot > Math.max(w.recoil.recoveryDelay, (1 / w.fireRate) * 1.15) && this.burstQueue === 0) {
      this.recoilIndex = Math.max(0, this.recoilIndex - w.recoil.recoveryRate * dt);
      this.firingError = Math.max(0, this.firingError - w.spread.firingMax * 4 * dt);
    }

    // reload progression
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloadTimer = 0;
        const s = this.slot;
        const need = s.cfg.magazine - s.ammo;
        const take = this.infiniteAmmo ? need : Math.min(need, s.reserve);
        s.ammo += take;
        if (!this.infiniteAmmo) s.reserve -= take;
        this.events.onReloadEnd?.(s.cfg);
      }
    }

    if (input && player.alive) {
      if (input.consume('primary')) this.switchTo(0);
      if (input.consume('secondary')) this.switchTo(1);
      if (input.consume('swap')) this.switchTo(this.current === 0 ? 1 : 0);
      if (input.consume('reload')) this.startReload();
      const ready = this.reloadTimer <= 0 && this.equipTimer <= 0;
      if (w.altFire === 'ads' && w.ads.scope) {
        // scope: each right click goes one step on (not scoped → zoom → second zoom → not scoped)
        const click = input.consume('alt');
        // while the bolt is worked the scope is down and comes back by itself
        const bolting = !!w.boltAction && this.cooldown > RESCOPE_LEAD;
        if (click && ready) {
          // a click while the scope is down for the bolt calls the return off
          if (bolting && this.scopeLevel > 0) this.scopeLevel = 0;
          else this.scopeLevel = (this.scopeLevel + 1) % (w.ads.zoom2 ? 3 : 2);
        }
        this.adsHeld = this.scopeLevel > 0 && ready && !bolting;
      } else {
        this.adsHeld = w.altFire === 'ads' && input.isDown('alt') && ready;
      }
      if (w.altFire === 'burst' && input.consume('alt')) this.tryBurst();
    } else {
      this.adsHeld = false;
      this.scopeLevel = 0;
    }
    if (w.ads.scope) {
      const target = this.scopeLevel === 2 ? (w.ads.zoom2 ?? w.ads.zoom) : w.ads.zoom;
      // coming up from the hip the scope opens at its level; between levels it glides
      if (this.ads < 0.02) this.scopeZoom = target;
      else if (this.scopeLevel > 0) this.scopeZoom += (target - this.scopeZoom) * (1 - Math.exp(-dt * 16));
    }

    // ADS blend
    const adsTarget = this.adsHeld ? 1 : 0;
    const adsRate = dt / Math.max(0.05, w.ads.transitionTime);
    this.ads += Math.max(-adsRate, Math.min(adsRate, adsTarget - this.ads));
    player.speedMult = w.runSpeedMult * (this.ads > 0.5 && w.altFire === 'ads' ? w.ads.moveSpeedMult : 1);

    const sp = this.spread(player);
    this.lastMovementError = sp.movement;
    this.lastFiringError = sp.firing;

    // burst queue (Classic right click)
    if (this.burstQueue > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.fireOne(player, w.burst?.spread ?? 0);
        this.burstQueue--;
        this.burstTimer = w.burst?.interval ?? 0.06;
        if (this.burstQueue === 0) this.burstCooldown = w.burst?.cooldown ?? 0.4;
      }
      return;
    }

    // auto-reload once the magazine is empty
    if (this.slot.ammo === 0 && this.reloadTimer <= 0 && this.cooldown <= 0 && this.equipTimer <= 0) this.startReload();

    if (!input || !player.alive) {
      this.cooldown = Math.max(0, this.cooldown);
      return;
    }
    const wantsFire = w.auto ? input.isDown('fire') : input.consume('fire');
    if (!w.auto && !wantsFire) return;
    if (wantsFire && this.cooldown <= 0 && this.equipTimer <= 0 && this.reloadTimer <= 0 && this.burstCooldown <= 0) {
      if (this.slot.ammo <= 0) {
        this.events.onDryFire?.(w);
        this.cooldown = 0.25;
        this.startReload();
        return;
      }
      const rate = w.fireRate * (this.isAds ? w.ads.fireRateMult : 1);
      const interval = 1 / rate;
      this.fireOne(player, 0);
      // carry sub-frame remainder so the fire rate does not depend on frame rate (never more than this
      // step's worth: a gun that has been ready for a while starts a full interval)
      this.cooldown = Math.max(this.cooldown, -Math.min(dt, interval * 0.5)) + interval;
      // bolt action: nothing to chamber after the last round, so the reload follows the shot
      if (w.boltAction && this.slot.ammo === 0) this.cooldown = LAST_ROUND_DELAY;
    } else if (!wantsFire) {
      this.cooldown = Math.max(0, this.cooldown);
    }
  }

  private tryBurst() {
    const w = this.weapon;
    if (!w.burst || this.burstQueue > 0 || this.burstCooldown > 0 || this.reloadTimer > 0 || this.equipTimer > 0) return;
    if (this.slot.ammo <= 0) {
      this.events.onDryFire?.(w);
      this.startReload();
      return;
    }
    this.burstQueue = Math.min(w.burst.count, this.slot.ammo);
    this.burstTimer = 0;
  }

  /** Current recoil offset (degrees) used for the camera punch. */
  viewPunch(): [number, number] {
    const w = this.weapon;
    const [ry, rp] = recoilAt(w, this.recoilIndex);
    const k = w.recoil.viewKick * (this.isAds ? w.recoil.adsMult : 1);
    return [ry * k, rp * k];
  }

  private fireOne(player: PlayerController, extraSpread: number) {
    const w = this.weapon;
    const s = this.slot;
    if (s.ammo <= 0) return;
    s.ammo--;
    const bulletIndex = Math.floor(this.recoilIndex + 1e-6);
    const firstShot = this.recoilIndex < 0.5;
    const adsK = this.isAds ? w.recoil.adsMult : 1;
    let [ry, rp] = recoilAt(w, this.recoilIndex);
    const recoil: [number, number] = [ry * adsK, rp * adsK];
    ry = ry * adsK + (this.rng() - 0.5) * 2 * w.recoil.jitter * (firstShot ? 0 : 1);
    rp = rp * adsK + (this.rng() - 0.5) * 2 * w.recoil.jitter * (firstShot ? 0 : 1);
    const sp = this.spread(player);
    const spreadDeg = sp.total + extraSpread;
    const ang = this.rng() * Math.PI * 2;
    const rad = spreadDeg * Math.sqrt(this.rng());
    const yaw = player.yaw + (ry + Math.cos(ang) * rad) * DEG;
    const pitch = player.pitch + (rp + Math.sin(ang) * rad) * DEG;
    const cp = Math.cos(pitch);
    const dir: [number, number, number] = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
    const speedFrac = player.speed / (RUN_SPEED * w.runSpeedMult);
    const shot: ShotInfo = {
      origin: player.eye(),
      dir,
      weapon: w,
      bulletIndex,
      firstShot,
      moving: speedFrac > w.spread.accurateSpeedFraction || !player.grounded,
      spreadDeg,
      aimYaw: player.yaw,
      aimPitch: player.pitch,
      recoil,
    };
    this.recoilIndex += 1;
    this.firingError = Math.min(w.spread.firingMax, this.firingError + w.spread.firingPerShot);
    this.sinceShot = 0;
    this.lastShotAge = 0;
    if (s.ammo === 0) {
      // auto-reload after the last bullet (slight delay feels better)
      this.cooldown = Math.max(this.cooldown, 0.15);
    }
    this.events.onShot?.(shot);
  }
}
