/**
 * "Permafrost" — an original, Icebox-inspired arctic container yard.
 * Both sites are mazes of stacked shipping containers. Mid runs through the Boiler yard,
 * with the Kitchen leading to B and a link to A.
 */
import { GridBuilder } from '../GridMap';
import type { MapDefinition } from '../MapData';
import { authoring, location, withGeneratedSpots, type SpotTable } from '../authoring';
import spots from '../generated/permafrost.json';

const COLS = 52;
const ROWS = 48;
const { spawn, spawnAt, focus } = authoring(COLS, ROWS);

function grid(): string[] {
  const g = new GridBuilder(COLS, ROWS, '#');
  // defender spawn + links
  g.rect(18, 1, 33, 4, '.');
  g.set(22, 2, 'D').set(29, 3, 'c');
  g.rect(17, 2, 17, 6, '.');
  g.rect(24, 5, 27, 12, '.');
  g.rect(34, 2, 35, 6, '.');

  // A site — container maze
  g.rect(2, 5, 16, 17, '.');
  g.rect(5, 8, 6, 8, 'D');
  g.rect(10, 7, 10, 8, 'D');
  g.rect(13, 11, 14, 11, 'D');
  g.rect(4, 13, 5, 13, 'C');
  g.rect(8, 12, 8, 13, 'C');
  g.rect(11, 15, 12, 15, 'D');
  g.set(15, 14, 'c');
  // A Main, A Lobby
  g.rect(4, 18, 8, 33, '.');
  g.set(8, 28, 'C');
  g.rect(2, 34, 13, 39, '.');
  g.rect(5, 36, 6, 36, 'D');
  g.rect(10, 40, 13, 40, '.');

  // Mid: boiler yard, A link, Kitchen to B, mid bottom
  g.rect(20, 13, 31, 30, '.');
  g.rect(24, 22, 25, 23, 'D'); // boiler
  g.set(21, 17, 'C');
  g.set(29, 26, 'C');
  g.rect(28, 15, 29, 15, 'D');
  g.set(22, 28, 'c');
  g.rect(17, 13, 19, 15, '.'); // A link
  g.rect(32, 14, 35, 19, '.'); // kitchen
  g.set(33, 18, 'c');
  g.rect(23, 31, 28, 40, '.');

  // B site — container maze
  g.rect(36, 5, 49, 17, '.');
  g.rect(39, 8, 40, 8, 'D');
  g.rect(44, 7, 44, 8, 'D');
  g.rect(46, 12, 47, 12, 'D');
  g.rect(38, 13, 38, 14, 'C');
  g.rect(42, 15, 43, 15, 'C');
  g.rect(42, 11, 43, 11, 'D'); // yellow
  // B Main (green), B Lobby
  g.rect(43, 18, 47, 33, '.');
  g.set(47, 30, 'c');
  g.rect(38, 34, 49, 39, '.');
  g.rect(42, 36, 43, 36, 'D');
  g.rect(38, 40, 41, 40, '.');

  // attacker spawn
  g.rect(10, 41, 41, 46, '.');
  g.rect(18, 43, 19, 43, 'D');
  g.set(33, 44, 'C');
  return g.toStrings();
}

function zoneOf(c: number, r: number) {
  if (r >= 40) return 'atkspawn';
  if (r <= 4 && c >= 17 && c <= 35) return 'defspawn';
  if (c <= 16) return 'a';
  if (c >= 36) return 'b';
  return 'mid';
}

const locations = withGeneratedSpots(
  [
    location({
      id: 'a-main',
      name: 'A Main',
      description: 'A Main into the container maze, where every stack hides an angle.',
      focus: focus(1, 3, 20, 35),
      attack: [spawn('a-main-mid', 'A Main', 6, 26, 0), spawn('a-main-exit', 'A Main exit', 6, 21, 0)],
      defend: [spawnAt('a-site', 'A site', 9, 10, 6, 19), spawnAt('a-site-right', 'A right', 14, 9, 6, 19)],
    }),
    location({
      id: 'mid',
      name: 'Mid',
      description: 'Boiler yard: hold or take mid around the boiler stack and crates.',
      focus: focus(15, 4, 37, 41),
      attack: [spawn('mid-bottom', 'Mid Bottom', 25.5, 34, 0), spawn('mid-yard', 'Boiler yard', 25.5, 30.5, 0)],
      defend: [spawn('mid-top', 'Mid Top', 25.5, 14.5, 180), spawnAt('mid-top-left', 'Mid Top (left)', 22, 14, 25.5, 30)],
    }),
    location({
      id: 'b-main',
      name: 'B Main',
      description: 'B Green into the yellow container stacks on B site.',
      focus: focus(31, 3, 50, 35),
      attack: [spawn('b-main-mid', 'B Main', 45, 26, 0), spawn('b-main-exit', 'B Main exit', 45, 21, 0)],
      defend: [spawnAt('b-site', 'B site', 41, 10, 45, 19), spawnAt('b-site-back', 'B back', 48, 9, 45, 19)],
    }),
  ],
  spots as unknown as SpotTable,
);

export const permafrost: MapDefinition = {
  id: 'permafrost',
  name: 'Permafrost',
  inspiredBy: 'Icebox',
  theme: 'Arctic container yard',
  description:
    'Original Icebox-inspired layout: container mazes on both sites, a boiler yard in mid, and a Kitchen leading to B.',
  grid: grid(),
  zoneOf,
  callouts: [
    { name: 'A Site', c: 9, r: 11 },
    { name: 'A Main', c: 6, r: 28 },
    { name: 'A Lobby', c: 7, r: 38 },
    { name: 'A Link', c: 18, r: 14 },
    { name: 'Boiler', c: 25.5, r: 25 },
    { name: 'Mid Top', c: 25.5, r: 15 },
    { name: 'Mid Bottom', c: 25.5, r: 35 },
    { name: 'Kitchen', c: 34, r: 16.5 },
    { name: 'B Site', c: 42, r: 13 },
    { name: 'B Yellow', c: 42.5, r: 10 },
    { name: 'B Green', c: 45, r: 28 },
    { name: 'B Lobby', c: 44, r: 38 },
    { name: 'Defender Spawn', c: 25.5, r: 2.5 },
    { name: 'Attacker Spawn', c: 26, r: 44 },
  ],
  locations,
  palette: {
    sky: ['#b8d4ec', '#eef4f8'],
    fog: '#e6edf2',
    zones: {
      a: { wall: '#e3eaf0', floor: '#c9d3dc', accent: '#2f6fb0' },
      b: { wall: '#e6ebee', floor: '#ccd5db', accent: '#d8a23a' },
      mid: { wall: '#dde5ea', floor: '#c2ccd4', accent: '#4a9a6a' },
      defspawn: { wall: '#d6e0e6', floor: '#bdc8d0', accent: '#2e9c8a' },
      atkspawn: { wall: '#e0e2e4', floor: '#c4c9cd', accent: '#c4473a' },
    },
  },
  siteMarks: [
    { letter: 'A', c: 3.5, r: 9 },
    { letter: 'B', c: 48, r: 15.5 },
  ],
};
