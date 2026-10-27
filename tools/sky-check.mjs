// Pixel-level checks on the black-hole pass. Eyes are unreliable at this scale:
// "is the shadow actually black" and "is a meteor on screen right now" are both
// questions a histogram answers better than a screenshot review.
//
//   node tools/sky-check.mjs [--time 12.5]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const atTime = Number(arg('time', '3.4'));

const browser = await puppeteer.launch({
  protocolTimeout: 240000,
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: [
    '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars',
  ],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://127.0.0.1:5173/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));

const report = await page.evaluate(async (t) => {
  const s = window.__slots;
  const h = s.stage.hole;
  const stage = s.stage;

  // Freeze the loop and strip everything that is not sky.
  s.REST.hidden = true;
  s.REST.paused = true;
  s.machine.root.visible = false;
  document.querySelector('.hud').style.display = 'none';
  document.querySelector('.vignette').style.display = 'none';
  stage.bloom.strength = 0;
  stage.bloomTarget = 0;

  /** Render the sky at a pinned time and read the whole target back. */
  const grab = (time) => {
    h.update(time, 0);
    h.render();
    const { x: w, y: ht } = h.target;
    const buf = new Uint16Array(w * ht * 4);
    stage.renderer.readRenderTargetPixels(h.target, 0, 0, w, ht, buf);
    // Half-float decode is wasteful; instead read the composer output.
    return null;
  };

  // Simpler and closer to what a viewer sees: let the canvas keep the frame and
  // use drawImage into a 2D canvas to get 8-bit sRGB values back.
  const sample = (time) => {
    h.update(time, 0);
    h.render();
    stage.composer.render();
    const gl = stage.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = gl.width;
    c.height = gl.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(gl, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  };

  // --- shadow blackness, sampled on the shadow's own screen footprint -------
  const img = sample(t);
  const W = img.width;
  const H = img.height;
  const d = img.data;
  // getImageData is already top-down, matching the coordinate space the debug
  // overlay is drawn in; flipping here would sample a mirrored point.
  const at = (x, y) => {
    const i = (y * W + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };

  const tanHalf = h.tanHalf;
  const shadowUvR = Math.tan(Math.asin(2.59807621135 / h.distance)) / tanHalf;
  const shadowUvX = h.material.uniforms.uPan.value.x;
  const shadowUvY = h.material.uniforms.uPan.value.y;
  const cx = (shadowUvX * 0.5 + 0.5) * W;
  // uv.y grows upward, screen rows grow downward.
  const cy = (0.5 - shadowUvY * 0.5) * H;
  const rad = shadowUvR * 0.5 * H;

  // Sample the upper half of the shadow only: the disc's near edge crosses the
  // lower half by design, and including it would measure the disc, not the hole.
  let innerSum = 0; let innerMax = 0; let innerN = 0;
  for (let y = Math.round(cy - rad * 0.62); y < cy - rad * 0.10; y += 2) {
    for (let x = Math.round(cx - rad * 0.45); x < cx + rad * 0.45; x += 2) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const [r, g, b] = at(x, y);
      const lum = (r + g + b) / 3;
      innerSum += lum; innerMax = Math.max(innerMax, lum); innerN++;
    }
  }

  // Dump the frame with the measurement box drawn on it: when a check fails the
  // first question is always "is the box where I think it is".
  const dbg = document.createElement('canvas');
  dbg.width = W; dbg.height = H;
  const dctx = dbg.getContext('2d');
  dctx.putImageData(img, 0, 0);
  dctx.strokeStyle = '#ff0000';
  dctx.lineWidth = 2;
  dctx.strokeRect(cx - rad * 0.45, cy - rad * 0.62, rad * 0.9, rad * 0.52);
  dctx.strokeStyle = '#00ff00';
  dctx.beginPath();
  dctx.arc(cx, cy, rad, 0, Math.PI * 2);
  dctx.stroke();
  window.__skyDebug = dbg.toDataURL('image/png');

  // --- meteors ------------------------------------------------------------
  // Two things make this awkward: a WebGL canvas readback can hand back the
  // last *presented* frame, and the disc is bright enough to swamp any global
  // brightness count. So: render the sky alone (disc gain zeroed) into a small
  // byte target, and measure the *difference* between consecutive instants.
  // Stars are fixed in direction, so with the disc gone any change is a meteor.
  const THREE = await import('/vendor/three.module.js');
  const probe = new THREE.WebGLRenderTarget(320, 200, {
    type: THREE.UnsignedByteType, depthBuffer: false,
  });
  const pxA = new Uint8Array(320 * 200 * 4);
  const pxB = new Uint8Array(320 * 200 * 4);
  const res = h.material.uniforms.uResolution;
  const savedRes = res.value.clone();
  const savedDisc = h.material.uniforms.uDiscGain.value;
  res.value.set(320, 200);
  h.material.uniforms.uDiscGain.value = 0;

  const shoot = (buf) => {
    stage.renderer.setRenderTarget(probe);
    stage.renderer.clear();
    stage.renderer.render(h.scene, h.camera);
    stage.renderer.readRenderTargetPixels(probe, 0, 0, 320, 200, buf);
    stage.renderer.setRenderTarget(null);
  };

  const meteorFrames = [];
  const samples = [];
  let prevSum = 0;
  for (let k = 0; k < 64; k++) {
    const tt = k * 0.5;
    h.update(tt, 0);
    shoot(pxA);
    h.update(tt + 0.06, 0);
    shoot(pxB);
    let changed = 0;
    let sum = 0;
    for (let i = 0; i < pxA.length; i += 4) {
      const diff = Math.abs(pxA[i] - pxB[i]) + Math.abs(pxA[i + 1] - pxB[i + 1]);
      sum += diff;
      if (diff > 40) changed++;
    }
    // Rate of change, not absolute level: the sky's own subtle drift is tiny.
    if (changed > 6) meteorFrames.push({ t: tt, changed });
    if (k % 8 === 0) samples.push({ t: tt, changed });
    prevSum = sum;
  }
  h.material.uniforms.uDiscGain.value = savedDisc;
  res.value.copy(savedRes);
  probe.dispose();

  let peak = 0; let lit = 0; let litFar = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const [r, g, b] = at(x, y);
      const lum = (r + g + b) / 3;
      peak = Math.max(peak, lum);
      if (lum > 30) lit++;
      const dx = (x - cx) / Math.max(1, W * 0.5);
      const dy = (y - cy) / Math.max(1, H * 0.5);
      if (dx * dx + dy * dy > 0.9) litFar++;
    }
  }

  return {
    debug: window.__skyDebug,
    shadow: { cx: Math.round(cx), cy: Math.round(cy), r: Math.round(rad) },
    box: {
      x0: Math.round(cx - rad * 0.45), x1: Math.round(cx + rad * 0.45),
      y0: Math.round(cy - rad * 0.62), y1: Math.round(cy - rad * 0.10),
    },
    innerMean: innerSum / Math.max(1, innerN),
    innerMax,
    meteorFrames, samples,
    peak, lit, litFar,
    size: [W, H],
  };
}, atTime);

const dbgUrl = report.debug;
if (dbgUrl) {
  const b64 = dbgUrl.split(',')[1];
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir('shots', { recursive: true });
  await writeFile('shots/sky-debug.png', Buffer.from(b64, 'base64'));
}
await browser.close();

const results = [];
const check = (ok, name, detail) => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — ${detail}`);
};

console.log('samples', JSON.stringify(report.samples));
console.log('shadow', JSON.stringify(report.shadow), 'box', JSON.stringify(report.box), 'size', report.size);
check(
  report.innerMean < 14 && report.innerMax < 90,
  'shadow interior stays black',
  `mean ${report.innerMean.toFixed(1)}, max ${report.innerMax.toFixed(0)} luma`,
);
check(report.peak > 170, 'disc has a hot core', `peak ${report.peak.toFixed(0)} luma`);
check(report.lit > 300, 'the frame is not empty', `${report.lit} lit samples`);
check(report.litFar > 60, 'stars reach the corners', `${report.litFar} lit samples away from the hole`);
check(
  report.meteorFrames.length > 0 && report.meteorFrames.length < 48,
  'meteors appear now and then, not constantly',
  `${report.meteorFrames.length}/64 sampled half-seconds carry one: ${JSON.stringify(report.meteorFrames.slice(0, 5))}`,
);

if (errors.length) console.log('page errors:', errors.slice(0, 3));
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} sky checks passed`);
process.exit(passed === results.length ? 0 : 1);
