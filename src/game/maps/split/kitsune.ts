/**
 * "Kitsune" — an original, Split-inspired vertical city.
 * Raised A site reached by ramps from A Main with an A Heaven overlook, a raised Mid Top
 * reached by stairs from Mid Bottom (with Vents to A and Mail to B), and a low B site
 * overlooked by B Heaven.
 */
import { GridBuilder } from '../GridMap';
import type { MapDefinition } from '../MapData';
import { authoring, location, withGeneratedSpots, type SpotTable } from '../authoring';
import spots from '../generated/kitsune.json';

const COLS = 52;
const ROWS = 48;
const { spawn, spawnAt, focus } = authoring(COLS, ROWS);

function grid(): string[] {
  const g = new GridBuilder(COLS, ROWS, '#');
  // defender spawn
  g.rect(19, 1, 32, 4, '.');
  g.set(25, 2, 'c');

  // A Heaven (2.4 m) with stairs from spawn, parapet with a drop gap
  g.rect(3, 3, 13, 5, '6');
  for (const [c, h] of [
    [14, '5'],
    [15, '4'],
    [16, '3'],
    [17, '2'],
    [18, '1'],
  ] as const)
    g.rect(c, 3, c, 4, h);
  g.set(7, 4, 'P');
  g.rect(3, 6, 11, 6, 'r');
  g.rect(12, 6, 13, 6, '6');

  // A site raised to 0.8 m, ramp from A Main
  g.rect(2, 7, 14, 17, '2');
  g.set(6, 10, 'D').set(7, 10, 'D');
  g.set(12, 9, 'D');
  g.set(11, 13, 'P');
  g.set(4, 15, 'D');
  g.rect(4, 18, 8, 18, '1');
  g.rect(4, 19, 8, 33, '.');
  g.set(8, 26, 'C');
  g.rect(2, 34, 12, 39, '.');
  g.set(9, 36, 'C');
  g.rect(10, 40, 12, 40, '.');

  // Vents: A site ↔ Mid Top (both 0.8 m)
  g.rect(15, 11, 18, 12, '2');

  // Mid Top (0.8 m) with stairs down to Mid Bottom
  g.rect(19, 13, 32, 25, '2');
  g.set(21, 16, 'P');
  g.rect(26, 18, 27, 18, 'D');
  g.set(30, 21, 'D');
  g.set(20, 22, 'D');
  g.rect(23, 26, 28, 26, '1');
  g.rect(23, 27, 28, 40, '.');
  g.set(24, 34, 'c');
  // Mid Top ↔ spawn
  g.rect(24, 5, 27, 12, '2');
  g.rect(24, 5, 27, 5, '1');

  // Mail: Mid Top → B site (steps down)
  g.rect(33, 13, 33, 15, '2');
  g.rect(34, 13, 34, 15, '1');
  g.rect(35, 13, 35, 15, '.');

  // B Heaven (2.4 m) with stairs from spawn
  g.rect(38, 3, 48, 5, '6');
  for (const [c, h] of [
    [33, '1'],
    [34, '2'],
    [35, '3'],
    [36, '4'],
    [37, '5'],
  ] as const)
    g.rect(c, 3, c, 4, h);
  g.set(44, 4, 'P');
  g.rect(40, 6, 48, 6, 'r');
  g.rect(38, 6, 39, 6, '6');

  // B site (ground)
  g.rect(36, 7, 49, 17, '.');
  g.set(40, 10, 'D').set(41, 10, 'D');
  g.set(45, 13, 'C');
  g.set(38, 14, 'P');
  g.set(47, 9, 'C');
  g.set(43, 16, 'c');
  // B Main, B Lobby
  g.rect(43, 18, 47, 33, '.');
  g.set(47, 27, 'C');
  g.rect(37, 34, 49, 39, '.');
  g.set(42, 36, 'C');
  g.rect(38, 40, 41, 40, '.');

  // attacker spawn
  g.rect(10, 41, 41, 46, '.');
  g.set(18, 43, 'C').set(33, 44, 'C');
  return g.toStrings();
}

function zoneOf(c: number, r: number) {
  if (r >= 40) return 'atkspawn';
  if (r <= 4 && c >= 18 && c <= 33) return 'defspawn';
  if (c <= 14) return 'a';
  if (c >= 36) return 'b';
  return 'mid';
}

const locations = withGeneratedSpots(
  [
    location({
      id: 'a-main',
      name: 'A Main',
      description: 'Push up the A ramps onto a raised site watched from A Heaven.',
      focus: focus(1, 2, 19, 34),
      attack: [spawn('a-main-mid', 'A Main', 6, 25, 0), spawn('a-ramp', 'A Ramp', 6, 20.5, 0)],
      defend: [spawnAt('a-site', 'A site', 10, 11, 6, 19, 0.8), spawnAt('a-site-left', 'A left', 3, 12, 6, 19, 0.8)],
    }),
    location({
      id: 'mid',
      name: 'Mid',
      description: 'Take Mid Top from below: stairs, a column and the mail-room stacks.',
      focus: focus(14, 4, 37, 41),
      attack: [spawn('mid-bottom', 'Mid Bottom', 25.5, 32, 0), spawn('mid-stairs', 'Mid stairs', 25.5, 28.5, 0)],
      defend: [spawn('mid-top', 'Mid Top', 25.5, 15, 180, 0.8), spawnAt('mid-top-left', 'Mid Top (left)', 23, 14, 25.5, 27, 0.8)],
    }),
    location({
      id: 'b-main',
      name: 'B Main',
      description: 'B Main into a low site under B Heaven — watch the heaven parapet and the stacks.',
      focus: focus(31, 2, 50, 35),
      attack: [spawn('b-main-mid', 'B Main', 45, 25, 0), spawn('b-main-exit', 'B Main exit', 45, 20.5, 0)],
      defend: [spawnAt('b-site', 'B site', 42, 12, 45, 19), spawnAt('b-site-left', 'B left', 37, 9, 45, 19)],
    }),
  ],
  spots as unknown as SpotTable,
);

export const kitsune: MapDefinition = {
  id: 'kitsune',
  name: 'Kitsune',
  inspiredBy: 'Split',
  theme: 'Vertical neon city',
  description:
    'Original Split-inspired vertical layout: A ramps up to a raised site under A Heaven, a raised Mid Top reached by stairs with Vents and Mail side routes, and B Heaven over B site.',
  grid: grid(),
  zoneOf,
  callouts: [
    { name: 'A Site', c: 8, r: 13 },
    { name: 'A Heaven', c: 9, r: 4 },
    { name: 'A Ramps', c: 6, r: 19 },
    { name: 'A Main', c: 6, r: 28 },
    { name: 'A Lobby', c: 6, r: 37 },
    { name: 'Vents', c: 16.5, r: 11.5 },
    { name: 'Mid Top', c: 25.5, r: 20 },
    { name: 'Mid Bottom', c: 25.5, r: 33 },
    { name: 'Mail', c: 34, r: 14 },
    { name: 'B Heaven', c: 43, r: 4 },
    { name: 'B Site', c: 43, r: 12 },
    { name: 'B Main', c: 45, r: 28 },
    { name: 'B Lobby', c: 43, r: 37 },
    { name: 'Defender Spawn', c: 25.5, r: 2.5 },
    { name: 'Attacker Spawn', c: 26, r: 44 },
  ],
  locations,
  palette: {
    sky: ['#7fa9d6', '#d9e4ec'],
    fog: '#cfd8e0',
    zones: {
      a: { wall: '#c9cfd6', floor: '#8e969f', accent: '#e0457b' },
      b: { wall: '#b8c4c9', floor: '#88949a', accent: '#2bb3a3' },
      mid: { wall: '#d4c7b8', floor: '#958a80', accent: '#f0a33c' },
      defspawn: { wall: '#aeb8c2', floor: '#848d96', accent: '#2e9c8a' },
      atkspawn: { wall: '#c4b5a8', floor: '#90857c', accent: '#e05a47' },
    },
  },
  siteMarks: [
    { letter: 'A', c: 4, r: 8.5 },
    { letter: 'B', c: 40, r: 15 },
  ],
};
