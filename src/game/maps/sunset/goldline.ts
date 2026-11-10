/**
 * "Goldline" — an original, Sunset-inspired city block at golden hour.
 * A Main bends through the A Elbow, mid runs from the Market up into a fountain courtyard
 * with alleys to both sites, and B Main comes up past the Boba shop.
 */
import { GridBuilder } from '../GridMap';
import type { MapDefinition } from '../MapData';
import { authoring, location, withGeneratedSpots, type SpotTable } from '../authoring';
import spots from '../generated/goldline.json';

const COLS = 52;
const ROWS = 48;
const { spawn, spawnAt, focus } = authoring(COLS, ROWS);

function grid(): string[] {
  const g = new GridBuilder(COLS, ROWS, '#');
  // defender spawn + links
  g.rect(18, 1, 33, 4, '.');
  g.set(23, 2, 'c').set(28, 3, 'C');
  g.rect(15, 2, 17, 6, '.');
  g.rect(24, 5, 27, 9, '.');
  g.rect(34, 2, 35, 6, '.');

  // A site
  g.rect(2, 6, 15, 16, '.');
  g.set(6, 9, 'D').set(7, 9, 'D');
  g.set(11, 12, 'C').set(12, 12, 'C');
  g.set(4, 14, 'P');
  g.set(14, 8, 'C');
  g.set(9, 15, 'c');
  // A Main → A Elbow → A Lobby
  g.rect(5, 17, 8, 28, '.');
  g.set(8, 22, 'C');
  g.rect(5, 29, 14, 31, '.');
  g.rect(12, 32, 16, 39, '.');
  g.set(15, 35, 'C');
  g.rect(12, 40, 15, 40, '.');
  // A Alley (A site ↔ courtyard)
  g.rect(16, 12, 20, 14, '.');

  // Mid courtyard with fountain, Market, mid bottom
  g.rect(21, 10, 30, 20, '.');
  g.rect(25, 14, 26, 14, 'D'); // fountain
  g.set(22, 18, 'C');
  g.set(29, 11, 'C');
  g.set(29, 18, 'c');
  g.rect(24, 21, 27, 21, '.');
  g.rect(21, 22, 30, 28, '.'); // market
  g.set(23, 25, 'C').set(28, 24, 'C');
  g.rect(24, 29, 27, 40, '.');
  // B link from courtyard
  g.rect(31, 12, 34, 14, '.');

  // B site
  g.rect(35, 6, 49, 16, '.');
  g.set(40, 9, 'D').set(41, 9, 'D');
  g.set(45, 13, 'C');
  g.set(37, 12, 'C');
  g.set(47, 8, 'P');
  g.set(43, 15, 'c');
  // B Main (Boba) → B Market/Lobby
  g.rect(43, 17, 47, 30, '.');
  g.set(43, 24, 'C');
  g.rect(37, 31, 49, 39, '.');
  g.set(41, 34, 'C');
  g.rect(37, 40, 40, 40, '.');

  // attacker spawn
  g.rect(12, 41, 40, 46, '.');
  g.set(19, 43, 'C').set(33, 44, 'C');
  return g.toStrings();
}

function zoneOf(c: number, r: number) {
  if (r >= 40) return 'atkspawn';
  if (r <= 4 && c >= 18 && c <= 33) return 'defspawn';
  if (c <= 15) return 'a';
  if (c >= 35) return 'b';
  return 'mid';
}

const locations = withGeneratedSpots(
  [
    location({
      id: 'a-main',
      name: 'A Main',
      description: 'Round the A Elbow and up A Main into a site of stacks and boxes.',
      focus: focus(1, 4, 21, 40),
      attack: [spawn('a-main-mid', 'A Main', 6.5, 24, 0), spawn('a-main-exit', 'A Main exit', 6.5, 19, 0)],
      defend: [spawnAt('a-site', 'A site', 10, 10, 6.5, 18), spawnAt('a-site-right', 'A right', 13, 14, 6.5, 18)],
    }),
    location({
      id: 'mid',
      name: 'Mid',
      description: 'Market and the fountain courtyard, with alleys branching to A and B.',
      focus: focus(14, 4, 37, 41),
      attack: [spawn('mid-market', 'Market', 25.5, 25, 0), spawn('mid-market-back', 'Market back', 25.5, 27.5, 0)],
      defend: [spawnAt('mid-courtyard-left', 'Courtyard (left)', 22.5, 11, 25.5, 21), spawnAt('mid-courtyard-right', 'Courtyard (right)', 29, 13, 25.5, 21)],
    }),
    location({
      id: 'b-main',
      name: 'B Main',
      description: 'B Main past the Boba shop into a wide B site.',
      focus: focus(31, 4, 50, 40),
      attack: [spawn('b-main-mid', 'B Main', 45, 25, 0), spawn('b-main-exit', 'B Main exit', 45, 20, 0)],
      defend: [spawnAt('b-site', 'B site', 42, 11, 45, 18), spawnAt('b-site-left', 'B left', 38, 9, 45, 18)],
    }),
  ],
  spots as unknown as SpotTable,
);

export const goldline: MapDefinition = {
  id: 'goldline',
  name: 'Goldline',
  inspiredBy: 'Sunset',
  theme: 'Golden-hour city streets',
  description:
    'Original Sunset-inspired city block: A Main through the A Elbow, a Market and fountain courtyard in mid with alleys to both sites, and B Main past the Boba shop.',
  grid: grid(),
  zoneOf,
  callouts: [
    { name: 'A Site', c: 9, r: 11 },
    { name: 'A Main', c: 6.5, r: 23 },
    { name: 'A Elbow', c: 9, r: 30 },
    { name: 'A Lobby', c: 14, r: 36 },
    { name: 'A Alley', c: 18, r: 13 },
    { name: 'Courtyard', c: 25.5, r: 17 },
    { name: 'Market', c: 25.5, r: 26 },
    { name: 'Mid Bottom', c: 25.5, r: 35 },
    { name: 'B Link', c: 33, r: 13 },
    { name: 'B Site', c: 42, r: 12 },
    { name: 'Boba', c: 45, r: 24 },
    { name: 'B Lobby', c: 43, r: 36 },
    { name: 'Defender Spawn', c: 25.5, r: 2.5 },
    { name: 'Attacker Spawn', c: 26, r: 44 },
  ],
  locations,
  palette: {
    sky: ['#e7a46a', '#f6d3a4'],
    fog: '#efc99f',
    zones: {
      a: { wall: '#e2b48a', floor: '#a9927e', accent: '#7a4fb0' },
      b: { wall: '#d9a07a', floor: '#a38b78', accent: '#2f8fa0' },
      mid: { wall: '#e6c09a', floor: '#ad9782', accent: '#c4473a' },
      defspawn: { wall: '#cfae92', floor: '#9e8b7c', accent: '#2e9c8a' },
      atkspawn: { wall: '#dba67e', floor: '#a48a74', accent: '#e05a47' },
    },
  },
  siteMarks: [
    { letter: 'A', c: 3.5, r: 7.5 },
    { letter: 'B', c: 48, r: 15 },
  ],
};
