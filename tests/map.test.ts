import { describe, expect, it } from 'vitest';
import { MAP_DEFINITIONS } from '../src/game/maps/registry';
import { buildMapData } from '../src/game/maps/MapData';
import { BOT_HEIGHT, BOT_RADIUS } from '../src/game/bots/perception/visibility';
import { findPath } from '../src/game/bots/navigation/GridNavigator';
import { spotUsableFrom } from '../src/game/practice/PracticeDirector';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe.each(MAP_DEFINITIONS.map((d) => [d.id, d] as const))('map %s', (_id, def) => {
  const data = buildMapData(def);

  it('has a closed border, palette zones and sane collider count', () => {
    const g = def.grid;
    expect(g.length).toBeGreaterThan(10);
    for (let c = 0; c < g[0].length; c++) {
      expect(g[0][c]).toBe('#');
      expect(g[g.length - 1][c]).toBe('#');
    }
    for (const row of g) {
      expect(row[0]).toBe('#');
      expect(row[row.length - 1]).toBe('#');
    }
    expect(data.boxes.length).toBeGreaterThan(20);
    expect(data.boxes.length).toBeLessThan(500);
    for (const b of data.boxes) expect(def.palette.zones[b.zone], `zone ${b.zone} missing from palette`).toBeTruthy();
    if (env.PRINT_MAP) console.log(`\n${def.id}\n` + g.map((r, i) => String(i).padStart(2) + ' ' + r).join('\n'));
  });

  it('places every player spawn in free space', () => {
    for (const loc of def.locations)
      for (const side of ['attack', 'defend'] as const)
        for (const sp of loc.sides[side].playerSpawns) {
          const hit = data.world.overlap(sp.pos[0], sp.pos[1] + 0.05, sp.pos[2], 0.3, 1.8);
          expect(hit, `${loc.id}/${side}/${sp.id} overlaps geometry`).toBeNull();
          // standing on something
          expect(data.world.groundBelow(sp.pos[0], sp.pos[1] + 0.01, sp.pos[2], 0.3, 0.05), `${loc.id}/${side}/${sp.id} floating`).not.toBeNull();
        }
  });

  it('gives every player spawn at least 3 peekable enemy positions, none on top of the spawn', () => {
    const problems: string[] = [];
    for (const loc of def.locations)
      for (const side of ['attack', 'defend'] as const) {
        const setup = loc.sides[side];
        for (const s of setup.enemySpots) {
          if (data.world.overlap(s.cover[0], s.cover[1] + 0.05, s.cover[2], BOT_RADIUS, BOT_HEIGHT)) problems.push(`${loc.id}/${side}/${s.id} anchor inside geometry`);
        }
        for (const sp of setup.playerSpawns) {
          // same rule the game uses: visible peek, and the peek line at least MIN_SPOT_DISTANCE away
          const ok = setup.enemySpots.filter((s) => spotUsableFrom(data.world, sp, s));
          if (ok.length < 3) problems.push(`${loc.id}/${side}/${sp.id}: only ${ok.length} usable spots`);
        }
      }
    expect(problems).toEqual([]);
  });

  it('connects every callout by navigation (deathmatch)', () => {
    const { nav, space } = data;
    const from = def.callouts.find((c) => c.name === 'Attacker Spawn')!;
    for (const c of def.callouts) {
      const path = findPath(nav, space, space.x(from.c), space.z(from.r), space.x(c.c), space.z(c.r));
      expect(path, `no path to ${c.name}`).not.toBeNull();
    }
  });
});
