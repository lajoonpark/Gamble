import * as THREE from 'three';
import { SYMBOLS, SYMBOL_IDS } from './game.js';

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

const FONT = '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif';
const FONT_DISPLAY = '"Futura", "Avenir Next Condensed", "Helvetica Neue", Arial, sans-serif';

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

// ---------------------------------------------------------------- symbols

function drawCherry(ctx, s) {
  const stemGrad = ctx.createLinearGradient(s * 0.35, s * 0.15, s * 0.7, s * 0.55);
  stemGrad.addColorStop(0, '#7dff9a');
  stemGrad.addColorStop(1, '#1f8f3e');
  ctx.strokeStyle = stemGrad;
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.028;
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.15);
  ctx.bezierCurveTo(s * 0.44, s * 0.3, s * 0.36, s * 0.4, s * 0.33, s * 0.52);
  ctx.moveTo(s * 0.5, s * 0.15);
  ctx.bezierCurveTo(s * 0.58, s * 0.32, s * 0.64, s * 0.42, s * 0.66, s * 0.54);
  ctx.stroke();

  ctx.fillStyle = '#3ef07a';
  ctx.beginPath();
  ctx.ellipse(s * 0.62, s * 0.19, s * 0.13, s * 0.055, -0.45, 0, Math.PI * 2);
  ctx.fill();

  const ball = (cx, cy, r, hue) => {
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#ff9fb0');
    g.addColorStop(0.35, hue);
    g.addColorStop(1, '#8c0018');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.34, cy - r * 0.42, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
    ctx.fill();
  };
  ball(s * 0.34, s * 0.66, s * 0.185, '#ff2748');
  ball(s * 0.66, s * 0.7, s * 0.165, '#f0143a');
}

function drawLemon(ctx, s) {
  ctx.save();
  ctx.translate(s * 0.5, s * 0.55);
  ctx.rotate(-0.22);
  const g = ctx.createRadialGradient(-s * 0.07, -s * 0.1, s * 0.02, 0, 0, s * 0.34);
  g.addColorStop(0, '#fffdc9');
  g.addColorStop(0.45, '#ffe22a');
  g.addColorStop(1, '#c98d05');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.24, s * 0.33, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.33, s * 0.05, s * 0.035, 0, 0, Math.PI * 2);
  ctx.ellipse(0, s * 0.33, s * 0.05, s * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(-s * 0.09, -s * 0.12, s * 0.07, s * 0.13, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2fd468';
  ctx.beginPath();
  ctx.ellipse(s * 0.13, -s * 0.28, s * 0.12, s * 0.05, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBell(ctx, s) {
  const g = ctx.createLinearGradient(s * 0.3, s * 0.2, s * 0.7, s * 0.8);
  g.addColorStop(0, '#fff3c0');
  g.addColorStop(0.35, '#ffc23a');
  g.addColorStop(0.7, '#ff8a00');
  g.addColorStop(1, '#a34c00');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.19);
  ctx.bezierCurveTo(s * 0.34, s * 0.2, s * 0.32, s * 0.4, s * 0.29, s * 0.56);
  ctx.bezierCurveTo(s * 0.27, s * 0.65, s * 0.2, s * 0.67, s * 0.17, s * 0.71);
  ctx.lineTo(s * 0.83, s * 0.71);
  ctx.bezierCurveTo(s * 0.8, s * 0.67, s * 0.73, s * 0.65, s * 0.71, s * 0.56);
  ctx.bezierCurveTo(s * 0.68, s * 0.4, s * 0.66, s * 0.2, s * 0.5, s * 0.19);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.ellipse(s * 0.5, s * 0.19, s * 0.045, s * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();

  const rim = ctx.createLinearGradient(s * 0.17, s * 0.7, s * 0.83, s * 0.79);
  rim.addColorStop(0, '#c47a00');
  rim.addColorStop(0.4, '#ffe08a');
  rim.addColorStop(1, '#9a5a00');
  ctx.fillStyle = rim;
  roundRect(ctx, s * 0.15, s * 0.7, s * 0.7, s * 0.085, s * 0.03);
  ctx.fill();

  ctx.fillStyle = '#ffb020';
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.815, s * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.ellipse(s * 0.4, s * 0.4, s * 0.035, s * 0.11, 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawBar(ctx, s) {
  const g = ctx.createLinearGradient(0, s * 0.4, 0, s * 0.62);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#e8ecff');
  g.addColorStop(1, '#9aa6c9');
  ctx.fillStyle = g;
  roundRect(ctx, s * 0.13, s * 0.4, s * 0.74, s * 0.22, s * 0.035);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = s * 0.012;
  ctx.stroke();

  ctx.fillStyle = '#2b1a4a';
  ctx.font = `900 ${s * 0.155}px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BAR', s * 0.5, s * 0.515);

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(s * 0.16, s * 0.435, s * 0.68, s * 0.018);
}

function drawDiamond(ctx, s) {
  const cx = s * 0.5;
  const cy = s * 0.53;
  const w = s * 0.28;
  const h = s * 0.34;
  const facets = [
    [[cx, cy - h], [cx + w * 0.62, cy - h * 0.28], [cx, cy], [cx - w * 0.62, cy - h * 0.28]],
    [[cx - w * 0.62, cy - h * 0.28], [cx, cy], [cx, cy + h]],
    [[cx + w * 0.62, cy - h * 0.28], [cx, cy], [cx, cy + h]],
  ];
  const shades = ['#e8fdff', '#7ce8ff', '#28b8e8'];
  facets.forEach((pts, i) => {
    const g = ctx.createLinearGradient(cx, cy - h, cx, cy + h);
    g.addColorStop(0, shades[i]);
    g.addColorStop(1, i === 0 ? '#9ceeff' : '#0d6f9e');
    ctx.fillStyle = g;
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = s * 0.014;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h);
  ctx.lineTo(cx + w * 0.62, cy - h * 0.28);
  ctx.lineTo(cx, cy + h);
  ctx.lineTo(cx - w * 0.62, cy - h * 0.28);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.2, cy - h * 0.5, s * 0.03, s * 0.05, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawSeven(ctx, s) {
  const g = ctx.createLinearGradient(0, s * 0.2, 0, s * 0.82);
  g.addColorStop(0, '#ff8fa0');
  g.addColorStop(0.3, '#ff2440');
  g.addColorStop(1, '#b3001b');
  ctx.font = `900 ${s * 0.6}px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffd94a';
  ctx.lineWidth = s * 0.055;
  ctx.strokeText('7', s * 0.5, s * 0.53);
  ctx.fillStyle = g;
  ctx.fillText('7', s * 0.5, s * 0.53);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = s * 0.012;
  ctx.strokeText('7', s * 0.5, s * 0.53);
}

const SYMBOL_PAINTERS = {
  cherry: drawCherry,
  lemon: drawLemon,
  bell: drawBell,
  bar: drawBar,
  diamond: drawDiamond,
  seven: drawSeven,
};

const symbolCache = new Map();

/** One reel cell: dark glass tile with a glowing symbol. 512px square. */
export function symbolTexture(id, { size = 512 } = {}) {
  const key = `${id}:${size}`;
  if (symbolCache.has(key)) return symbolCache.get(key);

  const [canvas, ctx] = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);

  // Near-black tile with a faint warm vignette: this is a backlit printed
  // strip, so the art itself must supply all of the light.
  const bg = ctx.createRadialGradient(size / 2, size * 0.45, size * 0.05, size / 2, size / 2, size * 0.72);
  bg.addColorStop(0, '#1c0d2b');
  bg.addColorStop(0.62, '#0e0518');
  bg.addColorStop(1, '#06020c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(255,190,120,0.05)';
  ctx.lineWidth = size * 0.005;
  ctx.strokeRect(size * 0.02, size * 0.02, size * 0.96, size * 0.96);

  // Glow is drawn as a tight pass behind the art only.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.shadowColor = SYMBOLS[id].accent;
  ctx.shadowBlur = size * 0.055;
  SYMBOL_PAINTERS[id](ctx, size);
  ctx.restore();
  ctx.save();
  SYMBOL_PAINTERS[id](ctx, size);
  ctx.restore();

  const tex = canvasTexture(canvas);
  symbolCache.set(key, tex);
  return tex;
}

/** Soft radial blob used for glows, coin sprites and bokeh. */
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

/** Casino marquee: gold lettering on deep plum with a neon rim. */
export function marqueeTexture({ text = 'LUCKY 7', sub = 'PROGRESSIVE GOLD' } = {}) {
  const W = 1024;
  const H = 384;
  const [canvas, ctx] = makeCanvas(W, H);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#3a0d4a');
  bg.addColorStop(0.5, '#24082f');
  bg.addColorStop(1, '#12041a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const halo = ctx.createRadialGradient(W / 2, H * 0.52, 10, W / 2, H * 0.52, W * 0.5);
  halo.addColorStop(0, 'rgba(255,90,190,0.45)');
  halo.addColorStop(1, 'rgba(255,90,190,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,206,94,0.9)';
  ctx.lineWidth = 8;
  roundRect(ctx, 18, 18, W - 36, H - 36, 40);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,120,220,0.55)';
  ctx.lineWidth = 3;
  roundRect(ctx, 34, 34, W - 68, H - 68, 30);
  ctx.stroke();

  const gold = ctx.createLinearGradient(0, H * 0.28, 0, H * 0.66);
  gold.addColorStop(0, '#fff7d0');
  gold.addColorStop(0.32, '#ffd75e');
  gold.addColorStop(0.62, '#ff9f1a');
  gold.addColorStop(1, '#ffe89a');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${H * 0.34}px ${FONT_DISPLAY}`;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(120,0,60,0.85)';
  ctx.lineWidth = H * 0.045;
  ctx.strokeText(text, W / 2, H * 0.47);
  ctx.fillStyle = gold;
  ctx.fillText(text, W / 2, H * 0.47);

  ctx.font = `700 ${H * 0.09}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,196,236,0.85)';
  ctx.letterSpacing = '14px';
  ctx.fillText(sub, W / 2, H * 0.79);

  return canvasTexture(canvas);
}

/** Floating balance readout. Returns { texture, redraw(state) }. */
export function balanceTexture() {
  const W = 900;
  const H = 360;
  const [canvas, ctx] = makeCanvas(W, H);
  const texture = canvasTexture(canvas);

  function redraw({ balance, bet, busted, flash = 0, flashColor = '#39ffa0' }) {
    ctx.clearRect(0, 0, W, H);

    const body = ctx.createLinearGradient(0, 0, 0, H);
    body.addColorStop(0, 'rgba(46,10,58,0.94)');
    body.addColorStop(0.55, 'rgba(22,5,32,0.96)');
    body.addColorStop(1, 'rgba(12,3,18,0.97)');
    ctx.fillStyle = body;
    roundRect(ctx, 8, 8, W - 16, H - 16, 54);
    ctx.fill();

    const stroke = ctx.createLinearGradient(0, 0, W, H);
    stroke.addColorStop(0, `rgba(255,214,110,${0.55 + flash * 0.45})`);
    stroke.addColorStop(0.5, `rgba(255,140,220,${0.45 + flash * 0.45})`);
    stroke.addColorStop(1, `rgba(120,230,255,${0.45 + flash * 0.45})`);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 6;
    roundRect(ctx, 8, 8, W - 16, H - 16, 54);
    ctx.stroke();

    if (flash > 0.01) {
      ctx.save();
      ctx.globalAlpha = flash * 0.30;
      ctx.fillStyle = flashColor;
      roundRect(ctx, 8, 8, W - 16, H - 16, 54);
      ctx.fill();
      ctx.restore();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 30px ${FONT}`;
    ctx.fillStyle = 'rgba(255,190,240,0.72)';
    ctx.letterSpacing = '10px';
    ctx.fillText(busted ? 'OUT OF CREDIT' : 'BALANCE', W / 2, 74);

    const value = busted ? '$0.00' : `$${balance.toFixed(2)}`;
    ctx.font = `900 ${H * 0.42}px ${FONT_DISPLAY}`;
    ctx.fillStyle = busted ? '#ff5570' : '#ffffff';
    ctx.shadowColor = busted ? 'rgba(255,60,90,0.9)' : 'rgba(255,225,140,0.85)';
    ctx.shadowBlur = 34;
    ctx.fillText(value, W / 2, H * 0.5);
    ctx.shadowBlur = 0;

    ctx.font = `600 28px ${FONT}`;
    ctx.fillStyle = 'rgba(170,235,255,0.78)';
    ctx.letterSpacing = '4px';
    ctx.fillText(busted ? 'RESET TO PLAY AGAIN' : `NEXT BET  $${bet.toFixed(2)}  ·  10%`, W / 2, H - 62);

    texture.needsUpdate = true;
  }

  return { texture, redraw, canvas };
}

/** Win banner sprite art. */
export function bannerTexture(text, sub, accent = '#ffd54a') {
  const W = 1024;
  const H = 300;
  const [canvas, ctx] = makeCanvas(W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const g = ctx.createLinearGradient(0, H * 0.2, 0, H * 0.62);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.4, accent);
  g.addColorStop(1, '#ff8a1a');
  ctx.font = `900 ${H * 0.56}px ${FONT_DISPLAY}`;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(70,0,36,0.92)';
  ctx.lineWidth = H * 0.09;
  ctx.strokeText(text, W / 2, H * 0.42);
  ctx.fillStyle = g;
  ctx.fillText(text, W / 2, H * 0.42);

  if (sub) {
    ctx.font = `800 ${H * 0.15}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.letterSpacing = '6px';
    ctx.fillText(sub, W / 2, H * 0.8);
  }

  return canvasTexture(canvas);
}

/** Buttons and small labels for the cabinet. */
export function labelTexture(text, { accent = '#ffcf5c', bg = '#1c0a26', w = 512, h = 160, font = null } = {}) {
  const [canvas, ctx] = makeCanvas(w, h);
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, w, h, h * 0.28);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font || `800 ${h * 0.42}px ${FONT_DISPLAY}`;
  ctx.fillStyle = accent;
  ctx.fillText(text, w / 2, h / 2 + 2);
  return canvasTexture(canvas);
}

/** Backdrop: hot magenta stage with bokeh and a bright core. */
export function backdropTexture() {
  const W = 1024;
  const H = 1024;
  const [canvas, ctx] = makeCanvas(W, H);

  const bg = ctx.createRadialGradient(W * 0.5, H * 0.44, 20, W * 0.5, H * 0.5, W * 0.8);
  bg.addColorStop(0, '#ff4fa8');
  bg.addColorStop(0.28, '#c81e86');
  bg.addColorStop(0.58, '#5c0b6b');
  bg.addColorStop(0.82, '#2a0540');
  bg.addColorStop(1, '#12021f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const cols = ['rgba(255,220,120,', 'rgba(120,230,255,', 'rgba(255,140,220,'];
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = 8 + Math.random() * 62;
    const c = cols[(Math.random() * cols.length) | 0];
    const a = 0.05 + Math.random() * 0.16;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `${c}${a})`);
    g.addColorStop(0.6, `${c}${a * 0.45})`);
    g.addColorStop(1, `${c}0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvasTexture(canvas);
}

/** Rotating light-ray fan for the backdrop. */
export function rayTexture() {
  const S = 1024;
  const [canvas, ctx] = makeCanvas(S, S);
  ctx.translate(S / 2, S / 2);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const spread = 0.045 + Math.random() * 0.05;
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * S * 0.5, Math.sin(a) * S * 0.5);
    g.addColorStop(0, 'rgba(255,215,255,0.16)');
    g.addColorStop(0.55, 'rgba(255,150,240,0.05)');
    g.addColorStop(1, 'rgba(255,150,240,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, S * 0.52, a - spread, a + spread);
    ctx.closePath();
    ctx.fill();
  }
  return canvasTexture(canvas);
}

/** Vertical glass reflection sweep for reel windows. */
export function glassTexture() {
  const W = 256;
  const H = 512;
  const [canvas, ctx] = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(255,255,255,0.16)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.46, 'rgba(255,255,255,0)');
  g.addColorStop(0.72, 'rgba(180,240,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return canvasTexture(canvas);
}

/** Vertical motion streaks shown while a reel is spinning fast. */
export function streakTexture(accent = '#ffffff') {
  const W = 128;
  const H = 512;
  const [canvas, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * W;
    const y0 = Math.random() * H;
    const len = 40 + Math.random() * 150;
    const a = 0.05 + Math.random() * 0.16;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, `rgba(255,255,255,0)`);
    g.addColorStop(0.5, `rgba(255,255,255,${a})`);
    g.addColorStop(1, `rgba(255,255,255,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, 2 + Math.random() * 3, len);
  }
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, H);
  return canvasTexture(canvas);
}

export function coinTexture() {
  const S = 256;
  const [canvas, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S * 0.36, S * 0.34, S * 0.05, S * 0.5, S * 0.5, S * 0.5);
  g.addColorStop(0, '#fffbe0');
  g.addColorStop(0.4, '#ffd75e');
  g.addColorStop(0.8, '#e09a12');
  g.addColorStop(1, '#8a5300');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = S * 0.05;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(120,70,0,0.85)';
  ctx.font = `900 ${S * 0.34}px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', S / 2, S * 0.53);
  return canvasTexture(canvas);
}

export function allSymbolTextures() {
  return Object.fromEntries(SYMBOL_IDS.map((id) => [id, symbolTexture(id)]));
}

/** Paytable strip for the lower fascia: readable at a glance. */
export function paytableTexture() {
  const W = 1152;
  const H = 288;
  const [canvas, ctx] = makeCanvas(W, H);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(32,9,46,0.35)');
  bg.addColorStop(1, 'rgba(9,2,16,0.62)');
  ctx.fillStyle = bg;
  roundRect(ctx, 3, 3, W - 6, H - 6, 20);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,206,110,0.42)';
  ctx.lineWidth = 3;
  roundRect(ctx, 3, 3, W - 6, H - 6, 20);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Header: two payout columns labelled by match count.
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = 'rgba(255,190,240,0.6)';
  ctx.letterSpacing = '6px';
  ctx.fillText('PAYS', W / 2, 33);

  const rows = [
    ['seven', 106], ['diamond', 45], ['bar', 22],
    ['bell', 14], ['lemon', 8], ['cherry', 3],
  ];
  const pad = 26;
  const colW = (W - pad * 2) / rows.length;
  const iconSize = 104;
  const iconY = 62;

  rows.forEach(([id, three], i) => {
    const cx = pad + colW * (i + 0.5);
    const accent = SYMBOLS[id].accent;

    // Icon drawn into a clipped, scaled box so it tiles cleanly.
    ctx.save();
    ctx.translate(cx - iconSize / 2, iconY);
    ctx.scale(iconSize / 512, iconSize / 512);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 512, 512);
    ctx.clip();
    SYMBOL_PAINTERS[id](ctx, 512);
    ctx.restore();
    ctx.restore();

    ctx.font = `900 32px ${FONT_DISPLAY}`;
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14;
    ctx.fillText(`${three}\u00d7`, cx, 202);
    ctx.shadowBlur = 0;

    ctx.font = `700 19px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('2\u00d7 = 1.2\u00d7', cx, 234);
  });

  ctx.font = `600 17px ${FONT}`;
  ctx.fillStyle = 'rgba(180,235,255,0.5)';
  ctx.letterSpacing = '2px';
  ctx.fillText('BET IS ALWAYS 10% OF YOUR BALANCE', W / 2, H - 22);

  return canvasTexture(canvas);
}
