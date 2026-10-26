import * as THREE from 'three';
import { Stage } from './stage.js';
import { SlotMachine } from './machine.js';
import { Effects } from './effects.js';
import { Tweens, clamp, easeOutQuart } from './util.js';
import {
  SlotGame, localStore, money, START_BALANCE, SYMBOLS,
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
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.05), mat);
  mesh.position.set(0, -1.30, 1.62);
  mesh.visible = false;
  stage.scene.add(mesh);
  banner = { mesh, mat, tex };
}

function showBanner(text, sub, color, dur = 1.7) {
  if (!banner) makeBanner();
  banner.mat.map.dispose();
  banner.mat.map = bannerTexture(text, sub, color);
  banner.mesh.visible = true;
  banner.baseY = -1.30;

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
  hud.status.textContent = busted ? 'OUT OF CREDIT' : '';
  if (busted) hud.hint.textContent = 'Press Reset (R) to start again with $100';
}

function setHud() {
  const busted = game.busted;
  hud.spins.textContent = String(game.spins);
  hud.peak.textContent = money(game.bestSeen, 0);
  document.body.classList.toggle('busted', busted);
  hud.status.textContent = busted ? 'OUT OF CREDIT' : '';
  machine.setBalance(game.balance, game.bet, busted);
  if (busted) {
    hud.hint.textContent = 'Press Reset (R) to start again with $100';
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
    count: 26, color: '#ff9db0', power: 0.9,
    at: new THREE.Vector3(2.9, 2.4, 1.0), size: 0.2, ttl: 0.7,
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
    effects.sparkBurst({ count: 30, color: '#ffe27a', power: 0.7, ttl: 1.4 });
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
  if (teased) effects.screenFlash('#fff0b0', 0.12, 0.35);
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
    showBanner('JACKPOT!', `${money(result.gross)}  ·  ${mult}×`, '#fff0a0', 2.8);
    await wait(0.65);
    effects.coinSpray(2.2, 150);
  } else if (tier === 'big') {
    effects.bigWin();
    showBanner('BIG WIN', `${money(result.gross)}  ·  ${mult}×`, '#ffe27a', 2.1);
    await wait(0.35);
  } else if (tier === 'medium') {
    effects.mediumWin();
    showBanner(`3× ${sym.name.toUpperCase()}`, `${money(result.gross)}  ·  ${mult}×`, sym.accent, 1.7);
    await wait(0.25);
  } else {
    effects.smallWin();
    showBanner(isThree ? `3× ${sym.name.toUpperCase()}` : 'PAIR', `+${money(result.gross)}`, sym.accent, 1.25);
    await wait(0.18);
  }

  setHud();
  if (result.busted) await bustOut();
}

function bustOut() {
  showBanner('BUSTED', 'PRESS RESET', '#ff4060', 2.2);
  effects.screenFlash('#ff2040', 0.18, 0.5);
  document.body.classList.add('busted');
  hud.status.textContent = 'OUT OF CREDIT';
}

function wait(sec) {
  return tweens.wait(sec);
}

function resetGame() {
  game.reset(START_BALANCE);
  setHud();
  machine.flashBalance('#7ce8ff');
  effects.ring({ color: 0x7ce8ff, dur: 0.8, scale: 4.2 });
  showBanner('$100', 'GOOD LUCK', '#7ce8ff', 1.3);
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
    effects.sparkBurst({ color: sym.accent, power: 0.7, count: 40 });
  }
  attractSpin = null;
}

// ------------------------------------------------------------------ loop

let last = performance.now();
let elapsed = 0;

function frame(now) {
  const dtRaw = (now - last) / 1000;
  last = now;
  const dt = Math.min(dtRaw, 1 / 20);
  elapsed += dt;

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

window.__slots = { game, machine, stage, effects, pull, resetGame, setHud, showBalance, attract, tweens };
