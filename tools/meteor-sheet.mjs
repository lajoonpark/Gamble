// Renders the sky at a run of scene times and stitches the frames into one
// contact sheet, so meteors can be confirmed by eye. Threshold counts kept
// missing them: they are thin, brief, and rare by design.
//
//   node tools/meteor-sheet.mjs 0 1 2 3 6 9
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';

const times = process.argv.slice(2).map(Number);
const at = times.length ? times : [0, 1, 2, 3, 6, 9];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  protocolTimeout: 240000,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader'],
  defaultViewport: { width: 720, height: 450 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto('http://127.0.0.1:5173/index.html', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2500));

// Pause the app loop and drive frames by hand. Leaving it running means the
// scene clock advances between the jump and the screenshot, so a meteor that
// is scheduled to last 0.8 s can be over before the capture lands.
await page.evaluate(() => {
  const s = window.__slots;
  s.REST.paused = true;
  s.machine.root.visible = false;
  document.querySelector('.hud').style.display = 'none';
  document.querySelector('.vignette').style.display = 'none';
  s.stage.bloom.strength = 0;
  s.stage.bloomTarget = 0;
});

const tiles = [];
for (let i = 0; i < at.length; i++) {
  await page.evaluate((t) => {
    const s = window.__slots;
    s.stage.hole.update(t, 0);
    s.stage.hole.resetAccumulation();
    s.stage.render();
  }, at[i]);
  await new Promise((r) => setTimeout(r, 250));
  const file = `/tmp/meteor-${i}.png`;
  await page.screenshot({ path: file });
  tiles.push(file);
}
await browser.close();

const out = 'shots/meteor-sheet.png';
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
files = sys.argv[1:-1]
out = sys.argv[-1]
times = sys.argv[-1].split(',')
ims = [Image.open(f) for f in files]
w, h = ims[0].size
cols = 3
sheet = Image.new('RGB', (w * cols, h * ((len(ims) + cols - 1) // cols)), 'black')
d = ImageDraw.Draw(sheet)
for i, im in enumerate(ims):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y))
    d.text((x + 8, y + 6), 'frame %d' % i, fill=(150, 205, 255))
sheet.save(out)
`, ...tiles, out]);
console.log('wrote', out);
