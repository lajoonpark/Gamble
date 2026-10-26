// Headless screenshot harness.
//   node tools/shoot.mjs --out shots/a.png --wait 2500 [--query autoplay=1] [--size 1600x1000]
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const [W, H] = (arg('size', '1600x1000')).split('x').map(Number);
const out = arg('out', 'shots/shot.png');
await mkdir(dirname(resolve(out)), { recursive: true });
const waitMs = Number(arg('wait', 2200));
const query = arg('query', '');
const port = Number(arg('port', 5173));
const url = `http://127.0.0.1:${port}/index.html${query ? '?' + query : ''}`;
const evalJs = arg('eval', null);

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
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[404] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((r) => setTimeout(r, waitMs));
if (evalJs) await page.evaluate(evalJs);

// Report any WebGL/compile problems rather than silently saving a black frame.
const diag = await page.evaluate(() => ({
  title: document.title,
  canvas: !!document.querySelector('#stage canvas'),
  loader: document.getElementById('loader')?.textContent ?? null,
  balance: window.__slots?.game?.balance ?? null,
  spins: window.__slots?.game?.spins ?? null,
  busted: window.__slots?.game?.busted ?? null,
}));

await page.screenshot({ path: out });
await browser.close();

console.log(JSON.stringify({ out, diag, logs }, null, 1));
