// Screenshots the black-hole pass on its own, so the sky can be tuned without
// the machine, HUD and vignette in the way.
//
//   node tools/shot-hole.mjs --out shots/hole.png [--size 1600x1000]
//   node tools/shot-hole.mjs --set elevation=0.14,outer=7 --out shots/x.png
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const [W, H] = (arg('size', '1600x1000')).split('x').map(Number);
const out = arg('out', 'shots/hole.png');
const waits = Number(arg('wait', 4500));
const set = arg('set', '');

await mkdir(dirname(resolve(out)), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: [
    '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars',
    `--window-size=${W},${H}`, '--force-device-scale-factor=1',
  ],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });

await page.goto('http://127.0.0.1:5173/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

await page.evaluate((setStr) => {
  const s = window.__slots;
  s.machine.root.visible = false;
  document.querySelector('.hud').style.display = 'none';
  document.querySelector('.vignette').style.display = 'none';
  for (const pair of setStr.split(',').filter(Boolean)) {
    const [k, v] = pair.split('=');
    const target = k in s.stage.hole ? s.stage.hole : s.stage.hole.material.uniforms[k];
    if (target && typeof target === 'object' && 'value' in target) target.value = Number(v);
    else s.stage.hole[k] = Number(v);
  }
  s.stage.resize();
}, set);

await new Promise((r) => setTimeout(r, waits));
await page.screenshot({ path: out });
await browser.close();
// Shader compile errors do not throw: they log to the console and leave the
// canvas black. A black frame is exactly what a correct black hole looks like
// from some framings, so a screenshot alone cannot tell the two apart — exit
// non-zero so a broken shader can never pass as a finished render.
const shaderErrors = logs.filter((l) => /ERROR:|undeclared identifier|shader/i.test(l));
if (shaderErrors.length) {
  console.log(JSON.stringify({ out, logs }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ out, logs }));
}
