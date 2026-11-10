/**
 * "Coralis" — an original, Breeze-inspired tropical island fort.
 * A huge, open A site around a stepped pyramid, a wide A Main with the A Hall shortcut,
 * an open mid with pillars and the B Window, and a bending B Main ("Elbow") into a compact B site.
 */
import { GridBuilder } from '../GridMap';
import type { MapDefinition } from '../MapData';
import { authoring, location, withGeneratedSpots, type SpotTable } from '../authoring';
import spots from '../generated/coralis.json';

const COLS = 52;
const ROWS = 48;
const { spawn, spawnAt, focus } = authoring(COLS, ROWS);

function grid(): string[] {
  const g = new GridBuilder(COLS, ROWS, '#');
  // defender spawn + links
  g.rect(18, 1, 33, 4, '.');
  g.set(21, 3, 'c').set(31, 2, 'C');
  g.rect(15, 2, 17, 5, '.');
  g.rect(24, 5, 27, 17, '.'); // mid top corridor
  g.rect(34, 2, 35, 6, '.');

  // A site — wide and open, stepped pyramid in the middle
  g.rect(2, 6, 17, 20, '.');
  g.rect(8, 11, 9, 12, 'D');
  g.set(10, 11, 'C').set(7, 13, 'C');
  g.set(11, 14, 'c');
  g.set(3, 7, 'C');
  g.set(15, 16, 'P');
  g.set(14, 8, 'C');
  g.set(4, 18, 'C');
  // A Main (wide) and A Lobby
  g.rect(3, 21, 9, 33, '.');
  g.set(8, 26, 'C').set(3, 30, 'c');
  g.rect(2, 34, 14, 39, '.');
  g.set(6, 36, 'C');
  g.rect(11, 40, 14, 40, '.');
  // A Hall (A Main ↔ mid)
  g.rect(10, 24, 19, 26, '.');

  // Mid — open with pillars
  g.rect(20, 18, 31, 32, '.');
  g.rect(25, 24, 26, 24, 'P');
  g.set(22, 28, 'C');
  g.rect(29, 20, 29, 21, 'D');
  g.set(21, 21, 'c');
  g.rect(23, 33, 28, 40, '.');
  // B Window (mid → elbow)
  g.rect(32, 18, 37, 20, '.');

  // B site (compact)
  g.rect(35, 6, 49, 16, '.');
  g.set(40, 9, 'D').set(41, 9, 'D');
  g.set(45, 12, 'C');
  g.set(38, 13, 'C');
  g.set(47, 8, 'P');
  g.set(43, 15, 'c');
  // B Main with elbow: north leg → west turn → south leg to lobby
  g.rect(38, 17, 41, 23, '.');
  g.rect(38, 24, 48, 26, '.');
  g.rect(44, 27, 48, 33, '.');
  g.set(47, 25, 'C');
  g.rect(38, 34, 49, 39, '.');
  g.set(43, 36, 'C');
  g.rect(38, 40, 41, 40, '.');

  // attacker spawn
  g.rect(11, 41, 41, 46, '.');
  g.set(18, 43, 'C').set(34, 44, 'C');
  return g.toStrings();
}

function zoneOf(c: number, r: number) {
  if (r >= 40) return 'atkspawn';
  if (r <= 4 && c >= 18 && c <= 33) return 'defspawn';
  if (c <= 17) return 'a';
  if (c >= 35 || (c >= 32 && r >= 17 && r <= 21)) return 'b';
  return 'mid';
}

const locations = withGeneratedSpots(
  [
    location({
      id: 'a-main',
      name: 'A Main',
      description: 'Wide A Main into the huge open A site and its stepped pyramid. Long-range duels.',
      focus: focus(1, 4, 21, 35),
      attack: [spawn('a-main-mid', 'A Main', 6, 26, 0), spawn('a-main-exit', 'A Main exit', 6, 22, 0)],
      defend: [spawnAt('a-site', 'A site', 12, 9, 6, 21), spawnAt('a-site-left', 'A left', 5, 10, 6, 21)],
    }),
    location({
      id: 'mid',
      name: 'Mid',
      description: 'Open mid with twin pillars. Hold the long Mid Top corridor or push it.',
      focus: focus(15, 4, 38, 41),
      attack: [spawn('mid-bottom', 'Mid Bottom', 25.5, 35, 0), spawn('mid-court', 'Mid', 25.5, 30.5, 0)],
      defend: [spawn('mid-top', 'Mid Top', 25.5, 15, 180), spawn('mid-top-deep', 'Mid Top (deep)', 25.5, 11, 180)],
    }),
    location({
      id: 'b-main',
      name: 'B Main',
      description: 'Round the B Elbow into a compact B site with the double stack.',
      focus: focus(31, 4, 50, 35),
      attack: [spawn('b-elbow', 'B Elbow', 39.5, 22.5, 0), spawnAt('b-main-turn', 'B Main turn', 42, 25, 39.5, 15)],
      defend: [spawnAt('b-site', 'B site', 44, 10, 39.5, 18), spawnAt('b-site-back', 'B back', 47, 14, 39.5, 18)],
    }),
  ],
  spots as unknown as SpotTable,
);

export const coralis: MapDefinition = {
  id: 'coralis',
  name: 'Coralis',
  inspiredBy: 'Breeze',
  theme: 'Open tropical island fort',
  description:
    'Original Breeze-inspired open layout: a huge A site around a stepped pyramid, a wide A Main with the A Hall shortcut, an open pillared mid, and a bending B Main into a tight B site.',
  grid: grid(),
  zoneOf,
  callouts: [
    { name: 'A Site', c: 10, r: 16 },
    { name: 'A Pyramid', c: 8.5, r: 11.5 },
    { name: 'A Main', c: 6, r: 28 },
    { name: 'A Hall', c: 15, r: 25 },
    { name: 'A Lobby', c: 8, r: 37 },
    { name: 'Mid', c: 25.5, r: 27 },
    { name: 'Mid Top', c: 25.5, r: 10 },
    { name: 'B Window', c: 35, r: 19 },
    { name: 'B Site', c: 42, r: 12 },
    { name: 'B Elbow', c: 40, r: 21 },
    { name: 'B Main', c: 46, r: 30 },
    { name: 'B Lobby', c: 43, r: 37.5 },
    { name: 'Defender Spawn', c: 25.5, r: 2.5 },
    { name: 'Attacker Spawn', c: 26, r: 44 },
  ],
  locations,
  palette: {
    sky: ['#5fb6e8', '#d7eef7'],
    fog: '#cfe6ee',
    zones: {
      a: { wall: '#e3d3b0', floor: '#d2c29e', accent: '#2bb7b0' },
      b: { wall: '#dccaa4', floor: '#c9b893', accent: '#e07a3a' },
      mid: { wall: '#e6d8b8', floor: '#cdbd98', accent: '#3a8fb7' },
      defspawn: { wall: '#d2cdb4', floor: '#bdb69a', accent: '#2e9c8a' },
      atkspawn: { wall: '#e0cba6', floor: '#c8b38e', accent: '#e05a47' },
    },
  },
  siteMarks: [
    { letter: 'A', c: 13, r: 18.5 },
    { letter: 'B', c: 37, r: 8 },
  ],
};
