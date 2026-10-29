// Renders the same lab frame with several override sets, side by side in one
// browser session, and tiles the results into a contact sheet.
//
//   node tools/lab-batch.mjs --size 640x400 --tag tune \
//     --variants 'uDiscGain=1.2|uDiscGain=1.8,uOpacity=5'
//
// One browser and one page for the whole sweep: launching Chromium and
// compiling the shader dominates the cost, so re-using the page is what makes a
// sweep of six variants cheaper than three one-off shots.
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const [W, H] = (arg('size', '640x400')).split('x').map(Number);
const tag = arg('tag', 'batch');
const variants = arg('variants', '').split('|').filter(Boolean);
const frames = Number(arg('frames', '6'));

await mkdir('shots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  protocolTimeout: 900000,
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

await page.goto(`http://127.0.0.1:5173/tools/hole-lab.html?w=${W}&h=${H}&frames=${frames}`,
  { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__lab?.drawn === true, { timeout: 180000, polling: 250 });

const shots = [];
for (let i = 0; i < variants.length; i++) {
  const spec = variants[i];
  await page.evaluate((setStr) => {
    const patch = {};
    for (const pair of setStr.split(',').filter(Boolean)) {
      const [k, v] = pair.split('=');
      patch[k] = v.includes(':') ? v.split(':').map(Number) : Number(v);
    }
    window.__lab.apply(patch);
  }, spec);
  const file = `shots/${tag}-${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: file });
  shots.push({ file, spec });
  console.log(`ok   ${file}  ${spec}`);
}

await browser.close();
console.log(JSON.stringify({ shots, logs }, null, 2));
