/**
 * Spot generator. Run after changing map geometry or spawns:
 *   GEN_SPOTS=1 npx vitest run tests/tools/gen-spots.test.ts
 * Writes src/game/maps/generated/<mapId>.json for every map without hand-authored spots.
 */
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAP_DEFINITIONS } from '../../src/game/maps/registry';
import { buildMapData } from '../../src/game/maps/MapData';
import { pickSpots } from '../../src/game/maps/spotFinder';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

it.skipIf(!env.GEN_SPOTS)('generates enemy peek spots', () => {
  for (const def of MAP_DEFINITIONS) {
    if (def.handAuthoredSpots) continue;
    if (env.GEN_MAP && env.GEN_MAP !== def.id) continue;
    const data = buildMapData(def);
    const table: Record<string, Record<string, unknown>> = {};
    for (const loc of def.locations) {
      table[loc.id] = {};
      for (const side of ['attack', 'defend'] as const) {
        const t0 = Date.now();
        const spots = pickSpots(data, loc.sides[side].playerSpawns, `${loc.id}-${side[0]}`);
        table[loc.id][side] = spots;
        console.log(`${def.id}/${loc.id}/${side}: ${spots.length} spots (${Date.now() - t0} ms) — ${spots.map((s) => s.name).join(', ')}`);
      }
    }
    fs.writeFileSync(path.join('src/game/maps/generated', `${def.id}.json`), JSON.stringify(table, null, 1) + '\n');
  }
}, 600_000);
