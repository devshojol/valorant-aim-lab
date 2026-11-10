/**
 * Builds a single self-contained HTML file with all JS/CSS inlined.
 *   node scripts/build-single.mjs            → dist-single/tactical-aim-lab.html (full document)
 *   node scripts/build-single.mjs --fragment → also writes a body fragment for hosts that add their own skeleton
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

execSync('npx vite build --config vite.single.config.ts', { stdio: 'inherit' });
const dir = 'dist-single';
const js = fs.readFileSync(path.join(dir, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(dir, 'app.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
const head = `<title>Tactical Aim Lab</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>${css}</style>`;
const body = `<div id="root"></div>
<script type="module">${js}</script>`;
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${head}
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(dir, 'tactical-aim-lab.html'), full);
if (process.argv.includes('--fragment')) fs.writeFileSync(path.join(dir, 'tactical-aim-lab.fragment.html'), `${head}\n${body}\n`);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log('single-file build:', kb(full.length));
