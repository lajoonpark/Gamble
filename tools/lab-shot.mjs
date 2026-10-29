// Screenshots tools/hole-lab.html with a set of overrides, for iterating on the
// accretion disc without booting the machine.
//
//   node tools/lab-shot.mjs --size 800x500 --out shots/lab.png \
//     --set outer=9,uDiscGain=1.2
//
// Values are parsed as numbers; "a:b" makes a vec2; unknown keys fall through to
// a property on the BlackHole instance, which is how framing is passed.
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const [W, H] = (arg('size', '800x500')).split('x').map(Number);
const out = arg('out', 'shots/lab.png');
const waits = Number(arg('wait', 26000));
const set = arg('set', '');
const frames = Number(arg('frames', '6'));
const t = arg('time', null);

await mkdir(dirname(resolve(out)), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  protocolTimeout: 600000,
  args: [
    '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars',
    '--force-device-scale-factor=1',
  ],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });

const url = `http://127.0.0.1:5173/tools/hole-lab.html?w=${W}&h=${H}&frames=${frames}`;
// domcontentloaded, not networkidle2: the lab starts its first readback right
// after load, and a software renderer can hold the page busy for a while.
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
// Wait for the deferred first render to finish before touching uniforms.
await page.waitForFunction(() => window.__lab?.drawn === true, { timeout: 180000, polling: 250 });

await page.evaluate((setStr, time) => {
  const patch = {};
  for (const pair of setStr.split(',').filter(Boolean)) {
    const [k, v] = pair.split('=');
    patch[k] = v.includes(':') ? v.split(':').map(Number) : Number(v);
  }
  if (time !== null) patch.t = Number(time);
  window.__lab.apply(patch);
}, set, t);

await new Promise((r) => setTimeout(r, waits));
await page.screenshot({ path: out });
await browser.close();

const shaderErrors = logs.filter((l) => /ERROR:|undeclared identifier|shader/i.test(l));
console.log(JSON.stringify({ out, logs: shaderErrors.length ? logs : [] }));
if (shaderErrors.length) process.exitCode = 1;
