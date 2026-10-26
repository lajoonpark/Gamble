import * as THREE from 'three';
import { Stage } from './stage.js';
import { SlotMachine } from './machine.js';
import { Effects } from './effects.js';
import { Tweens, clamp, easeOutQuart } from './util.js';
import {
  SlotGame, localStore, dust, START_BALANCE, SYMBOLS,
  STRIPS, STRIP_LENGTH, evaluate,
} from './game.js';
import { bannerTexture } from './textures.js';

const DEFAULT_PARAMS = new URLSearchParams(location.search);
const AUTOPLAY = DEFAULT_PARAMS.has('autoplay');
const SEED = DEFAULT_PARAMS.get('seed');

const tweens = new Tweens();
const stage = new Stage(document.getElementById('stage'), { tweens });
const machine = new SlotMachine({ tweens });
stage.scene.add(machine.root);

const effects = new Effects(stage.scene, machine);

let rng = Math.random;
if (SEED) {
  const { mulberry32 } = await import('./game.js');
  rng = mulberry32(Number(SEED));
}

const game = new SlotGame({ rng, store: localStore() });

// ------------------------------------------------------------------ HUD

const hud = {
  spins: document.getElementById('hud-spins'),
  peak: document.getElementById('hud-peak'),
  reset: document.getElementById('reset'),
  status: document.getElementById('status'),
  hint: document.getElementById('hint'),
};

let banner = null;
let bannerTimer = null;

function makeBanner() {
  const tex = bannerTexture('WIN', '');
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, toneMapped: false, depthWrite: false, opacity: 0,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.81), mat);
  mesh.position.set(0, 0.42, 1.5);
  mesh.visible = false;
  stage.scene.add(mesh);
  banner = { mesh, mat, tex };
}

function showBanner(text, sub, color, dur = 1.7) {
  if (!banner) makeBanner();
  banner.mat.map.dispose();
  banner.mat.map = bannerTexture(text, sub, color);
  banner.mesh.visible = true;
  banner.baseY = 0.42;

  if (bannerTimer) bannerTimer.done = true;
  bannerTimer = tweens.add({
    dur,
    from: 0,
    to: 1,
    ease: (t) => t,
    onUpdate: (v) => {
      // pop up, hold, drift away
      const a = v < 0.12 ? v / 0.12 : v > 0.75 ? 1 - (v - 0.75) / 0.25 : 1;
      banner.mat.opacity = clamp(a, 0, 1);
      const s = 0.7 + easeOutQuart(clamp(v / 0.18)) * 0.3;
      banner.mesh.scale.set(s * (1 + v * 0.05), s * (1 + v * 0.05), 1);
      banner.mesh.position.y = banner.baseY + v * 0.16;
      banner.mesh.rotation.z = Math.sin(v * 6) * 0.02 * (1 - v);
    },
    onDone: () => { banner.mesh.visible = false; },
  });
}

function showBalance(balance, bet, busted) {
  machine.setBalance(balance, bet, busted);
  document.body.classList.toggle('busted', busted);
  hud.status.textContent = busted ? 'OUT OF STARDUST' : '';
  if (busted) hud.hint.textContent = 'Press Reset (R) to start again with 100 stardust';
}

function setHud() {
  const busted = game.busted;
  hud.spins.textContent = String(game.spins);
  hud.peak.textContent = dust(game.bestSeen, 0);
  document.body.classList.toggle('busted', busted);
  hud.status.textContent = busted ? 'OUT OF STARDUST' : '';
  machine.setBalance(game.balance, game.bet, busted);
  if (busted) {
    hud.hint.textContent = 'Press Reset (R) to start again with 100 stardust';
  } else {
    hud.hint.textContent = 'Click the machine, pull the lever, or press Space';
  }
}

// --------------------------------------------------------------- flow

let busy = false;
let pullQueued = false;

async function pull() {
  // Taking over mid-demo: the reels keep turning, but the stake and payout
  // come from the real spin that follows.
  if (attractSpin) { stopAttract(); pullQueued = true; return; }
  if (busy) { pullQueued = true; return; }
  if (!game.ready) return;

  busy = true;
  machine.hover = false;

  const result = game.pull();
  if (!result) { busy = false; return; }
  // Show the stake leaving the balance, but hold the payout back until the
  // reels have actually stopped.
  showBalance(result.balanceAfterBet, result.bet, false);

  machine.pullLever();
  effects.sparkBurst({
    count: 22, color: '#cfe4ff', power: 0.85,
    at: new THREE.Vector3(2.7, 2.3, 1.0), size: 0.17, ttl: 0.65,
  });
  tweens.add({ dur: 0.34, from: 0, to: 1, ease: easeOutQuart, onUpdate: (v) => { stage.setExcite(v); } });

  await spinReels(result);

  await resolve(result);
  busy = false;
  if (pullQueued) {
    pullQueued = false;
    pull();
  }
}

async function spinReels(result) {
  const anticipation = result.anticipation;
  if (anticipation) {
    // Hold the glow before the third reel drops.
    machine.excite = 1;
    effects.sparkBurst({ count: 26, color: '#dfeeff', power: 0.65, ttl: 1.4 });
  }
  await machine.spin({
    stops: result.stops,
    anticipation,
    onLand: (i) => effects.landPuff(i),
  });
}

machine.onReelLand = (i, teased) => {
  effects.landPuff(i);
  stage.impact(teased ? 1.5 : 0.8 + i * 0.12);
  if (teased) effects.screenFlash('#dfeeff', 0.08, 0.35);
};

async function resolve(result) {
  const { outcome } = result;
  setHud();
  showBalance(result.balanceAfter, result.bet, result.busted);

  if (outcome.kind === 'none') {
    machine.winGlow = 0;
    if (result.busted) return bustOut();
    return;
  }

  const sym = SYMBOLS[outcome.symbol];
  const isThree = outcome.kind === 'three';
  const mult = outcome.mult;

  let tier = 'small';
  if (isThree) {
    if (mult >= 100) tier = 'jackpot';
    else if (mult >= 20) tier = 'big';
    else if (mult >= 8) tier = 'medium';
  }

  machine.celebrate(tier);
  machine.flashBalance(sym.accent);
  stage.punchIn(tier === 'jackpot' ? 1 : tier === 'big' ? 0.75 : 0.4,
                tier === 'jackpot' ? 2.4 : tier === 'big' ? 1.8 : 1.2);

  // Which reels are part of the win?
  const winning = outcome.kind === 'three'
    ? [0, 1, 2]
    : result.line.map((s2, i) => (s2 === outcome.symbol ? i : -1)).filter((i) => i >= 0);
  machine.highlight(winning, sym.accent);

  if (tier === 'jackpot') {
    effects.jackpot();
    showBanner('JACKPOT', `${dust(result.gross)}  ·  ${mult}x`, '#ffd9a0', 2.8);
    await wait(0.65);
    effects.dustSpray(2.0, 140);
  } else if (tier === 'big') {
    effects.bigWin();
    showBanner('BIG WIN', `${dust(result.gross)}  ·  ${mult}x`, '#dfeeff', 2.1);
    await wait(0.35);
  } else if (tier === 'medium') {
    effects.mediumWin();
    showBanner(`3 ${sym.name.toUpperCase()}`, `${dust(result.gross)}  ·  ${mult}x`, sym.accent, 1.7);
    await wait(0.25);
  } else {
    effects.smallWin();
    showBanner(isThree ? `3 ${sym.name.toUpperCase()}` : 'PAIR', `+${dust(result.gross)}`, sym.accent, 1.25);
    await wait(0.18);
  }

  setHud();
  if (result.busted) await bustOut();
}

function bustOut() {
  showBanner('EMPTY', 'PRESS RESET', '#ff8fa0', 2.2);
  effects.screenFlash('#ff6a80', 0.12, 0.5);
  document.body.classList.add('busted');
  hud.status.textContent = 'OUT OF CREDIT';
}

function wait(sec) {
  return tweens.wait(sec);
}

function resetGame() {
  game.reset(START_BALANCE);
  setHud();
  machine.flashBalance('#5f9cff');
  effects.ring({ color: 0xdfeeff, dur: 0.8, scale: 4.2 });
  showBanner('100', 'WELCOME BACK', '#5f9cff', 1.3);
}

// ------------------------------------------------------------- input

const pointer = new THREE.Vector2(0, 0);

function updatePointer(e) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const nx = (e.clientX / w) * 2 - 1;
  const ny = (e.clientY / h) * 2 - 1;
  pointer.set(nx, ny);
  machine.setTilt(nx, ny * 0.8);
  stage.setPointer(nx, ny);
  machine.setPointerHover(true);
}

window.addEventListener('pointermove', (e) => updatePointer(e));
window.addEventListener('pointerleave', () => {
  machine.setTilt(0, 0);
  stage.setPointer(0, 0);
  machine.setPointerHover(false);
});

const canvas = stage.renderer.domElement;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pull();
});

// Clicking the lever itself gives the same result, with a bit more punch.
canvas.addEventListener('pointerup', () => {});

hud.reset.addEventListener('click', (e) => {
  e.stopPropagation();
  resetGame();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    pull();
  } else if (e.key === 'r' || e.key === 'R') {
    resetGame();
  } else if (e.key === 'h' || e.key === 'H') {
    document.body.classList.toggle('chrome-hidden');
  }
});

// ------------------------------------------------------------------ rest

/**
 * A wallpaper must not burn a laptop all afternoon. Three signals stop the
 * render loop:
 *   - the page is hidden (another Space / another tab),
 *   - a window covers most of the work area,
 *   - the battery is low and unplugged.
 * Occlusion is approximated from the browser's own visibility plus a mouse-over
 * test: browsers do not expose another app's window rects to a web page, so we
 * treat "the pointer is over someone else's window and has been idle" as
 * covered. `navigator.getBattery` covers the low-power case where supported.
 */
const REST = {
  covered: false,      // >80% of the screen is behind another window
  lowPower: false,     // on battery and low, or user has reduced motion
  hidden: false,       // tab/window not visible
  paused: false,
  reason: '',
};

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || REST.lowPower) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* not permitted; keep running without it */ }
}

async function watchBattery() {
  if (!navigator.getBattery) return;
  try {
    const bat = await navigator.getBattery();
    const read = () => {
      REST.lowPower = !bat.charging && bat.level <= 0.2;
      applyRest();
    };
    bat.addEventListener('levelchange', read);
    bat.addEventListener('chargingchange', read);
    read();
  } catch { /* unsupported */ }
}

function applyRest() {
  const paused = REST.covered || REST.hidden || REST.lowPower;
  REST.paused = paused;
  REST.reason = REST.hidden ? 'hidden'
    : REST.covered ? 'covered'
      : REST.lowPower ? 'low power' : '';
  document.body.classList.toggle('resting', paused);
  if (paused) {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  } else {
    requestWakeLock();
  }
}

/**
 * The page cannot see other applications' windows, but it can tell when the
 * pointer is somewhere other than this window. Combined with a lack of input
 * for a while, that is the best available "another window is on top" signal.
 */
let pointerInside = true;
window.addEventListener('pointerenter', () => { pointerInside = true; });
window.addEventListener('pointerleave', () => { pointerInside = false; });
document.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget) pointerInside = false;
});

document.addEventListener('visibilitychange', () => {
  REST.hidden = document.visibilityState !== 'visible';
  applyRest();
});

// Without an experimental API there is no true coverage figure, so treat a
// long-idle pointer outside this window as "covered" rather than guessing.
const COVERED_AFTER = 45;
let outsideFor = 0;

watchBattery();
requestWakeLock();
applyRest();

// ------------------------------------------------------------------ attract

// A wallpaper has to look alive from across the room. After a stretch with no
// input the machine spins itself; the first cursor move or keypress hands
// control straight back, and self-spins never touch the player's balance.
const IDLE_AFTER = 14;      // seconds of stillness before the demo starts
let idleFor = 0;
let attractSpin = null;

function noteInput() {
  idleFor = 0;
}

/**
 * Mark the running demo spin as abandoned. `busy` stays set so any further
 * clicks queue behind it; the demo hands control back when its reels stop.
 */
function stopAttract() {
  if (!attractSpin) return false;
  attractSpin.cancelled = true;
  attractSpin = null;
  return true;
}

window.addEventListener('pointermove', noteInput, { passive: true });
window.addEventListener('pointerdown', noteInput, { passive: true });
window.addEventListener('keydown', noteInput, { passive: true });
window.addEventListener('wheel', noteInput, { passive: true });

/** One decorative spin: no stake, no payout, no history. */
async function attract() {
  if (busy) return;
  const token = { cancelled: false };
  attractSpin = token;
  const line = [0, 1, 2].map((i) => STRIPS[i][Math.floor(rng() * STRIP_LENGTH)]);
  const stops = line.map((sym, i) => STRIPS[i].indexOf(sym));
  busy = true;
  await machine.spin({ stops });
  busy = false;
  if (token.cancelled) {
    // A player interrupted the demo: run their spin now that the reels are free.
    if (pullQueued) { pullQueued = false; pull(); }
    return;
  }
  const outcome = evaluate(line);
  if (outcome.kind !== 'none') {
    const sym = SYMBOLS[outcome.symbol];
    machine.highlight(
      outcome.kind === 'three'
        ? [0, 1, 2]
        : line.map((s2, i) => (s2 === outcome.symbol ? i : -1)).filter((i) => i >= 0),
      sym.accent,
    );
    effects.sparkBurst({ color: sym.accent, power: 0.7, count: 36 });
  }
  attractSpin = null;
}

// ------------------------------------------------------------------ loop

// `last` starts null rather than at performance.now(): the first rAF timestamp
// is taken against a different origin and can be *earlier* than a timestamp
// sampled at module evaluation, which yields a negative dt and sends every
// damp() and tween backwards.
let last = null;
let elapsed = 0;

function frame(now) {
  if (last === null) {
    last = now;
    requestAnimationFrame(frame);
    return;
  }

  // Clamp both ends: negative dt would run the simulation backwards, and a huge
  // one (after a pause or a tab switch) would teleport every animation.
  const dt = Math.min(Math.max((now - last) / 1000, 0), 1 / 20);
  last = now;

  if (REST.paused) {
    // Idle repaint only: no simulation, no compositing work.
    requestAnimationFrame(frame);
    return;
  }

  elapsed += dt;

  outsideFor = pointerInside ? 0 : outsideFor + dt;
  const covered = outsideFor > COVERED_AFTER;
  if (covered !== REST.covered) {
    REST.covered = covered;
    applyRest();
  }

  idleFor += dt;
  if (idleFor > IDLE_AFTER && !busy && !attractSpin && game.ready) {
    idleFor = IDLE_AFTER - 3.2;   // stagger the next demo spin
    attract();
  }

  tweens.update(dt);
  machine.update(dt);
  effects.update(dt);
  stage.update(dt, elapsed);
  if (banner) {
    // Fully cancel the machine's tilt: a half-cancel left the plane at a
    // grazing angle where its edge cut across the cabinet.
    banner.mesh.rotation.y = -machine.root.rotation.y;
    banner.mesh.rotation.x = -machine.root.rotation.x;
  }
  stage.render();
  requestAnimationFrame(frame);
}

setHud();
requestAnimationFrame(frame);

// Autoplay is a testing aid: `?autoplay=1` spins continuously.
if (AUTOPLAY) {
  const loop = async () => {
    while (true) {
      if (!game.ready) game.reset(START_BALANCE);
      await pull();
      await wait(0.9);
    }
  };
  loop();
}

window.__slots = { game, machine, stage, effects, pull, resetGame, setHud, showBalance, showBanner, attract, tweens, REST };
