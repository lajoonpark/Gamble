import * as THREE from 'three';
import { SYMBOLS, SYMBOL_IDS, dust } from './game.js';

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d')];
}

export function canvasTexture(canvas, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.needsUpdate = true;
  return tex;
}

// Restrained grotesque stack: this design has no room for a display face.
const FONT = '"Inter", "SF Pro Text", -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Everything is a shade of blue-grey; the only saturation is one cold accent.
export const INK = {
  core: '#070a10',
  deep: '#0b101a',
  line: '#2a3a52',
  hair: '#3d5273',
  mute: '#7e93ad',
  text: '#c9d8e9',
  bright: '#eef5ff',
  accent: '#5f9cff',
  win: '#dfeeff',
};

// ---------------------------------------------------------------- symbols
//
// Silhouette first: each symbol has to be identifiable as a black shape at
// 32px. Detail is added only after the outline reads.

/** A lumpy rock: outline from a low-frequency radial wobble. */
function drawAsteroid(ctx, s) {
  const cx = s * 0.5;
  const cy = s * 0.52;
  const R = s * 0.27;
  const pts = [];
  const N = 13;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // Deterministic wobble so every tile shows the same rock.
    const wob = 1 + 0.17 * Math.sin(a * 3 + 1.1) + 0.09 * Math.sin(a * 5 - 0.4);
    pts.push([cx + Math.cos(a) * R * wob, cy + Math.sin(a) * R * wob * 0.93]);
  }

  const g = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.08, cx, cy, R * 1.15);
  g.addColorStop(0, '#9aa9bb');
  g.addColorStop(0.5, '#6d7d91');
  g.addColorStop(1, '#2f3a48');
  ctx.fillStyle = g;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();

  // Craters: dark wells with a lit lower lip.
  for (const [dx, dy, r] of [[-0.09, -0.07, 0.055], [0.07, 0.05, 0.04], [-0.02, 0.13, 0.028]]) {
    const px = cx + dx * s;
    const py = cy + dy * s;
    const rr = r * s;
    ctx.fillStyle = 'rgba(14,20,28,0.55)';
    ctx.beginPath();
    ctx.ellipse(px, py, rr, rr * 0.82, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,205,222,0.35)';
    ctx.lineWidth = s * 0.008;
    ctx.beginPath();
    ctx.ellipse(px, py + rr * 0.18, rr * 0.95, rr * 0.72, 0.3, 0.2, Math.PI * 0.9);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(205,220,238,0.5)';
  ctx.lineWidth = s * 0.009;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
}

/** Comet: bright head with a tapering tail. */
function drawComet(ctx, s) {
  const hx = s * 0.66;
  const hy = s * 0.34;
  const tx = s * 0.16;
  const ty = s * 0.78;

  const tail = ctx.createLinearGradient(hx, hy, tx, ty);
  tail.addColorStop(0, 'rgba(226,240,255,0.92)');
  tail.addColorStop(0.35, 'rgba(140,180,235,0.45)');
  tail.addColorStop(1, 'rgba(90,130,190,0)');
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.quadraticCurveTo(s * 0.42, s * 0.5, tx, ty);
  ctx.quadraticCurveTo(s * 0.44, s * 0.42, hx, hy);
  ctx.fill();

  // Faint second tail for a bit of volume.
  ctx.fillStyle = 'rgba(120,160,215,0.22)';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.quadraticCurveTo(s * 0.5, s * 0.34, s * 0.26, s * 0.5);
  ctx.quadraticCurveTo(s * 0.46, s * 0.36, hx, hy);
  ctx.fill();

  const head = ctx.createRadialGradient(hx - s * 0.02, hy - s * 0.02, s * 0.01, hx, hy, s * 0.115);
  head.addColorStop(0, '#ffffff');
  head.addColorStop(0.4, '#d6e8ff');
  head.addColorStop(1, 'rgba(120,170,235,0.15)');
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(hx, hy, s * 0.115, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(200,225,255,0.55)';
  for (const [dx, dy, r] of [[-0.1, 0.2, 0.014], [-0.02, 0.28, 0.009]]) {
    ctx.beginPath();
    ctx.arc(s * (0.52 + dx), s * (0.46 + dy), s * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Crescent moon: a disc with an offset disc subtracted. */
function drawCrescent(ctx, s) {
  const cx = s * 0.5;
  const cy = s * 0.5;
  const r = s * 0.26;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#cfdff1');
  g.addColorStop(1, '#5d738c');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // Carve the shadow out of the lit body.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx + r * 0.46, cy - r * 0.3, r * 0.92, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(238,246,255,0.75)';
  ctx.lineWidth = s * 0.011;
  ctx.beginPath();
  ctx.arc(cx + r * 0.46, cy - r * 0.3, r * 0.92, 0.5, Math.PI * 1.7);
  ctx.stroke();
}

/** Ringed planet: limb-lit sphere with a tilted ring. */
function drawPlanet(ctx, s) {
  const cx = s * 0.5;
  const cy = s * 0.5;
  const r = s * 0.22;

  const g = ctx.createRadialGradient(cx - r * 0.42, cy - r * 0.42, r * 0.06, cx, cy, r * 1.1);
  g.addColorStop(0, '#dce9f8');
  g.addColorStop(0.42, '#7ba0cb');
  g.addColorStop(0.82, '#2f4b6e');
  g.addColorStop(1, '#16222f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(210,228,246,0.14)';
  for (const [yo, hh] of [[-0.34, 0.1], [0.06, 0.14], [0.4, 0.08]]) {
    ctx.fillRect(cx - r, cy + yo * r, r * 2, hh * r);
  }
  ctx.restore();

  // Ring drawn behind at the top, in front at the bottom.
  const ring = (startA, endA, alpha) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.34);
    ctx.strokeStyle = `rgba(200,222,246,${alpha})`;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.72, r * 0.5, 0, startA, endA);
    ctx.stroke();
    ctx.restore();
  };
  ring(Math.PI, Math.PI * 2, 0.5);
  ring(0, Math.PI, 0.85);

  ctx.strokeStyle = 'rgba(180,205,232,0.35)';
  ctx.lineWidth = s * 0.008;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.15, Math.PI * 1.15);
  ctx.stroke();
}

/** Nebula: a soft cloud of stacked radial blobs. */
function drawNebula(ctx, s) {
  const blobs = [
    [0.5, 0.5, 0.3, 'rgba(150,190,255,0.5)'],
    [0.4, 0.44, 0.2, 'rgba(200,225,255,0.45)'],
    [0.62, 0.58, 0.18, 'rgba(110,150,225,0.4)'],
    [0.52, 0.36, 0.13, 'rgba(235,245,255,0.5)'],
  ];
  for (const [x, y, r, col] of blobs) {
    const g = ctx.createRadialGradient(s * x, s * y, 0, s * x, s * y, s * r);
    g.addColorStop(0, col);
    g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s * x, s * y, s * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [x, y] of [[0.44, 0.42], [0.58, 0.52], [0.52, 0.34], [0.36, 0.56], [0.64, 0.42]]) {
    ctx.beginPath();
    ctx.arc(s * x, s * y, s * 0.011, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Singularity: the jackpot. A photon ring around a black core with arcs of
 * infalling matter, and the only symbol drawn with pure white.
 */
function drawSingularity(ctx, s) {
  const cx = s * 0.5;
  const cy = s * 0.5;
  const r = s * 0.19;

  const halo = ctx.createRadialGradient(cx, cy, r * 1.1, cx, cy, s * 0.42);
  halo.addColorStop(0, 'rgba(220,238,255,0.55)');
  halo.addColorStop(0.5, 'rgba(150,195,255,0.18)');
  halo.addColorStop(1, 'rgba(120,170,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
  ctx.fill();

  // Event horizon.
  ctx.fillStyle = '#04060a';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.22);
  const ring = ctx.createLinearGradient(-r, 0, r, 0);
  ring.addColorStop(0, 'rgba(255,255,255,1)');
  ring.addColorStop(0.45, 'rgba(214,234,255,0.85)');
  ring.addColorStop(1, 'rgba(140,180,240,0.35)');
  ctx.strokeStyle = ring;
  ctx.lineWidth = s * 0.026;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.16, r * 0.62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = s * 0.008;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = s * 0.006;
  for (const len of [0.34, 0.22]) {
    ctx.beginPath();
    ctx.moveTo(cx - s * len, cy);
    ctx.lineTo(cx + s * len, cy);
    ctx.moveTo(cx, cy - s * len * 0.6);
    ctx.lineTo(cx, cy + s * len * 0.6);
    ctx.stroke();
  }
}

const SYMBOL_PAINTERS = {
  asteroid: drawAsteroid,
  comet: drawComet,
  crescent: drawCrescent,
  planet: drawPlanet,
  nebula: drawNebula,
  singularity: drawSingularity,
};

const symbolCache = new Map();

/**
 * One reel cell: smoked glass with a lit symbol. Kept deliberately dark so the
 * machine reads as an object in a dark room rather than a lightbox.
 */
export function symbolTexture(id, { size = 512 } = {}) {
  const key = `${id}:${size}`;
  if (symbolCache.has(key)) return symbolCache.get(key);

  const [canvas, ctx] = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);

  const bg = ctx.createRadialGradient(size / 2, size * 0.42, size * 0.04, size / 2, size / 2, size * 0.76);
  bg.addColorStop(0, '#1a2432');
  bg.addColorStop(0.6, '#0d141d');
  bg.addColorStop(1, '#070a10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(120,150,190,0.10)';
  ctx.lineWidth = size * 0.004;
  ctx.strokeRect(size * 0.015, size * 0.015, size * 0.97, size * 0.97);

  const accent = SYMBOLS[id].accent;
  ctx.save();
  ctx.globalAlpha = 0.70;
  ctx.shadowColor = accent;
  ctx.shadowBlur = size * 0.075;
  SYMBOL_PAINTERS[id](ctx, size);
  ctx.restore();
  ctx.save();
  SYMBOL_PAINTERS[id](ctx, size);
  ctx.restore();

  const tex = canvasTexture(canvas);
  symbolCache.set(key, tex);
  return tex;
}

/** Soft radial blob used for glows and particles. */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 256) {
  const [canvas, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.55)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(canvas);
}

/**
 * The wordmark. Minimalism means this is small, wide-tracked and engraved
 * rather than a lit marquee: it should read as machined into the metal.
 */
export function wordmarkTexture({ text = 'SINGULARITY', sub = 'STARDUST' } = {}) {
  const W = 1024;
  const H = 256;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `600 ${H * 0.30}px ${FONT}`;
  ctx.letterSpacing = `${H * 0.09}px`;
  // Engraved: a dark line under a light one reads as cut into the surface.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(text, W / 2, H * 0.40 + 2);
  ctx.fillStyle = 'rgba(198,214,234,0.92)';
  ctx.fillText(text, W / 2, H * 0.40);

  ctx.font = `500 ${H * 0.105}px ${FONT}`;
  ctx.letterSpacing = `${H * 0.16}px`;
  ctx.fillStyle = 'rgba(126,147,173,0.85)';
  ctx.fillText(sub, W / 2, H * 0.68);

  // Hairline rules either side of the sub-label.
  const ruleY = H * 0.68;
  ctx.strokeStyle = 'rgba(90,115,148,0.45)';
  ctx.lineWidth = 2;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + sgn * W * 0.19, ruleY);
    ctx.lineTo(W / 2 + sgn * W * 0.30, ruleY);
    ctx.stroke();
  }

  return canvasTexture(canvas);
}

/**
 * Floating balance readout. No card, no border: type sitting in the dark with a
 * hairline underline. Returns { texture, redraw }.
 */
export function balanceTexture() {
  const W = 1024;
  const H = 384;
  const [canvas, ctx] = makeCanvas(W, H);
  const texture = canvasTexture(canvas);

  function redraw({ balance, bet, busted, flash = 0, flashColor = INK.accent }) {
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = `500 24px ${FONT}`;
    ctx.letterSpacing = '14px';
    ctx.fillStyle = busted ? 'rgba(255,120,140,0.8)' : `rgba(126,147,173,${0.75 + flash * 0.25})`;
    ctx.fillText(busted ? 'OUT OF STARDUST' : 'STARDUST', W / 2, 58);

    // The one large element in the whole composition.
    ctx.font = `200 ${Math.round(H * 0.40)}px ${FONT}`;
    ctx.letterSpacing = '2px';
    const value = busted ? '0.00' : dust(balance);
    if (flash > 0.01) {
      ctx.save();
      ctx.shadowColor = flashColor;
      ctx.shadowBlur = 44 * flash;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(value, W / 2, H * 0.47);
      ctx.restore();
    }
    ctx.fillStyle = busted ? 'rgba(255,140,158,0.9)' : INK.bright;
    ctx.fillText(value, W / 2, H * 0.47);

    // Hairline that lights up with the flash, like a level meter.
    const lineW = W * 0.44;
    ctx.strokeStyle = 'rgba(90,115,148,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W / 2 - lineW / 2, 226);
    ctx.lineTo(W / 2 + lineW / 2, 226);
    ctx.stroke();

    if (flash > 0.01) {
      ctx.strokeStyle = flashColor;
      ctx.globalAlpha = flash;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - lineW / 2, 226);
      ctx.lineTo(W / 2 + lineW / 2, 226);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.font = `600 23px ${FONT}`;
    ctx.letterSpacing = '5px';
    ctx.fillStyle = 'rgba(126,147,173,0.72)';
    const next = busted ? 'RESET TO CONTINUE' : `NEXT  ${dust(bet)}   10%`;
    ctx.fillText(next, W / 2, 268);

    texture.needsUpdate = true;
  }

  return { texture, redraw, canvas };
}

/** Win banner. Light, wide-tracked caps; no outline, no drop shadow. */
export function bannerTexture(text, sub, accent = INK.win) {
  const W = 1024;
  const H = 256;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  // A soft dark bed: the banner overlays the reels, and white type on a moving
  // symbol grid is unreadable without it.
  const bed = ctx.createLinearGradient(0, 0, 0, H);
  bed.addColorStop(0, 'rgba(4,7,12,0)');
  bed.addColorStop(0.18, 'rgba(4,7,12,0.80)');
  bed.addColorStop(0.82, 'rgba(4,7,12,0.80)');
  bed.addColorStop(1, 'rgba(4,7,12,0)');
  ctx.fillStyle = bed;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `600 ${H * 0.34}px ${FONT}`;
  ctx.letterSpacing = `${H * 0.12}px`;
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, W / 2, H * 0.40);
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, W / 2, H * 0.40);

  if (sub) {
    ctx.font = `600 ${H * 0.115}px ${FONT}`;
    ctx.letterSpacing = `${H * 0.13}px`;
    ctx.fillStyle = 'rgba(180,205,232,0.9)';
    ctx.fillText(sub, W / 2, H * 0.72);
  }

  return canvasTexture(canvas);
}

/** Small labels and buttons. */
export function labelTexture(text, { accent = INK.text, bg = 'rgba(12,18,27,0.9)', w = 512, h = 160 } = {}) {
  const [canvas, ctx] = makeCanvas(w, h);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, w, h, h * 0.2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,115,148,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${h * 0.30}px ${FONT}`;
  ctx.letterSpacing = `${h * 0.12}px`;
  ctx.fillStyle = accent;
  ctx.fillText(text, w / 2, h / 2 + 2);
  return canvasTexture(canvas);
}

/**
 * Paytable strip: symbol, multiple, pair rate. Sized to sit on the lower fascia
 * without competing with the reels.
 */
export function paytableTexture() {
  const W = 1152;
  const H = 288;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `600 18px ${FONT}`;
  ctx.letterSpacing = '10px';
  ctx.fillStyle = 'rgba(150,172,198,0.78)';
  ctx.fillText('PAYS', W / 2, 30);

  const rows = [
    ['singularity', 106], ['nebula', 45], ['planet', 22],
    ['crescent', 14], ['comet', 8], ['asteroid', 3],
  ];
  const pad = 30;
  const colW = (W - pad * 2) / rows.length;
  const icon = 104;
  const iconY = 56;

  rows.forEach(([id, three], i) => {
    const cx = pad + colW * (i + 0.5);
    const accent = SYMBOLS[id].accent;

    ctx.save();
    ctx.translate(cx - icon / 2, iconY);
    ctx.scale(icon / 512, icon / 512);
    SYMBOL_PAINTERS[id](ctx, 512);
    ctx.restore();

    ctx.font = `400 34px ${FONT}`;
    ctx.letterSpacing = '1px';
    ctx.fillStyle = '#eef5ff';
    ctx.fillText(`${three}`, cx, 188);

    ctx.font = `500 17px ${FONT}`;
    ctx.fillStyle = 'rgba(150,172,198,0.72)';
    ctx.fillText('2 = 1.2', cx, 222);
  });

  ctx.strokeStyle = 'rgba(90,115,148,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, 262);
  ctx.lineTo(W - pad, 262);
  ctx.stroke();

  return canvasTexture(canvas);
}

/** Vertical motion streaks shown while a reel is spinning fast. */
export function streakTexture() {
  const W = 128;
  const H = 512;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * W;
    const y0 = Math.random() * H;
    const len = 50 + Math.random() * 150;
    const a = 0.05 + Math.random() * 0.15;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, 'rgba(190,215,245,0)');
    g.addColorStop(0.5, `rgba(210,230,255,${a})`);
    g.addColorStop(1, 'rgba(190,215,245,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, 1.5 + Math.random() * 2, len);
  }
  return canvasTexture(canvas);
}

/** Vertical glass reflection sweep for the reel window. */
export function glassTexture() {
  const W = 256;
  const H = 512;
  const [canvas, ctx] = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(210,230,255,0.13)');
  g.addColorStop(0.22, 'rgba(200,220,250,0.04)');
  g.addColorStop(0.46, 'rgba(255,255,255,0)');
  g.addColorStop(0.78, 'rgba(160,200,255,0.035)');
  g.addColorStop(1, 'rgba(210,230,255,0.09)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return canvasTexture(canvas);
}

/** Mote sprite: a tiny bright point with a soft falloff. */
export function moteTexture() {
  const S = 128;
  const [canvas, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(226,240,255,0.85)');
  g.addColorStop(0.45, 'rgba(150,190,255,0.18)');
  g.addColorStop(1, 'rgba(120,170,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return canvasTexture(canvas);
}

export function allSymbolTextures() {
  return Object.fromEntries(SYMBOL_IDS.map((id) => [id, symbolTexture(id)]));
}
