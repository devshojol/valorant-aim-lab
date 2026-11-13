import { describe, expect, it } from 'vitest';
import { CollisionWorld, COL_ALL, rayHumanoid, humanoidHitboxes } from '../src/game/physics/CollisionWorld';
import { WEAPONS, damageAt, recoilAt } from '../src/game/weapons/weaponConfigs';
import { WeaponSystem } from '../src/game/weapons/WeaponSystem';
import { PlayerController, RUN_SPEED } from '../src/game/player/PlayerController';
import { cmPer360, edpi, DEFAULT_SETTINGS, DEFAULT_CROSSHAIR } from '../src/settings/defaults';
import { exportCrosshairCode, importCrosshairCode } from '../src/game/hud/crosshairRenderer';
import type { Input, Action } from '../src/game/core/Input';

function world() {
  const w = new CollisionWorld();
  // floor
  w.add({ minX: -50, minY: -1, minZ: -50, maxX: 50, maxY: 0, maxZ: 50, flags: COL_ALL, surface: 'ground' });
  // wall at x = 5
  w.add({ minX: 5, minY: 0, minZ: -50, maxX: 6, maxY: 6, maxZ: 50, flags: COL_ALL, surface: 'wall' });
  // step 0.4 and ledge 0.6 along -x
  w.add({ minX: -4, minY: 0, minZ: -1, maxX: -2, maxY: 0.4, maxZ: 1, flags: COL_ALL, surface: 'step' });
  w.add({ minX: -4, minY: 0, minZ: 4, maxX: -2, maxY: 0.6, maxZ: 6, flags: COL_ALL, surface: 'ledge' });
  return w;
}

class FakeInput {
  held = new Set<Action>();
  pressed = new Set<Action>();
  isDown(a: Action) {
    return this.held.has(a);
  }
  consume(a: Action) {
    const v = this.pressed.has(a);
    this.pressed.delete(a);
    return v;
  }
}

describe('collision world', () => {
  it('raycasts return distance and face normal', () => {
    const w = world();
    const hit = w.raycast(0, 1, 0, 1, 0, 0, 100);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(5, 5);
    expect(hit!.nx).toBe(-1);
    expect(w.segmentClear(0, 1, 0, 4.9, 1, 0)).toBe(true);
    expect(w.segmentClear(0, 1, 0, 7, 1, 0)).toBe(false);
  });

  it('blocks movement at walls, steps up 0.4 m but not 0.6 m', () => {
    const w = world();
    const b = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 100; i++) w.moveBody(b, 0.3, 1.8, 0.1, 0, 0, 0.45, true);
    expect(b.x).toBeCloseTo(5 - 0.3, 2);
    const s = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 30; i++) w.moveBody(s, 0.3, 1.8, -0.1, -0.01, 0, 0.45, true);
    expect(s.y).toBeCloseTo(0.4, 3);
    const l = { x: 0, y: 0, z: 5 };
    for (let i = 0; i < 30; i++) w.moveBody(l, 0.3, 1.8, -0.1, -0.01, 0, 0.45, true);
    expect(l.y).toBeCloseTo(0, 3);
    expect(l.x).toBeCloseTo(-2 + 0.3, 2);
  });
});

describe('hitboxes', () => {
  it('detects head vs body vs legs', () => {
    const hb = humanoidHitboxes(0);
    const head = rayHumanoid(0, hb.head.cy, -10, 0, 0, 1, 0, 0, 0, 0, 0, 100);
    const body = rayHumanoid(0, hb.body.cy, -10, 0, 0, 1, 0, 0, 0, 0, 0, 100);
    const legs = rayHumanoid(0, 0.4, -10, 0, 0, 1, 0, 0, 0, 0, 0, 100);
    expect(head?.zone).toBe('head');
    expect(body?.zone).toBe('body');
    expect(legs?.zone).toBe('legs');
    // crouching lowers the head: a standing-head-height ray now misses
    expect(rayHumanoid(0, hb.head.cy, -10, 0, 0, 1, 0, 0, 0, 0, 1, 100)).toBeNull();
  });
});

describe('weapons', () => {
  it('each rifle has its own recoil pattern and damage model', () => {
    expect(recoilAt(WEAPONS.vandal, 0)).toEqual([0, 0]);
    const v10 = recoilAt(WEAPONS.vandal, 10);
    const p10 = recoilAt(WEAPONS.phantom, 10);
    expect(v10[1]).toBeGreaterThan(p10[1]);
    expect(v10[0]).not.toBeCloseTo(p10[0], 1);
    expect(damageAt(WEAPONS.vandal, 45).head).toBe(160);
    expect(damageAt(WEAPONS.phantom, 10).head).toBe(156);
    expect(damageAt(WEAPONS.phantom, 40).head).toBe(124);
  });

  it('fires at the configured rate independent of simulation step', () => {
    for (const step of [1 / 120, 1 / 45]) {
      const ws = new WeaponSystem('vandal', 'classic');
      ws.equipTimer = 0;
      ws.rng = () => 0.5;
      const p = new PlayerController(world());
      p.spawn(0, 0, 0, 0);
      const inp = new FakeInput();
      inp.held.add('fire');
      let shots = 0;
      ws.events.onShot = () => shots++;
      for (let t = 0; t < 1; t += step) ws.update(step, inp as unknown as Input, p);
      expect(shots).toBeGreaterThanOrEqual(9);
      expect(shots).toBeLessThanOrEqual(11);
    }
  });

  it('first bullet is accurate, spray climbs, recoil recovers', () => {
    const ws = new WeaponSystem('vandal', 'classic');
    ws.equipTimer = 0;
    ws.rng = () => 0.5;
    const p = new PlayerController(world());
    p.spawn(0, 0, 0, 0);
    const inp = new FakeInput();
    const dirs: number[][] = [];
    ws.events.onShot = (s) => dirs.push(s.dir);
    inp.held.add('fire');
    for (let i = 0; i < 120; i++) ws.update(1 / 120, inp as unknown as Input, p);
    inp.held.delete('fire');
    expect(dirs[0][1]).toBeCloseTo(0, 3); // first shot straight (rng 0.5 = centre)
    expect(dirs[dirs.length - 1][1]).toBeGreaterThan(0.05); // climbed
    for (let i = 0; i < 120; i++) ws.update(1 / 120, inp as unknown as Input, p);
    expect(ws.recoilIndex).toBe(0);
  });

  it('running destroys accuracy, counter-strafing restores it quickly', () => {
    const p = new PlayerController(world());
    p.spawn(0, 0, -20, 90);
    const inp = new FakeInput();
    inp.held.add('right');
    for (let i = 0; i < 60; i++) p.update(1 / 120, inp as unknown as Input);
    expect(p.speed).toBeCloseTo(RUN_SPEED, 1);
    const ws = new WeaponSystem('vandal', 'classic');
    expect(ws.spread(p).movement).toBeGreaterThan(5);
    inp.held.delete('right');
    inp.held.add('left');
    let t = 0;
    while (p.speed > RUN_SPEED * WEAPONS.vandal.spread.accurateSpeedFraction && t < 1) {
      p.update(1 / 120, inp as unknown as Input);
      t += 1 / 120;
    }
    expect(t).toBeLessThan(0.08);
    expect(ws.spread(p).movement).toBeLessThan(0.05);
  });
});

describe('sensitivity', () => {
  it('computes eDPI and cm/360 on the 0.07°/count scale', () => {
    expect(edpi(800, 0.4)).toBe(320);
    expect(cmPer360(800, 0.4)).toBeCloseTo(40.82, 1);
  });

  it('applies sensitivity to camera rotation', () => {
    const p = new PlayerController(world());
    p.spawn(0, 0, 0, 0);
    p.applyLook(1000, 0, { ...DEFAULT_SETTINGS.sensitivity, sensitivity: 0.5 }, false);
    expect((p.yaw * 180) / Math.PI).toBeCloseTo(35, 5);
    p.applyLook(0, 100, { ...DEFAULT_SETTINGS.sensitivity, sensitivity: 0.5, verticalMult: 2 }, false);
    expect((p.pitch * 180) / Math.PI).toBeCloseTo(-7, 5);
  });
});

describe('crosshair codes', () => {
  it('round-trips through export/import', () => {
    const custom = { ...DEFAULT_CROSSHAIR, color: '#ff00aa', centerDot: true, inner: { ...DEFAULT_CROSSHAIR.inner, length: 9 } };
    const code = exportCrosshairCode(custom);
    expect(code.startsWith('TAL1-')).toBe(true);
    expect(importCrosshairCode(code)).toEqual(custom);
    expect(importCrosshairCode('garbage')).toBeNull();
  });
});

describe('spray trainer', () => {
  // Fire a full Vandal magazine; `control` (0..1) is how much of the recoil the aim cancels.
  async function spray(control: number) {
    const { SprayTrainer } = await import('../src/game/practice/SprayTrainer');
    const w = world();
    const player = new PlayerController(w);
    player.spawn(0, 0, 0, 90);
    const ws = new WeaponSystem('vandal', 'classic');
    ws.equipTimer = 0;
    ws.rng = () => 0.5; // no jitter; spread radius is constant
    const trainer = new SprayTrainer();
    const results: import('../src/types').SprayResult[] = [];
    let time = 0;
    const yaw0 = player.yaw;
    const pitch0 = player.pitch;
    ws.events.onShot = (s) => {
      const r = trainer.onShot(s, time);
      if (r) results.push(r);
    };
    const input = new FakeInput();
    input.held.add('fire');
    const DEG = Math.PI / 180;
    for (let i = 0; i < 400 && ws.slot.ammo > 0; i++) {
      const [ry, rp] = recoilAt(WEAPONS.vandal, ws.recoilIndex);
      player.yaw = yaw0 - ry * DEG * control;
      player.pitch = pitch0 - rp * DEG * control;
      ws.update(1 / 120, input as unknown as Input, player);
      time += 1 / 120;
    }
    const r = trainer.update(time + 1);
    if (r) results.push(r);
    return results;
  }

  it('scores an uncontrolled spray near 0 and a fully controlled one near 100', async () => {
    const none = await spray(0);
    const full = await spray(1);
    expect(none).toHaveLength(1);
    expect(none[0].bullets).toBe(25);
    expect(none[0].score).toBeLessThanOrEqual(2);
    expect(full[0].score).toBeGreaterThanOrEqual(98);
    expect(full[0].tightPct).toBe(100);
    const half = await spray(0.5);
    expect(half[0].score).toBeGreaterThan(40);
    expect(half[0].score).toBeLessThan(60);
  });

  it('ignores taps shorter than five bullets', async () => {
    const { scoreSpray } = await import('../src/game/practice/SprayTrainer');
    const pt = { bullet: [0, 0] as [number, number], control: [0, 0] as [number, number], recoil: [0, 1] as [number, number] };
    expect(scoreSpray(WEAPONS.vandal, [pt, pt, pt, pt])).toBeNull();
    expect(scoreSpray(WEAPONS.vandal, [pt, pt, pt, pt, pt])?.score).toBe(100);
  });
});

describe('weapon roster', () => {
  it('every weapon has a usable config', async () => {
    const { ALL_WEAPONS, PRIMARY_WEAPONS, SECONDARY_WEAPONS } = await import('../src/game/weapons/weaponConfigs');
    expect(ALL_WEAPONS).toHaveLength(8);
    for (const id of ALL_WEAPONS) {
      const w = WEAPONS[id];
      expect(w.id).toBe(id);
      expect(w.recoil.loopFrom).toBeLessThan(w.recoil.pattern.length);
      expect(w.damage[w.damage.length - 1].maxRange).toBeGreaterThan(100);
      expect((w.slot === 'primary' ? PRIMARY_WEAPONS : SECONDARY_WEAPONS).includes(id)).toBe(true);
      // looping past the pattern never produces NaN
      expect(recoilAt(w, w.magazine + 7.5).every(Number.isFinite)).toBe(true);
    }
  });

  it('the Operator is only accurate when scoped and kills with a body shot', () => {
    const w = world();
    const player = new PlayerController(w);
    player.spawn(0, 0, 0, 90);
    const ws = new WeaponSystem('operator', 'classic');
    ws.equipTimer = 0;
    expect(ws.spread(player).total).toBeGreaterThan(3);
    ws.ads = 1;
    expect(ws.spread(player).total).toBe(0);
    expect(damageAt(WEAPONS.operator, 40).body).toBeGreaterThanOrEqual(150);
  });

  it('the Operator scope cycles 2.5× → 5× → off, drops while the bolt is worked and comes back by itself', () => {
    const w = world();
    const player = new PlayerController(w);
    player.spawn(0, 0, 0, 90);
    const ws = new WeaponSystem('operator', 'classic');
    ws.equipTimer = 0;
    const input = new FakeInput();
    const run = (sec: number) => {
      for (let t = 0; t < sec; t += 1 / 120) ws.update(1 / 120, input as unknown as Input, player);
    };
    const click = (a: Action) => {
      input.pressed.add(a);
      run(1 / 120);
    };
    click('alt');
    run(0.5);
    expect(ws.scopeLevel).toBe(1);
    expect(ws.zoom).toBeCloseTo(2.5, 2);
    click('alt');
    run(0.5);
    expect(ws.zoom).toBeCloseTo(5, 1);
    click('alt');
    run(0.5);
    expect(ws.scopeLevel).toBe(0);
    expect(ws.zoom).toBeCloseTo(1, 2);

    // scoped shot: the scope drops for the bolt and is back up, at the same zoom, when the next shot is ready
    click('alt');
    click('alt');
    run(0.6);
    let shots = 0;
    ws.events.onShot = () => shots++;
    click('fire');
    expect(shots).toBe(1);
    run(0.6);
    expect(ws.ads).toBe(0);
    expect(ws.boltCycleAge).toBeGreaterThan(0.5);
    click('fire'); // the bolt is still being worked
    expect(shots).toBe(1);
    run(1 / 0.6 - 0.6);
    expect(ws.ads).toBe(1);
    expect(ws.zoom).toBeCloseTo(5, 1);
    expect(ws.spread(player).total).toBe(0);
    click('fire');
    expect(shots).toBe(2);

    // reloading leaves the scope for good
    ws.startReload();
    run(WEAPONS.operator.reloadTime + 0.5);
    expect(ws.scopeLevel).toBe(0);
    expect(ws.ads).toBe(0);
  });
});

describe('weapon menu swap', () => {
  it('replaces the weapon in a slot with a full magazine and re-draws it when in hand', () => {
    const ws = new WeaponSystem('vandal', 'classic');
    ws.equipTimer = 0;
    ws.slot.ammo = 3;
    ws.recoilIndex = 9;
    let equipped = '';
    ws.events.onEquip = (w) => (equipped = w.id);
    ws.setSlot(0, 'spectre');
    expect(ws.weapon.id).toBe('spectre');
    expect(ws.slot.ammo).toBe(WEAPONS.spectre.magazine);
    expect(ws.recoilIndex).toBe(0);
    expect(ws.equipTimer).toBeGreaterThan(0);
    expect(equipped).toBe('spectre');
    // the other slot changes quietly
    equipped = '';
    ws.setSlot(1, 'ghost');
    expect(ws.weapon.id).toBe('spectre');
    expect(ws.slots[1].cfg.id).toBe('ghost');
    expect(equipped).toBe('');
  });
});
