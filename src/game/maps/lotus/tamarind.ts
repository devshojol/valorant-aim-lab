/**
 * "Tamarind" — an original, Lotus-inspired jungle temple with three sites.
 * A (west) with a rubble mound, a low central B courtyard, and C (east) behind the C Mound.
 * The A Root and the A and C links let you rotate between sites.
 */
import { GridBuilder } from '../GridMap';
import type { MapDefinition } from '../MapData';
import { authoring, location, withGeneratedSpots, type SpotTable } from '../authoring';
import spots from '../generated/tamarind.json';

const COLS = 52;
const ROWS = 48;
const { spawn, spawnAt, focus } = authoring(COLS, ROWS);

function grid(): string[] {
  const g = new GridBuilder(COLS, ROWS, '#');
  // defender spawn + links
  g.rect(18, 1, 33, 4, '.');
  g.set(21, 2, 'c').set(30, 3, 'c');
  g.rect(15, 2, 17, 6, '.');
  g.rect(24, 5, 27, 11, '.');
  g.rect(34, 2, 36, 6, '.');

  // A site with rubble mound
  g.rect(2, 5, 14, 15, '.');
  g.rect(3, 6, 7, 9, '1');
  g.rect(4, 7, 6, 8, '2');
  g.set(10, 8, 'D').set(11, 8, 'D');
  g.set(8, 12, 'P');
  g.set(12, 13, 'C');
  g.set(3, 13, 'C');
  g.set(13, 6, 'P');
  // A Main, A Lobby
  g.rect(4, 16, 7, 33, '.');
  g.set(7, 29, 'c');
  g.rect(2, 34, 12, 39, '.');
  g.set(10, 36, 'C');
  g.rect(10, 40, 13, 40, '.');
  // A Root: A Main ↔ B Main
  g.rect(8, 24, 22, 26, '.');
  g.set(15, 25, 'P');
  // A Link: A site ↔ B site
  g.rect(15, 13, 19, 15, '.');

  // B site (central courtyard)
  g.rect(20, 12, 31, 20, '.');
  g.set(24, 15, 'D').set(25, 15, 'D');
  g.set(21, 13, 'P').set(30, 13, 'P');
  g.set(28, 18, 'C');
  g.set(22, 19, 'c');
  // B Main
  g.rect(23, 21, 28, 40, '.');
  g.set(27, 31, 'C');
  // C Link: B site ↔ C site
  g.rect(32, 14, 36, 16, '.');

  // C site
  g.rect(37, 5, 49, 15, '.');
  g.set(41, 8, 'D').set(42, 8, 'D');
  g.set(46, 11, 'C');
  g.set(39, 12, 'P');
  g.set(44, 14, 'C');
  // C Mound (walkable hill) + side path, C Main, C Lobby
  g.rect(43, 16, 47, 19, '1');
  g.rect(44, 17, 46, 18, '2');
  g.rect(48, 16, 49, 19, '.');
  g.rect(44, 20, 48, 33, '.');
  g.rect(38, 34, 49, 39, '.');
  g.set(42, 36, 'C');
  g.rect(38, 40, 41, 40, '.');

  // attacker spawn
  g.rect(10, 41, 41, 46, '.');
  g.set(17, 43, 'C').set(35, 44, 'C');
  return g.toStrings();
}

function zoneOf(c: number, r: number) {
  if (r >= 40) return 'atkspawn';
  if (r <= 4 && c >= 18 && c <= 33) return 'defspawn';
  if (c <= 14) return 'a';
  if (c >= 37) return 'c';
  if (r <= 20) return 'b';
  return 'mid';
}

const locations = withGeneratedSpots(
  [
    location({
      id: 'a-main',
      name: 'A Main',
      description: 'A Main into a temple site with a rubble mound, pillars and the twin stacks.',
      focus: focus(1, 3, 20, 35),
      attack: [spawn('a-main-mid', 'A Main', 5.5, 22, 0), spawn('a-main-exit', 'A Main exit', 5.5, 18, 0)],
      defend: [spawnAt('a-site', 'A site', 9, 10, 5.5, 17), spawnAt('a-site-right', 'A right', 12, 11, 5.5, 17)],
    }),
    location({
      id: 'b-main',
      name: 'B Main',
      description: 'The long B Main approach into the central B courtyard.',
      focus: focus(14, 4, 37, 41),
      attack: [spawn('b-main-mid', 'B Main', 25.5, 30, 0), spawn('b-main-exit', 'B Main exit', 25.5, 23, 0)],
      defend: [spawnAt('b-site', 'B site', 26, 13, 25.5, 22), spawnAt('b-site-left', 'B left', 22, 16, 25.5, 22)],
    }),
    location({
      id: 'c-main',
      name: 'C Main',
      description: 'Over the C Mound into C site: high ground, a pillar and the back stacks.',
      focus: focus(31, 3, 50, 35),
      attack: [spawn('c-main-mid', 'C Main', 46, 27, 0), spawn('c-main-mound', 'Before mound', 46, 22, 0)],
      defend: [spawnAt('c-site', 'C site', 43, 10, 46, 18), spawnAt('c-site-left', 'C left', 40, 7, 46, 18)],
    }),
  ],
  spots as unknown as SpotTable,
);

export const tamarind: MapDefinition = {
  id: 'tamarind',
  name: 'Tamarind',
  inspiredBy: 'Lotus',
  theme: 'Jungle temple ruins, three sites',
  description:
    'Original Lotus-inspired three-site layout: A rubble and A Root on the west, a sunken central B courtyard, and the walkable C Mound guarding C site.',
  grid: grid(),
  zoneOf,
  callouts: [
    { name: 'A Site', c: 9, r: 11 },
    { name: 'A Rubble', c: 5, r: 7.5 },
    { name: 'A Main', c: 5.5, r: 28 },
    { name: 'A Root', c: 12, r: 25 },
    { name: 'A Link', c: 17, r: 14 },
    { name: 'A Lobby', c: 6, r: 37 },
    { name: 'B Site', c: 25.5, r: 17 },
    { name: 'B Main', c: 25.5, r: 33 },
    { name: 'C Link', c: 34, r: 15 },
    { name: 'C Site', c: 44, r: 10 },
    { name: 'C Mound', c: 45, r: 17.5 },
    { name: 'C Main', c: 46, r: 28 },
    { name: 'C Lobby', c: 43, r: 37 },
    { name: 'Defender Spawn', c: 25.5, r: 2.5 },
    { name: 'Attacker Spawn', c: 26, r: 44 },
  ],
  locations,
  palette: {
    sky: ['#86b5a4', '#e2ead3'],
    fog: '#cfdcc6',
    zones: {
      a: { wall: '#9fae94', floor: '#7f8a72', accent: '#c7963f' },
      b: { wall: '#a9b18f', floor: '#858a6e', accent: '#2f8f84' },
      c: { wall: '#98aa98', floor: '#7a8875', accent: '#b5653a' },
      mid: { wall: '#a4ab8c', floor: '#80856c', accent: '#6a8f3a' },
      defspawn: { wall: '#9aa898', floor: '#7d877a', accent: '#2e9c8a' },
      atkspawn: { wall: '#aaa98a', floor: '#86846c', accent: '#e05a47' },
    },
  },
  siteMarks: [
    { letter: 'A', c: 4, r: 11.5 },
    { letter: 'B', c: 21.5, r: 17 },
    { letter: 'C', c: 47.5, r: 7 },
  ],
};
