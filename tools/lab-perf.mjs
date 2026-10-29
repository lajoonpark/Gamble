// Times the black-hole pass at the wallpaper's own resolution budget.
//
// The lab renders a few frames and reports ms per frame, which is the only
// number that matters for the wallpaper: it has to hold ~30 fps while the disc
// march runs on every pixel that crosses the plane.
//
//   node tools/lab-perf.mjs --size 900x560 --frames 12
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const [W, H] = arg('size', '900x560').split('x').map(Number);
const N = Number(arg('frames', '12'));

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
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://127.0.0.1:5173/tools/hole-lab.html?w=${W}&h=${H}&frames=1`,
  { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__lab?.drawn === true, { timeout: 180000, polling: 250 });

const ms = await page.evaluate((n) => {
  window.__lab.hole.resetAccumulation();
  // First frame pays shader compile and the readback warm-up; drop it.
  window.__lab.apply({ t: 3.4, excite: 0 });
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    window.__lab.hole.update(3.4 + i * 0.016, 0);
    window.__lab.hole.render();
    window.__lab.renderer.getContext().finish();
  }
  // getContext().finish() only orders the GL queue, so force a real sync with
  // a 1-pixel readback -- otherwise the timer stops before the GPU is done.
  const gl = window.__lab.renderer.getContext();
  const px = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return (performance.now() - t0) / n;
}, N);

console.log(JSON.stringify({ size: `${W}x${H}`, frames: N, msPerFrame: +ms.toFixed(1) }));
await browser.close();
