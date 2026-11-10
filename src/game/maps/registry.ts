import type { MapSummary } from '../../types';
import { ascentMap } from './ascent/ascentMap';
import { dunehold } from './bind/dunehold';
import { coralis } from './breeze/coralis';
import { sanctum } from './haven/sanctum';
import { permafrost } from './icebox/permafrost';
import { tamarind } from './lotus/tamarind';
import { kitsune } from './split/kitsune';
import { goldline } from './sunset/goldline';
import type { MapDefinition } from './MapData';

/** Every playable map, in menu order. */
export const MAP_DEFINITIONS: MapDefinition[] = [ascentMap, dunehold, sanctum, kitsune, tamarind, permafrost, coralis, goldline];

const BY_ID: Record<string, MapDefinition> = Object.fromEntries(MAP_DEFINITIONS.map((m) => [m.id, m]));

export const MAP_SUMMARIES: MapSummary[] = MAP_DEFINITIONS.map((m) => ({
  id: m.id,
  name: m.name,
  inspiredBy: m.inspiredBy,
  theme: m.theme,
  playable: true,
  locations: m.locations.map((l) => ({ id: l.id, name: l.name })),
}));

export function getMapDefinition(id: string): MapDefinition {
  return BY_ID[id] ?? ascentMap;
}

export const DEFAULT_MAP_ID = ascentMap.id;
