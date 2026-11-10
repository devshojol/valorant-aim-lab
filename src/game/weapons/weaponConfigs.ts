import type { Vec2, WeaponConfig, WeaponId } from '../../types';

/*
 * Weapon tuning approximates the public behaviour of the referenced tactical-shooter weapons
 * (fire rate, magazine, damage by range, first-shot accuracy). Recoil patterns are original
 * hand-authored curves that reproduce the *feel* of each gun: Vandal climbs hard then sways,
 * Phantom climbs gentler with a wider late sway, pistols kick per tap.
 */

const VANDAL_PATTERN: Vec2[] = [
  [0, 0],
  [0.02, 0.28],
  [-0.04, 0.72],
  [0.05, 1.35],
  [-0.06, 2.05],
  [0.08, 2.78],
  [0.04, 3.42],
  [-0.12, 3.98],
  [-0.4, 4.42],
  [-0.78, 4.76],
  [-1.15, 5.0],
  [-1.42, 5.16],
  [-1.55, 5.27],
  [-1.42, 5.35],
  [-1.05, 5.4],
  [-0.55, 5.44],
  [0.02, 5.47],
  [0.55, 5.5],
  [1.0, 5.52],
  [1.32, 5.54],
  [1.46, 5.55],
  [1.32, 5.56],
  [0.92, 5.57],
  [0.4, 5.58],
  [-0.12, 5.58],
];

const PHANTOM_PATTERN: Vec2[] = [
  [0, 0],
  [-0.02, 0.2],
  [0.03, 0.52],
  [-0.05, 0.98],
  [0.06, 1.52],
  [0.12, 2.06],
  [0.22, 2.56],
  [0.35, 2.98],
  [0.52, 3.32],
  [0.74, 3.58],
  [0.98, 3.77],
  [1.16, 3.9],
  [1.24, 3.99],
  [1.1, 4.05],
  [0.76, 4.1],
  [0.3, 4.13],
  [-0.22, 4.16],
  [-0.7, 4.18],
  [-1.08, 4.2],
  [-1.28, 4.21],
  [-1.24, 4.22],
  [-0.98, 4.23],
  [-0.56, 4.24],
  [-0.08, 4.24],
  [0.4, 4.25],
  [0.8, 4.25],
  [1.04, 4.26],
  [1.06, 4.26],
  [0.86, 4.27],
  [0.5, 4.27],
];

const SHERIFF_PATTERN: Vec2[] = [
  [0, 0],
  [0.12, 1.7],
  [-0.1, 3.1],
  [0.2, 4.3],
  [-0.15, 5.2],
  [0.1, 5.9],
];

const CLASSIC_PATTERN: Vec2[] = [
  [0, 0],
  [0.05, 0.55],
  [-0.08, 1.1],
  [0.12, 1.62],
  [-0.1, 2.08],
  [0.15, 2.46],
  [-0.12, 2.76],
  [0.1, 2.98],
  [-0.08, 3.14],
  [0.06, 3.26],
  [-0.05, 3.34],
  [0.04, 3.4],
];

export const WEAPONS: Record<WeaponId, WeaponConfig> = {
  vandal: {
    id: 'vandal',
    name: 'Vandal',
    slot: 'primary',
    category: 'Rifle',
    description: 'One-tap headshot at any range. Hard vertical climb from bullet 4, then a left-right sway.',
    fireRate: 9.75,
    auto: true,
    magazine: 25,
    reserve: 75,
    reloadTime: 2.5,
    equipTime: 1.0,
    damage: [{ maxRange: 999, head: 160, body: 40, legs: 34 }],
    spread: {
      base: 0.25,
      ads: 0.157,
      firingPerShot: 0.11,
      firingMax: 1.25,
      moveMax: 6.0,
      accurateSpeedFraction: 0.27,
      air: 10,
      crouchMult: 0.85,
    },
    recoil: {
      pattern: VANDAL_PATTERN,
      loopFrom: 12,
      jitter: 0.06,
      viewKick: 0.33,
      recoveryRate: 22,
      recoveryDelay: 0.09,
      adsMult: 0.85,
    },
    altFire: 'ads',
    ads: { zoom: 1.25, moveSpeedMult: 0.76, fireRateMult: 0.9, transitionTime: 0.16 },
    runSpeedMult: 1,
    tracer: true,
    sound: 'rifle-heavy',
    color: '#e0a35a',
  },
  phantom: {
    id: 'phantom',
    name: 'Phantom',
    slot: 'primary',
    category: 'Rifle',
    description: 'Suppressed, faster fire and tighter early spray. Damage falls off past 15 m and 30 m.',
    fireRate: 11,
    auto: true,
    magazine: 30,
    reserve: 60,
    reloadTime: 2.5,
    equipTime: 1.0,
    damage: [
      { maxRange: 15, head: 156, body: 39, legs: 33 },
      { maxRange: 30, head: 140, body: 35, legs: 29 },
      { maxRange: 999, head: 124, body: 31, legs: 26 },
    ],
    spread: {
      base: 0.2,
      ads: 0.11,
      firingPerShot: 0.1,
      firingMax: 1.1,
      moveMax: 6.0,
      accurateSpeedFraction: 0.27,
      air: 10,
      crouchMult: 0.85,
    },
    recoil: {
      pattern: PHANTOM_PATTERN,
      loopFrom: 13,
      jitter: 0.07,
      viewKick: 0.3,
      recoveryRate: 24,
      recoveryDelay: 0.08,
      adsMult: 0.85,
    },
    altFire: 'ads',
    ads: { zoom: 1.25, moveSpeedMult: 0.76, fireRateMult: 0.9, transitionTime: 0.16 },
    runSpeedMult: 1,
    tracer: false,
    sound: 'rifle-suppressed',
    color: '#7fb3d5',
  },
  sheriff: {
    id: 'sheriff',
    name: 'Sheriff',
    slot: 'secondary',
    category: 'Sidearm',
    description: 'Heavy revolver. One-tap head to 30 m, strong per-shot kick.',
    fireRate: 4,
    auto: false,
    magazine: 6,
    reserve: 24,
    reloadTime: 3,
    equipTime: 1.0,
    damage: [
      { maxRange: 30, head: 159, body: 55, legs: 46 },
      { maxRange: 999, head: 145, body: 50, legs: 42 },
    ],
    spread: {
      base: 0.25,
      ads: 0.15,
      firingPerShot: 0.8,
      firingMax: 3,
      moveMax: 4.5,
      accurateSpeedFraction: 0.3,
      air: 8,
      crouchMult: 0.85,
    },
    recoil: {
      pattern: SHERIFF_PATTERN,
      loopFrom: 3,
      jitter: 0.15,
      viewKick: 0.45,
      recoveryRate: 9,
      recoveryDelay: 0.12,
      adsMult: 0.85,
    },
    altFire: 'ads',
    ads: { zoom: 1.25, moveSpeedMult: 0.76, fireRateMult: 1, transitionTime: 0.16 },
    runSpeedMult: 1.04,
    tracer: true,
    sound: 'pistol-heavy',
    color: '#c7b089',
  },
  classic: {
    id: 'classic',
    name: 'Classic',
    slot: 'secondary',
    category: 'Sidearm',
    description: 'Free sidearm. Accurate left-click taps; right-click fires a 3-round burst.',
    fireRate: 6.75,
    auto: false,
    magazine: 12,
    reserve: 36,
    reloadTime: 1.75,
    equipTime: 0.75,
    damage: [
      { maxRange: 30, head: 78, body: 26, legs: 22 },
      { maxRange: 999, head: 66, body: 22, legs: 18 },
    ],
    spread: {
      base: 0.4,
      ads: 0.4,
      firingPerShot: 0.35,
      firingMax: 2.5,
      moveMax: 1.8,
      accurateSpeedFraction: 0.35,
      air: 6,
      crouchMult: 0.85,
    },
    recoil: {
      pattern: CLASSIC_PATTERN,
      loopFrom: 6,
      jitter: 0.1,
      viewKick: 0.35,
      recoveryRate: 14,
      recoveryDelay: 0.1,
      adsMult: 1,
    },
    altFire: 'burst',
    burst: { count: 3, interval: 0.06, spread: 2.4, cooldown: 0.45 },
    ads: { zoom: 1, moveSpeedMult: 1, fireRateMult: 1, transitionTime: 0.1 },
    runSpeedMult: 1.04,
    tracer: true,
    sound: 'pistol-light',
    color: '#9aa4ad',
  },
};

export const PRIMARY_WEAPONS: WeaponId[] = ['vandal', 'phantom'];
export const SECONDARY_WEAPONS: WeaponId[] = ['classic', 'sheriff'];

export function damageAt(cfg: WeaponConfig, distance: number) {
  for (const b of cfg.damage) if (distance <= b.maxRange) return b;
  return cfg.damage[cfg.damage.length - 1];
}

/** Recoil offset [yaw, pitch] (degrees) at a fractional recoil index. */
export function recoilAt(cfg: WeaponConfig, index: number): Vec2 {
  const p = cfg.recoil.pattern;
  const n = p.length;
  if (index <= 0) return [0, 0];
  const sample = (i: number): Vec2 => {
    if (i < n) return p[i];
    // Loop the tail of the pattern, keeping vertical height at the last value.
    const loopLen = n - cfg.recoil.loopFrom;
    const li = cfg.recoil.loopFrom + ((i - n) % loopLen);
    return [p[li][0], p[n - 1][1]];
  };
  const i0 = Math.floor(index);
  const f = index - i0;
  const a = sample(i0);
  const b = sample(i0 + 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
