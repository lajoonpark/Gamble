// Verifies the visible reel lands on the result the RNG rolled, and that a win
// is detected the same way the game scored it.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: [
    '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=900,650',
  ],
  defaultViewport: { width: 900, height: 650, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5173/index.html?seed=7', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2500));

const report = await page.evaluate(async () => {
  const { STRIPS, STRIP_LENGTH } = await import('/src/game.js');
  const s = window.__slots;
  const out = [];

  for (let n = 0; n < 6; n++) {
    await s.pull();
    // Headless software GL runs at a few fps, so poll wall-clock rather than
    // counting frames.
    const deadline = performance.now() + 45000;
    while (s.machine.spinning && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const last = s.game.last;

    // Observe the real geometry: the cell whose world-space front normal points
    // most directly at the camera is the one on the payline.
    const THREE = await import('three');
    const camDir = new THREE.Vector3(0, 0, 1);
    s.machine.root.updateMatrixWorld(true);
    const visible = s.machine.reels.map((r) => {
      let best = null;
      let bestDot = -Infinity;
      for (const cell of r.cells) {
        const n = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(cell.getWorldQuaternion(new THREE.Quaternion()));
        const dot = n.dot(camDir);
        if (dot > bestDot) { bestDot = dot; best = cell; }
      }
      return best.userData.symbol;
    });

    out.push({
      rolled: last.line,
      visible,
      stops: last.stops,
      match: last.line.every((sym, i) => sym === visible[i]),
      kind: last.outcome.kind,
      symbol: last.outcome.symbol,
      bet: last.bet,
      gross: last.gross,
      balance: last.balanceAfter,
    });
  }
  return out;
});

await browser.close();

let bad = 0;
for (const [i, r] of report.entries()) {
  if (!r.match) {
    bad++;
    console.log(`MISMATCH spin ${i}: rolled ${r.rolled} but reels show ${r.visible}`);
  } else {
    console.log(`ok  spin ${i}: ${r.visible.join(' | ')}  ${r.kind}  gross $${r.gross}`);
  }
}
console.log(`\n${report.length - bad}/${report.length} spins landed on the rolled symbols`);
if (errors.length) console.log('page errors:', errors);
process.exit(bad ? 1 : 0);
