/**
 * "Vellora" — an original, Ascent-inspired tactical layout.
 *
 * Two bomb sites (A west, B east) joined by an open central courtyard with a market
 * building towards B and a catwalk link towards A. Attackers spawn south, defenders north.
 * All geometry here is original and authored on the shared cell grid (see CELL in GridMap.ts).
 */

import type { EnemySpot, MapLocation, SpawnPoint, Vec2 } from '../../../types';
import { CELL, GridBuilder, GridSpace } from '../GridMap';
import type { MapDefinition } from '../MapData';

const COLS = 52;
const ROWS = 48;
const S = new GridSpace(COLS, ROWS);

function buildGrid(): string[] {
  const g = new GridBuilder(COLS, ROWS, '#');

  // --- Defender spawn (north)
  g.rect(21, 1, 32, 6, '.');
  g.set(25, 3, 'c').set(30, 3, 'c');

  // --- A Heaven: raised platform overlooking A site, reached by stairs from defender spawn
  g.rect(4, 4, 15, 7, '6');
  g.set(16, 5, '5').set(16, 6, '5');
  g.set(17, 5, '4').set(17, 6, '4');
  g.set(18, 5, '3').set(18, 6, '3');
  g.set(19, 5, '2').set(19, 6, '2');
  g.set(20, 5, '1').set(20, 6, '1');
  g.set(9, 6, 'P').set(5, 6, 'P');
  // Heaven parapet with a drop-down gap on the east end
  g.rect(4, 8, 13, 8, 'r');
  g.rect(14, 8, 15, 8, '6');

  // --- A Site
  g.rect(2, 9, 15, 21, '.');
  g.set(8, 15, 'C').set(9, 15, 'c'); // Default box
  g.set(12, 11, 'D').set(13, 11, 'D'); // Generator
  g.set(3, 18, 'C').set(3, 17, 'c'); // Tree corner
  g.set(6, 12, 'P'); // Site pillar
  g.set(11, 19, 'c'); // Exit crate

  // --- A Link (catwalk) between A site and mid courtyard
  g.rect(16, 15, 19, 17, '.');

  // --- A Main corridor (wide), narrow arch into site with corner pockets, side nook
  g.rect(4, 23, 8, 33, '.');
  g.rect(6, 22, 7, 22, '=');
  g.rect(9, 26, 10, 27, '.');
  g.set(4, 28, 'C'); // A Main cover crate

  // --- A Lobby
  g.rect(2, 34, 12, 39, '.');
  g.set(10, 36, 'C').set(4, 38, 'c').set(3, 35, 'C');
  g.rect(9, 40, 12, 40, '.');

  // --- Attacker spawn (south)
  g.rect(9, 41, 43, 46, '.');
  g.set(17, 43, 'C').set(18, 43, 'c').set(34, 44, 'C');

  // --- Mid bottom corridor
  g.rect(24, 29, 27, 40, '.');

  // --- Mid courtyard
  g.rect(20, 15, 31, 28, '.');
  g.set(25, 21, 'C').set(26, 21, 'c'); // Mid box
  g.set(22, 18, 'P'); // Courtyard column
  g.set(21, 25, 'c').set(22, 25, 'c'); // Planter
  g.set(23, 27, 'C'); // Bottom-left crate
  g.set(29, 27, 'D'); // Bottom-right stack

  // --- Mid top corridor
  g.rect(24, 7, 27, 14, '.');
  g.set(25, 10, 'C');

  // --- Market (mid -> B)
  g.rect(33, 16, 36, 22, '.');
  g.rect(32, 17, 32, 19, '.');
  g.rect(37, 19, 37, 21, '.');
  g.set(36, 16, 'C');

  // --- B Site
  g.rect(38, 9, 50, 22, '.');
  g.set(44, 14, 'C').set(45, 14, 'c'); // B default
  g.set(48, 11, 'D').set(49, 11, 'D'); // Boathouse stack
  g.set(41, 12, 'P'); // Pillar
  g.set(41, 18, 'c');
  g.set(49, 19, 'C');

  // --- B back route to defender spawn
  g.rect(33, 3, 40, 5, '.');
  g.rect(39, 6, 41, 8, '.');

  // --- B Main corridor with arch and nooks
  g.rect(44, 23, 46, 34, '.');
  g.rect(44, 23, 46, 23, '=');
  g.rect(42, 27, 43, 28, '.');
  g.rect(47, 30, 48, 31, '.');
  g.set(46, 29, 'C'); // B Main cover crate

  // --- B Lobby
  g.rect(38, 35, 49, 39, '.');
  g.set(40, 37, 'C').set(47, 38, 'c');
  g.rect(40, 40, 43, 40, '.');

  return g.toStrings();
}

function zoneOf(c: number, r: number): string {
  if (r <= 6 && c >= 16 && c <= 41) return 'defspawn';
  if (r >= 40) return 'atkspawn';
  if (c <= 16) return 'a';
  if (c >= 32) return 'b';
  return 'mid';
}

/* ----------------------------------------------------------------- */
/* Helpers to author spawns/spots in cell coordinates                 */
/* ----------------------------------------------------------------- */

const yawTo = (fromC: number, fromR: number, toC: number, toR: number) => {
  const dx = S.x(toC) - S.x(fromC);
  const dz = S.z(toR) - S.z(fromR);
  return (Math.atan2(dx, dz) * 180) / Math.PI;
};

/** Cell size these positions were authored for (metres). */
const AUTHORED_CELL = 2;

/**
 * Positions were placed by hand on 2 m cells, often hugging a wall or crate edge (e.g. r = 16.35 is
 * 0.3 m from the edge of row 16). Keep that distance to the edge in metres when CELL changes, so a
 * bot doesn't end up inside cover on smaller cells. Positions near a cell's centre stay as authored.
 */
function hug(v: number): number {
  const base = Math.round(v);
  const f = v - base;
  if (Math.abs(f) < 0.25 || (CELL as number) === AUTHORED_CELL) return v;
  const gap = (0.5 - Math.abs(f)) * AUTHORED_CELL;
  return base + Math.sign(f) * Math.max(0, 0.5 - gap / CELL);
}

function spawn(id: string, name: string, c: number, r: number, yaw: number, y = 0): SpawnPoint {
  return { id, name, pos: [S.x(hug(c)), y, S.z(hug(r))], yaw };
}

function spot(id: string, name: string, c: number, r: number, peekDir: Vec2, maxPeek = 4, y = 0): EnemySpot {
  const len = Math.hypot(peekDir[0], peekDir[1]);
  return { id, name, cover: [S.x(hug(c)), y, S.z(hug(r))], peekDir: [peekDir[0] / len, peekDir[1] / len], maxPeek };
}

const W: Vec2 = [-1, 0];
const E: Vec2 = [1, 0];

const locations: MapLocation[] = [
  {
    id: 'a-main',
    name: 'A Main',
    description: 'Narrow corridor into A site under the gaze of Heaven, Generator and Default.',
    focus: { minX: S.x(1) - 1, maxX: S.x(21) + 1, minZ: S.z(40), maxZ: S.z(3) },
    sides: {
      attack: {
        playerSpawns: [
          spawn('a-main-deep', 'A Main (deep)', 6.5, 29, 0),
          spawn('a-main-arch', 'A Main (arch)', 6.5, 24.5, 0),
        ],
        enemySpots: [
          spot('a-default', 'Default', 8, 13.85, W, 3.5),
          spot('a-generator', 'Generator', 12.5, 9.85, W, 4.5),
          spot('a-heaven', 'Heaven', 9, 4.85, E, 3.5, 2.4),
          spot('a-tree', 'Tree corner', 3, 16.35, E, 3.5),
          spot('a-pillar', 'Site pillar', 6, 10.85, E, 3),
        ],
      },
      defend: {
        playerSpawns: [
          spawn('a-default-front', 'In front of Default', 7, 16.3, yawTo(7, 16.3, 6.5, 22)),
          spawn('a-pillar-def', 'Site pillar', 6, 12.8, yawTo(6, 12.8, 6.5, 22)),
          spawn('a-heaven-def', 'Heaven', 11, 5.5, yawTo(11, 5.5, 6.5, 22), 2.4),
        ],
        enemySpots: [
          spot('a-arch-left', 'Arch left corner', 4.4, 23.4, E, 4),
          spot('a-arch-right', 'Arch right corner', 8.3, 23.4, W, 4),
          spot('a-main-nook', 'A Main nook', 9.6, 26.5, W, 6),
          spot('a-main-crate', 'A Main crate', 4, 29.15, E, 4),
        ],
      },
    },
  },
  {
    id: 'mid',
    name: 'Mid',
    description: 'Open courtyard with Mid Box, the catwalk link to A and Market doors to B.',
    focus: { minX: S.x(14) - 1, maxX: S.x(38) + 1, minZ: S.z(36), maxZ: S.z(5) },
    sides: {
      attack: {
        playerSpawns: [
          spawn('mid-bottom', 'Mid Bottom', 25.5, 31, 0),
          spawn('mid-bottom-exit', 'Mid Bottom exit', 25.5, 28.6, 0),
        ],
        enemySpots: [
          spot('mid-box', 'Mid Box', 25, 19.85, W, 3.5),
          spot('mid-market', 'Market door', 33.5, 19, W, 4),
          spot('mid-catwalk', 'Catwalk', 18.5, 16, E, 5),
          spot('mid-top-box', 'Mid Top box', 25, 8.85, E, 3),
          spot('mid-column', 'Courtyard column', 22, 16.85, W, 3),
        ],
      },
      defend: {
        playerSpawns: [
          spawn('mid-top', 'Mid Top', 25.5, 13, 180),
          spawn('mid-top-corner', 'Mid Top (corner)', 24.3, 14, 172),
        ],
        enemySpots: [
          spot('mid-crate-l', 'Bottom-left crate', 23, 28.15, E, 3.5),
          spot('mid-stack-r', 'Bottom-right stack', 29, 28.15, W, 3.5),
          spot('mid-box-s', 'Mid Box (south)', 25, 22.15, W, 3.5),
          spot('mid-market-atk', 'Market door', 33.5, 17, [-0.95, -0.32], 4.5),
        ],
      },
    },
  },
  {
    id: 'b-main',
    name: 'B Main',
    description: 'Straight B Main into a wide site: Default, Boathouse stack, pillar and Market exit.',
    focus: { minX: S.x(30) - 1, maxX: S.x(51) + 1, minZ: S.z(41), maxZ: S.z(5) },
    sides: {
      attack: {
        playerSpawns: [
          spawn('b-main-deep', 'B Main (deep)', 45, 28, 0),
          spawn('b-main-arch', 'B Main (arch)', 45, 24.6, 0),
        ],
        enemySpots: [
          spot('b-default', 'B Default', 44, 12.85, W, 3.5),
          spot('b-boathouse', 'Boathouse', 48.5, 9.85, W, 4.5),
          spot('b-pillar', 'B Pillar', 41, 10.85, E, 3),
          spot('b-back', 'Back crate', 49, 17.85, W, 3.5),
        ],
      },
      defend: {
        playerSpawns: [
          spawn('b-back-def', 'B Site back', 42, 9.6, yawTo(42, 9.6, 45, 23)),
          spawn('b-default-def', 'Behind B Default', 44.5, 15.6, 180),
        ],
        enemySpots: [
          spot('b-nook-w', 'B Main nook (west)', 42.5, 27.5, E, 5),
          spot('b-nook-e', 'B Main nook (east)', 47.75, 30.5, W, 5),
          spot('b-market-atk', 'Market exit', 35, 20, E, 6),
          spot('b-main-crate', 'B Main crate', 46, 30.15, W, 4),
        ],
      },
    },
  },
];

export const ascentMap: MapDefinition = {
  id: 'vellora',
  name: 'Vellora',
  inspiredBy: 'Ascent',
  theme: 'Sun-baked Mediterranean piazza',
  description:
    'Original two-site layout inspired by Ascent: long A Main, raised Heaven, an open mid courtyard and a market building linking mid to B.',
  grid: buildGrid(),
  zoneOf,
  callouts: [
    { name: 'A Site', c: 9, r: 13.2 },
    { name: 'A Heaven', c: 10.5, r: 5 },
    { name: 'A Main', c: 6, r: 29.5 },
    { name: 'A Lobby', c: 7, r: 37 },
    { name: 'A Link', c: 17.5, r: 16 },
    { name: 'Mid', c: 25.5, r: 23.6 },
    { name: 'Mid Top', c: 25.5, r: 12 },
    { name: 'Mid Bottom', c: 25.5, r: 35 },
    { name: 'Market', c: 34.5, r: 21 },
    { name: 'B Site', c: 44, r: 17 },
    { name: 'B Main', c: 45, r: 29 },
    { name: 'B Lobby', c: 43.5, r: 36.5 },
    { name: 'Attacker Spawn', c: 26, r: 44 },
    { name: 'Defender Spawn', c: 27, r: 2.2 },
    { name: 'B Back', c: 36.5, r: 4 },
  ],
  locations,
  palette: {
    sky: ['#9cc8ea', '#f3dcc0'],
    fog: '#d9d2c7',
    zones: {
      a: { wall: '#d9c6a5', floor: '#b7a68c', accent: '#c4573c' },
      mid: { wall: '#cf9a74', floor: '#a59e93', accent: '#3f7e8c' },
      b: { wall: '#a9b9c4', floor: '#9aa3a6', accent: '#d08a3a' },
      defspawn: { wall: '#9fb6ae', floor: '#8f9a96', accent: '#2e9c8a' },
      atkspawn: { wall: '#c7a98c', floor: '#a69481', accent: '#e05a47' },
    },
  },
  handAuthoredSpots: true,
  siteMarks: [
    { letter: 'A', c: 9.5, r: 18.5 },
    { letter: 'B', c: 41.5, r: 15.5 },
  ],
};
