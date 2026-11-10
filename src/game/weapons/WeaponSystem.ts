import type { WeaponConfig, WeaponId } from '../../types';
import type { Input } from '../core/Input';
import type { PlayerController } from '../player/PlayerController';
import { RUN_SPEED } from '../player/PlayerController';
import { WEAPONS, recoilAt } from './weaponConfigs';

const DEG = Math.PI / 180;

export interface ShotInfo {
  origin: [number, number, number];
  dir: [number, number, number];
  weapon: WeaponConfig;
  bulletIndex: number;
  firstShot: boolean;
  moving: boolean;
  spreadDeg: number;
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
   * Progress of the reload *animation* (0 → 1). The animation (and its sound cues) runs faster than
   * the reload itself — over 55% of the reload time, at most 1.3 s — then the gun waits, ready,
   * until the reload completes. 1 when not reloading.
   */
  get reloadAnimProgress() {
    if (this.reloadTimer <= 0) return 1;
    const elapsed = this.weapon.reloadTime - this.reloadTimer;
    return Math.min(1, elapsed / Math.min(1.3, this.weapon.reloadTime * 0.55));
  }
  get equipProgress() {
    return this.equipTimer > 0 ? 1 - this.equipTimer / this.weapon.equipTime : 1;
  }
  get isAds() {
    return this.ads > 0.5 && this.weapon.altFire === 'ads';
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

  switchTo(index: number) {
    if (index === this.current || !this.slots[index]) return;
    this.current = index;
    this.reloadTimer = 0;
    this.burstQueue = 0;
    this.adsHeld = false;
    this.ads = 0;
    this.recoilIndex = 0;
    this.firingError = 0;
    this.equipTimer = this.weapon.equipTime;
    this.events.onEquip?.(this.weapon);
  }

  startReload() {
    const s = this.slot;
    if (this.reloadTimer > 0 || s.ammo >= s.cfg.magazine) return;
    if (!this.infiniteAmmo && s.reserve <= 0) return;
    this.reloadTimer = s.cfg.reloadTime;
    this.adsHeld = false;
    this.burstQueue = 0;
    this.events.onReloadStart?.(s.cfg);
  }

  /** Spread components in degrees for the current state. */
  spread(player: PlayerController): { total: number; movement: number; firing: number; base: number } {
    const w = this.weapon;
    let base = this.isAds ? w.spread.ads : w.spread.base;
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
      if (input.consume('reload')) this.startReload();
      this.adsHeld = w.altFire === 'ads' && input.isDown('alt') && this.reloadTimer <= 0 && this.equipTimer <= 0;
      if (w.altFire === 'burst' && input.consume('alt')) this.tryBurst();
    } else {
      this.adsHeld = false;
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
      // carry sub-frame remainder so the fire rate does not depend on frame rate
      this.cooldown = Math.max(this.cooldown, -interval * 0.5) + interval;
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
