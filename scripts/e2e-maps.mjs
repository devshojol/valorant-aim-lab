/**
 * Smoke test every map: for each map and location, start an angle-hold session (attack + defend),
 * check bots spawn on valid spots and peek, then run a short deathmatch per map. Saves screenshots.
 *   node scripts/e2e-maps.mjs [baseUrl] [outDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(require.resolve('playwright', { paths: ['/usr/lib/node_modules', '/usr/local/lib/node_modules'] }));
}
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'e2e-maps';
fs.mkdirSync(out, { recursive: true });
const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME|fonts/.test(m.text())) errors.push(m.text());
});
const state = () => page.evaluate(() => window.__TAL__.debug.state());
async function waitGame(sec) {
  const t0 = (await state()).time;
  await page.waitForFunction((t) => window.__TAL__.debug.state().time >= t, t0 + sec, { timeout: 120000, polling: 100 });
}
async function start(cfg) {
  await page.goto(base);
  await page.evaluate((c) => localStorage.setItem('tal:v1:practice', JSON.stringify(c)), cfg);
  await page.goto(base);
  await page.getByRole('button', { name: /Quick practice/i }).click();
  await page.waitForFunction(() => window.__TAL__ && window.__TAL__.status === 'ready', null, { timeout: 90000 });
  await page.evaluate(() => window.__TAL__.debug.forceRun());
}
const list = JSON.parse(process.env.MAPS ?? 'null') ?? [];
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
for (const { id, locations } of list) {
  for (const [i, loc] of locations.entries()) {
    for (const side of ['attack', 'defend']) {
      await start({ mapId: id, locationId: loc, side, playerSpawnId: '', enemySpotIds: [], mode: 'angle-hold', behavior: 'mixed', botCount: 3, difficulty: 'hard', botsShootBack: false, durationSec: 0, primary: 'vandal', secondary: 'classic' });
      // sample for ~6 s of game time: some bot must peek into view
      let seen = false;
      const t0 = (await state()).time;
      let s = await state();
      while (s.time - t0 < 6 && !seen) {
        await page.waitForTimeout(150);
        s = await state();
        seen = s.bots.some((b) => b.visibleToPlayer);
      }
      check(`${id}/${loc}/${side}`, s.bots.length >= 3 && seen, `bots=${s.bots.length} skipped-for-this-spawn=${s.unusableSpots.length} states=${s.bots.map((b) => b.brain).join(',')}`);
      if (i === 0 && side === 'attack') await page.screenshot({ path: `${out}/${id}-${loc}-${side}.png` });
    }
  }
  await start({ mapId: id, locationId: locations[0], side: 'attack', playerSpawnId: '', enemySpotIds: [], mode: 'deathmatch', behavior: 'mixed', botCount: 5, difficulty: 'normal', botsShootBack: true, durationSec: 0, primary: 'vandal', secondary: 'classic' });
  await page.evaluate(() => window.__TAL__.debug.godMode(true));
  const p0 = (await state()).bots.map((b) => b.pos);
  await waitGame(5);
  const s = await state();
  const moved = s.bots.filter((b, k) => Math.hypot(b.pos[0] - p0[k][0], b.pos[2] - p0[k][2]) > 3).length;
  check(`${id}/deathmatch`, moved >= 3, `moved=${moved}/5 fps=${s.fps} drawCalls=${s.drawCalls}`);
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
process.exit(failures ? 1 : 0);
