/**
 * "Dunehold" — an original, Bind-inspired desert bazaar.
 * Two sites and no mid: A is reached by A Long or by A Short through Showers;
 * B is reached by B Long or through the Hookah room, which has a window onto the site.
 */
import { GridBuilder } from '../GridMap';
import type { MapDefinition } from '../MapData';
import { authoring, location, withGeneratedSpots, type SpotTable } from '../authoring';
import spots from '../generated/dunehold.json';

const COLS = 52;
const ROWS = 48;
const { spawn, spawnAt, focus } = authoring(COLS, ROWS);

function grid(): string[] {
  const g = new GridBuilder(COLS, ROWS, '#');
  // defender spawn + links to both sites
  g.rect(19, 1, 32, 4, '.');
  g.set(24, 2, 'c').set(28, 3, 'c');
  g.rect(14, 2, 18, 5, '.');
  g.rect(33, 2, 34, 5, '.');

  // A site
  g.rect(2, 6, 17, 17, '.');
  g.set(6, 9, 'C').set(7, 9, 'C');
  g.rect(10, 12, 11, 13, 'D'); // truck
  g.set(15, 9, 'C');
  g.set(3, 14, 'C').set(4, 14, 'c');
  g.set(14, 15, 'C');

  // A Short → Showers → A Lobby
  g.rect(13, 18, 15, 24, '.');
  g.rect(9, 24, 16, 28, '.'); // showers
  g.set(10, 25, 'P').set(10, 27, 'P');
  g.rect(12, 29, 14, 33, '.');

  // A Long (open west lane)
  g.rect(2, 18, 5, 33, '.');
  g.set(5, 24, 'C').set(2, 28, 'c');

  // A Lobby → attacker spawn
  g.rect(2, 34, 16, 38, '.');
  g.set(8, 36, 'C');
  g.rect(12, 39, 15, 40, '.');

  // attacker spawn
  g.rect(12, 41, 40, 46, '.');
  g.set(20, 43, 'C').set(32, 44, 'C');

  // B Lobby (market) → attacker spawn
  g.rect(33, 34, 49, 38, '.');
  g.set(41, 36, 'C').set(47, 35, 'c');
  g.rect(36, 39, 39, 40, '.');

  // B Long
  g.rect(45, 18, 49, 33, '.');
  g.set(46, 26, 'C').set(49, 22, 'c');

  // B Short → Hookah room → door + window onto B site
  g.rect(34, 28, 37, 33, '.');
  g.rect(33, 20, 41, 27, '.');
  g.set(39, 23, 'c');
  g.rect(36, 18, 38, 19, '.'); // hookah door
  g.rect(40, 18, 41, 19, 'w'); // hookah window

  // B site
  g.rect(32, 6, 49, 17, '.');
  g.set(38, 10, 'D').set(39, 10, 'D');
  g.set(44, 12, 'C').set(45, 12, 'C');
  g.set(35, 14, 'c');
  g.set(42, 7, 'P');
  g.set(48, 15, 'C');
  return g.toStrings();
}

function zoneOf(c: number, r: number) {
  if (r >= 39) return 'atkspawn';
  if (r <= 5 && c >= 18 && c <= 33) return 'defspawn';
  if (c <= 17) return 'a';
  if (c >= 32) return 'b';
  return 'mid';
}

const locations = withGeneratedSpots(
  [
    location({
      id: 'a-short',
      name: 'A Short',
      description: 'Tight A Short corridor out of Showers, straight into the truck and crates on A site.',
      focus: focus(1, 4, 20, 34),
      attack: [spawn('a-short-in', 'A Short', 14, 21.5, 0), spawn('a-short-exit', 'Short exit', 14, 19.6, 0)],
      defend: [spawnAt('a-short-site', 'A site (truck side)', 12, 9, 14, 19), spawnAt('a-short-crates', 'Behind crates', 7, 11, 14, 19)],
    }),
    location({
      id: 'a-long',
      name: 'A Long',
      description: 'Open west lane into A site — long sightlines past crates in Long.',
      focus: focus(1, 4, 19, 35),
      attack: [spawn('a-long-mid', 'A Long', 3.5, 25.5, 0), spawn('a-long-exit', 'Long exit', 3.5, 21, 0)],
      defend: [spawnAt('a-long-site', 'A site', 9, 8, 3.5, 20), spawnAt('a-long-default', 'A default', 14, 11, 3.5, 20)],
    }),
    location({
      id: 'hookah',
      name: 'Hookah',
      description: 'The Hookah room: a door and a window onto B site, held from boxes and the stack.',
      focus: focus(30, 4, 50, 34),
      attack: [spawn('hookah-door', 'Hookah door', 37, 21, 0), spawnAt('hookah-room', 'Hookah room', 35, 23, 37, 15)],
      defend: [spawnAt('hookah-b-stack', 'B stack', 40, 8, 37, 19), spawnAt('hookah-b-left', 'B left', 34, 10, 37, 19)],
    }),
    location({
      id: 'b-long',
      name: 'B Long',
      description: 'Long east lane into B site past the Hookah window.',
      focus: focus(30, 4, 50, 35),
      attack: [spawn('b-long-mid', 'B Long', 47, 25, 0), spawn('b-long-exit', 'Long exit', 47, 21, 0)],
      defend: [spawnAt('b-long-site', 'B site', 43, 9, 47, 20), spawnAt('b-long-boxes', 'B boxes', 40, 14, 47, 20)],
    }),
  ],
  spots as unknown as SpotTable,
);

export const dunehold: MapDefinition = {
  id: 'dunehold',
  name: 'Dunehold',
  inspiredBy: 'Bind',
  theme: 'Desert bazaar, two sites, no mid',
  description:
    'Original Bind-inspired layout: A Short through Showers and A Long on the west, the Hookah room with its site window and B Long on the east. There is no mid, so you rotate through spawn.',
  grid: grid(),
  zoneOf,
  callouts: [
    { name: 'A Site', c: 9, r: 10.5 },
    { name: 'A Short', c: 14, r: 20.5 },
    { name: 'Showers', c: 13, r: 26 },
    { name: 'A Long', c: 3.5, r: 27 },
    { name: 'A Lobby', c: 9, r: 37 },
    { name: 'Hookah', c: 37, r: 24 },
    { name: 'B Short', c: 35.5, r: 31 },
    { name: 'B Long', c: 47, r: 29 },
    { name: 'B Site', c: 41, r: 12.5 },
    { name: 'Market', c: 41, r: 37.5 },
    { name: 'Defender Spawn', c: 26, r: 2.5 },
    { name: 'Attacker Spawn', c: 26, r: 44 },
  ],
  locations,
  palette: {
    sky: ['#a9c6e0', '#f4d9b0'],
    fog: '#e6d2b5',
    zones: {
      a: { wall: '#d8b98c', floor: '#c2a57d', accent: '#b5532e' },
      b: { wall: '#cfa77a', floor: '#b8986e', accent: '#2f7f86' },
      mid: { wall: '#c99a6b', floor: '#b28f6c', accent: '#8a3b2a' },
      defspawn: { wall: '#bfae8e', floor: '#a89a80', accent: '#2e9c8a' },
      atkspawn: { wall: '#c8a27c', floor: '#a8906f', accent: '#e05a47' },
    },
  },
  siteMarks: [
    { letter: 'A', c: 6, r: 16 },
    { letter: 'B', c: 36, r: 8 },
  ],
};
