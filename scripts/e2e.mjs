/**
 * Headless gameplay smoke test (Chromium + SwiftShader WebGL).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/e2e.mjs [baseUrl] [outDir]
 *
 * Drives the real engine through window.__TAL__.debug (no pointer lock in headless),
 * verifies rendering, movement, collision, shooting, hit detection, bot behaviour and stats,
 * and writes screenshots.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(require.resolve('playwright', { paths: [process.env.NODE_PATH ?? '', '/usr/lib/node_modules', '/usr/local/lib/node_modules'] }));
}
const { chromium } = playwright;

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'e2e-shots';
fs.mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const wait = (ms) => page.waitForTimeout(ms);
const dbg = (fn, arg) => page.evaluate(([f, a]) => window.__TAL__.debug[f](...(a ?? [])), [fn, arg]);
const state = () => page.evaluate(() => window.__TAL__.debug.state());
/** Wait for simulated game time (SwiftShader runs at low FPS, so wall-clock waits are unreliable). */
async function waitGame(sec) {
  const t0 = (await state()).time;
  await page.waitForFunction((t) => window.__TAL__.debug.state().time >= t, t0 + sec, { timeout: 120000, polling: 100 });
}

async function startSession(patch) {
  await page.evaluate((p) => {
    const raw = localStorage.getItem('tal:v1:practice');
    const cur = raw ? JSON.parse(raw) : {};
    localStorage.setItem('tal:v1:practice', JSON.stringify({ ...cur, ...p }));
  }, patch);
  await page.goto(base);
  await page.getByRole('button', { name: /Quick practice/i }).click();
  await page.waitForFunction(() => window.__TAL__ && (window.__TAL__.status === 'ready' || window.__TAL__.status === 'running'), null, { timeout: 60000 });
}

await page.goto(base);
await page.waitForSelector('text=Quick practice');
await page.screenshot({ path: `${out}/01-home.png` });

// Practice setup page
await page.getByRole('button', { name: 'Practice', exact: true }).click();
await wait(400);
await page.screenshot({ path: `${out}/02-practice-setup.png`, fullPage: false });

// Crosshair + sensitivity + stats pages render
for (const [name, file] of [
  ['Crosshair', '03-crosshair'],
  ['Sensitivity', '04-sensitivity'],
  ['Weapons', '05-weapons'],
  ['Maps', '06-maps'],
  ['Settings', '07-settings'],
]) {
  await page.getByRole('button', { name, exact: true }).click();
  await wait(300);
  await page.screenshot({ path: `${out}/${file}.png` });
}

/* ---------------- Angle hold @ A Main (attack) ---------------- */
await startSession({
  mapId: 'vellora',
  locationId: 'a-main',
  side: 'attack',
  playerSpawnId: 'a-main-arch',
  enemySpotIds: [],
  mode: 'angle-hold',
  behavior: 'mixed',
  botCount: 3,
  difficulty: 'normal',
  durationSec: 120,
  botsShootBack: false,
  primary: 'vandal',
  secondary: 'classic',
});
await wait(800);
await page.screenshot({ path: `${out}/10-ready-overlay.png` });
await dbg('forceRun');
await wait(1500);
let s = await state();
check('engine running', s.status === 'running', `renderer=${s.renderer}`);
check('bots spawned (angle hold)', s.bots.length === 3, JSON.stringify(s.bots.map((b) => b.brain)));
check('no unusable spots for default spawn', s.unusableSpots.length === 0, s.unusableSpots.join(','));
await page.screenshot({ path: `${out}/11-a-main-attack.png` });

// Movement: walk forward 1s
const p0 = s.player.pos;
await dbg('key', ['forward', true]);
await waitGame(0.6);
s = await state();
check('player moves with W', s.player.speed > 3 || Math.hypot(s.player.pos.x - p0.x, s.player.pos.z - p0.z) > 1, `speed=${s.player.speed.toFixed(2)}`);
await dbg('key', ['forward', false]);
await waitGame(0.3);
s = await state();
check('player stops after release (counter friction)', s.player.speed < 0.5, `speed=${s.player.speed.toFixed(2)}`);

// Collision: from the middle of A Main (row 27), run into its west wall (edge at x = -44·K) for 2 s
// map coordinates scale with the grid cell (CELL in src/game/maps/GridMap.ts, now 1.5 m; these were measured at 2 m)
const K = 1.5 / 2;
await dbg('teleport', [-38 * K, 0, -7 * K]);
await dbg('setView', [-90, 0]);
await dbg('key', ['forward', true]);
await waitGame(2);
await dbg('key', ['forward', false]);
s = await state();
check('collision stops player at wall', s.player.pos.x > -44 * K - 0.05 && s.player.pos.x < -44 * K + 1, `x=${s.player.pos.x.toFixed(2)} wall=${(-44 * K).toFixed(2)}`);
await dbg('teleport', [-38 * K, 0, -2 * K]);
await dbg('setView', [0, 0]);

// Mouse look via injected counts: 1000 counts at 0.4 sens → 28°
const yaw0 = (await state()).player.yaw;
await dbg('mouse', [1000, 0]);
await wait(100);
s = await state();
const turned = ((s.player.yaw - yaw0) * 180) / Math.PI;
check('mouse look applies Valorant-scale sensitivity', Math.abs(turned - 1000 * 0.4 * 0.07) < 0.5, `turned=${turned.toFixed(2)}°`);
await dbg('setView', [0, 0]);

// Wait for a bot to become visible, then flick + fire
let killed = false;
for (let attempt = 0; attempt < 40 && !killed; attempt++) {
  await wait(250);
  s = await state();
  const vis = s.bots.filter((b) => b.alive && b.visibleToPlayer);
  if (vis.length) {
    const idx = s.bots.filter((b) => b.alive).findIndex((b) => b.id === vis[0].id);
    await dbg('aimAtBot', [idx, 'head']);
    await dbg('key', ['fire', true]);
    await wait(60);
    await dbg('key', ['fire', false]);
    await wait(150);
    const s2 = await state();
    if (s2.stats.kills > 0) killed = true;
  }
}
s = await state();
check('hitscan kills a peeking bot', s.stats.kills > 0, `shots=${s.stats.shots} hits=${s.stats.hits} hs=${s.stats.headshots} rt=${JSON.stringify(s.stats.reactionTimes)}`);
check('reaction time recorded', s.stats.reactionTimes.length > 0);
await page.screenshot({ path: `${out}/12-after-kill.png` });

// Spray: hold fire 1.2 s at a wall and check recoil index climbs
await dbg('setView', [0, 5]);
await dbg('key', ['fire', true]);
await waitGame(1.0);
const sprayState = await state();
await dbg('key', ['fire', false]);
check('spray climbs recoil index', sprayState.weapon.recoilIndex > 5, `recoilIndex=${sprayState.weapon.recoilIndex.toFixed(1)} ammo=${sprayState.weapon.ammo}`);
await page.screenshot({ path: `${out}/13-spray.png` });
await dbg('key', ['reload', true]);
await waitGame(0.05);
await dbg('key', ['reload', false]);
const reloadingNow = (await state()).weapon.reloading;
await waitGame(2.7);
s = await state();
check('R reloads the magazine (2.5 s)', reloadingNow && s.weapon.ammo === 25, `reloading=${reloadingNow} ammo=${s.weapon.ammo}`);

// Behaviour sampling: brains cycle through states
const seen = new Set();
for (let i = 0; i < 24; i++) {
  s = await state();
  for (const b of s.bots) if (b.brain) seen.add(b.brain);
  await wait(250);
}
check('peek bots cycle through tactical states', seen.size >= 4, [...seen].join(' '));

/* ---------------- Bots shoot back: defend B Main, hard ---------------- */
await startSession({
  locationId: 'b-main',
  side: 'defend',
  playerSpawnId: 'b-default-def',
  mode: 'angle-hold',
  behavior: 'wide-swing',
  botCount: 2,
  difficulty: 'hard',
  botsShootBack: true,
});
await dbg('forceRun');
await waitGame(9);
s = await state();
const botShots = s.bots.reduce((a, b) => a + b.shots, 0);
check('wide-swing bots engage and shoot the player', botShots > 0 || s.stats.damageTaken > 0, `botShots=${botShots} dmgTaken=${s.stats.damageTaken} brains=${s.bots.map((b) => b.brain).join(',')}`);
await page.screenshot({ path: `${out}/20-b-main-defend.png` });

/* ---------------- Jiggle training @ Mid ---------------- */
await startSession({ locationId: 'mid', side: 'attack', playerSpawnId: 'mid-bottom', mode: 'jiggle', botCount: 2, difficulty: 'normal', botsShootBack: false });
await dbg('forceRun');
const jiggleStates = new Set();
const tJ = (await state()).time;
for (let i = 0; (await state()).time - tJ < 14 && i < 400; i++) {
  s = await state();
  for (const b of s.bots) if (b.brain) jiggleStates.add(b.brain.split(':')[1] + ':' + b.brain.split(':')[0]);
  if (i === 12) await page.screenshot({ path: `${out}/30-mid-jiggle.png` });
  await wait(120);
}
check('jiggle mode produces jiggle/shoulder peeks', [...jiggleStates].some((x) => x.startsWith('jiggle') || x.startsWith('shoulder')), [...jiggleStates].join(' '));

/* ---------------- Deathmatch ---------------- */
await startSession({ mode: 'deathmatch', botCount: 5, difficulty: 'normal', locationId: 'mid', side: 'attack', playerSpawnId: 'mid-bottom' });
await dbg('forceRun');
await dbg('godMode', [true]);
const p1 = (await state()).bots.map((b) => b.pos);
await waitGame(5);
s = await state();
const moved = s.bots.filter((b, i) => Math.hypot(b.pos[0] - p1[i][0], b.pos[2] - p1[i][2]) > 3).length;
check('deathmatch bots navigate the map', moved >= 3, `moved=${moved}/5 states=${s.bots.map((b) => b.brain).join(',')}`);
await page.screenshot({ path: `${out}/40-deathmatch.png` });
// Look towards a bot for a gameplay screenshot
for (let i = 0; i < 20; i++) {
  s = await state();
  const alive = s.bots.filter((b) => b.alive);
  const vi = alive.findIndex((b) => b.visibleToPlayer);
  if (vi >= 0) {
    await dbg('aimAtBot', [vi, 'body']);
    break;
  }
  await wait(300);
}
await wait(100);
await page.screenshot({ path: `${out}/41-deathmatch-contact.png` });
s = await state();
check('fps measured', s.fps > 0, `fps=${s.fps} (SwiftShader software rendering) drawCalls=${s.drawCalls} activeMeshes=${s.meshes}`);

// Fire a few shots so the session is worth saving, then end → report saved
await dbg('key', ['fire', true]);
await waitGame(0.4);
await dbg('key', ['fire', false]);
await page.evaluate(() => window.__TAL__.end());
await wait(500);
await page.screenshot({ path: `${out}/50-report.png` });
const sessions = await page.evaluate(() => JSON.parse(localStorage.getItem('tal:v1:sessions') ?? '[]').length);
check('sessions persisted to localStorage', sessions >= 1, `count=${sessions}`);

await page.goto(base);
await page.getByRole('button', { name: 'Statistics', exact: true }).click();
await wait(400);
await page.screenshot({ path: `${out}/51-statistics.png` });

// Google Fonts are unreachable from the sandbox; ignore network failures for them.
const relevantErrors = errors.filter((e) => !/favicon|fonts\.g|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(e));
check('no page errors', relevantErrors.length === 0, relevantErrors.slice(0, 5).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
