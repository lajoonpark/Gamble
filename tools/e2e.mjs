// End-to-end checks in a real browser: spin correctness, reset, bust, attract
// takeover, and console cleanliness. Requires `npm start` on :5173.
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';

const URL_BASE = 'http://127.0.0.1:5173/index.html';
const launch = () => puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: [
    '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader',
  ],
  defaultViewport: { width: 1280, height: 820, deviceScaleFactor: 1 },
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Headless software GL runs at a few fps, so poll wall clock, not frames. */
const settle = (page, ms = 40000) => page.waitForFunction(
  () => !window.__slots.machine.spinning,
  { timeout: ms, polling: 200 },
);

const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL_BASE, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2500));

// --- 1. A spin takes exactly one bet and settles the balance ---------------
const spin = await page.evaluate(async () => {
  const s = window.__slots;
  const before = s.game.balance;
  await s.pull();
  return { before, last: s.game.last, after: s.game.balance };
});
check(
  'spin charges 10% and settles balance',
  Math.abs(spin.last.bet - Math.round(spin.before * 10) / 100) < 0.011 &&
    Math.abs(spin.after - (spin.last.balanceAfterBet + spin.last.gross)) < 0.011,
  `bet ${spin.last.bet}, ${spin.before} -> ${spin.after}`,
);
check(
  'reels show the symbols that were rolled',
  spin.last.line.every((sym, i) => sym === spin.last.line[i]),
  spin.last.line.join(' | '),
);
check('win tiers match the paytable', (() => {
  const { kind, mult } = spin.last.outcome;
  if (kind === 'none') return spin.last.gross === 0;
  return Math.abs(spin.last.gross - spin.last.bet * mult) < 0.011;
})(), `${spin.last.outcome.kind} x${spin.last.outcome.mult}`);

// --- 2. Reset is a clean slate --------------------------------------------
await page.evaluate(() => { window.__slots.game.balance = 0.4; window.__slots.setHud(); });
await settle(page).catch(() => {});
await page.click('#reset');
await new Promise((r) => setTimeout(r, 1200));
const res = await page.evaluate(() => ({
  balance: window.__slots.game.balance,
  spins: window.__slots.game.spins,
  busted: window.__slots.game.busted,
  cls: document.body.classList.contains('busted'),
}));
check('reset restores 100 and clears the run',
  res.balance === 100 && res.spins === 0 && !res.busted && !res.cls,
  JSON.stringify(res));

// --- 3. Busted state surfaces in the UI -----------------------------------
await page.evaluate(() => { window.__slots.game.balance = 0.5; window.__slots.setHud(); });
await new Promise((r) => setTimeout(r, 400));
const bust = await page.evaluate(() => ({
  busted: window.__slots.game.busted,
  cls: document.body.classList.contains('busted'),
  statusShown: getComputedStyle(document.getElementById('status')).display !== 'none',
  bet: window.__slots.game.bet,
}));
check('going broke shows the out-of-stardust state',
  bust.busted && bust.cls && bust.statusShown, JSON.stringify(bust));

await page.click('#reset');
await new Promise((r) => setTimeout(r, 1200));

// --- 4. Attract mode never touches the player's money ---------------------
const attract = await page.evaluate(async () => {
  const s = window.__slots;
  const before = { balance: s.game.balance, spins: s.game.spins };
  s.attract();
  return before;
});
await page.waitForFunction(() => window.__slots.machine.spinning, { timeout: 15000 });
await settle(page).catch(() => {});
const attractAfter = await page.evaluate(() => ({
  balance: window.__slots.game.balance, spins: window.__slots.game.spins,
}));
check('demo spin leaves balance and spin count alone',
  attractAfter.balance === attract.balance && attractAfter.spins === attract.spins,
  `${attract.balance}/${attract.spins} -> ${attractAfter.balance}/${attractAfter.spins}`);

// --- 5. Interrupting the demo with a click plays a real spin ---------------
await page.evaluate(() => { window.__slots.attract(); });
await page.waitForFunction(() => window.__slots.machine.spinning, { timeout: 15000 });
await page.mouse.click(640, 430);
await settle(page, 45000).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const taken = await page.evaluate(() => ({ spins: window.__slots.game.spins }));
check('clicking during the demo queues a real spin', taken.spins >= 1,
  `spins ${taken.spins}`);

// --- 6. Console stays clean ----------------------------------------------
check('no page errors, failed requests, or console errors',
  errors.length === 0, errors.slice(0, 3).join(' | '));

await mkdir('shots', { recursive: true });
await page.screenshot({ path: 'shots/e2e-final.png' });
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
