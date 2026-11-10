/**
 * Helpers shared by the grid-authored map definitions.
 */
import type { EnemySpot, MapLocation, Side, SpawnPoint } from '../../types';
import { GridSpace } from './GridMap';

export type SpotTable = Record<string, Partial<Record<Side, EnemySpot[]>>>;

export function authoring(cols: number, rows: number) {
  const S = new GridSpace(cols, rows);
  const yawTo = (fromC: number, fromR: number, toC: number, toR: number) =>
    (Math.atan2(S.x(toC) - S.x(fromC), S.z(toR) - S.z(fromR)) * 180) / Math.PI;
  const spawn = (id: string, name: string, c: number, r: number, yaw: number, y = 0): SpawnPoint => ({
    id,
    name,
    pos: [S.x(c), y, S.z(r)],
    yaw,
  });
  /** Spawn facing a target cell. */
  const spawnAt = (id: string, name: string, c: number, r: number, toC: number, toR: number, y = 0): SpawnPoint =>
    spawn(id, name, c, r, yawTo(c, r, toC, toR), y);
  const focus = (c0: number, r0: number, c1: number, r1: number) => ({
    minX: S.x(c0) - 2,
    maxX: S.x(c1) + 2,
    minZ: S.z(r1) - 2,
    maxZ: S.z(r0) + 2,
  });
  return { S, yawTo, spawn, spawnAt, focus };
}

/** Fill empty enemy-spot lists from the generated spot table. */
export function withGeneratedSpots(locations: MapLocation[], table: SpotTable): MapLocation[] {
  return locations.map((l) => ({
    ...l,
    sides: {
      attack: { ...l.sides.attack, enemySpots: l.sides.attack.enemySpots.length ? l.sides.attack.enemySpots : (table[l.id]?.attack ?? []) },
      defend: { ...l.sides.defend, enemySpots: l.sides.defend.enemySpots.length ? l.sides.defend.enemySpots : (table[l.id]?.defend ?? []) },
    },
  }));
}

export interface LocationDraft {
  id: string;
  name: string;
  description: string;
  focus: MapLocation['focus'];
  attack: SpawnPoint[];
  defend: SpawnPoint[];
}

export function location(d: LocationDraft): MapLocation {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    focus: d.focus,
    sides: { attack: { playerSpawns: d.attack, enemySpots: [] }, defend: { playerSpawns: d.defend, enemySpots: [] } },
  };
}
