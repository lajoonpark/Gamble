import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STRIPS, STRIP_LENGTH } from './game.js';
import {
  wordmarkTexture, balanceTexture, symbolTexture, streakTexture, glowTexture,
  paytableTexture, glassTexture,
} from './textures.js';
import { clamp, lerp, damp, Follower, Tweens, easeOutQuart, easeOutBack, spring } from './util.js';

const STRIP_LEN = STRIP_LENGTH;
const STEP = (Math.PI * 2) / STRIP_LEN;

// Proportions: a tall monolith with one large glass window. Everything else is
// a seam or a hairline, so the silhouette carries the design.
const DRUM_R = 1.16;
const CELL_W = 1.10;
const CELL_H = (Math.PI * 2 * DRUM_R) / STRIP_LEN;
const DRUM_Z = -0.55;
const WINDOW_Y = 0.42;
const WINDOW_W = 3.44;
const WINDOW_H = CELL_H * 3;
const CABINET_W = 4.0;
const CABINET_H = 4.25;
const CABINET_D = 1.55;
const CABINET_FRONT = CABINET_D / 2;
const RADIUS = 0.34;

// One accent, used sparingly: the payline, the seams and win states.
const ACCENT = 0x5f9cff;

export class SlotMachine {
  constructor({ tweens = new Tweens() } = {}) {
    this.tweens = tweens;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.reels = [];
    this.rotStops = [0, 0, 0];
    this.spinState = ['idle', 'idle', 'idle'];

    this.time = 0;
    this.tiltX = new Follower(0, 5.0);
    this.tiltY = new Follower(0, 5.0);
    this.jolt = 0;
    this.joltVel = 0;
    this.excite = 0;
    this.winGlow = 0;
    this.spinning = false;
    this.leverPull = 0;
    this.hover = false;
    this.onReelLand = null;

    this.mats = {
      shell: new THREE.MeshPhysicalMaterial({
        color: 0x111823, metalness: 0.62, roughness: 0.34,
        clearcoat: 0.75, clearcoatRoughness: 0.22, envMapIntensity: 1.05,
      }),
      face: new THREE.MeshPhysicalMaterial({
        color: 0x0c121b, metalness: 0.5, roughness: 0.44,
        clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.9,
      }),
      metal: new THREE.MeshPhysicalMaterial({
        color: 0xb9c6d6, metalness: 1, roughness: 0.17, envMapIntensity: 1.5,
      }),
      metalDark: new THREE.MeshPhysicalMaterial({
        color: 0x2b3546, metalness: 1, roughness: 0.32, envMapIntensity: 1.1,
      }),
      well: new THREE.MeshStandardMaterial({
        color: 0x04060a, metalness: 0.2, roughness: 0.92, side: THREE.BackSide,
      }),
    };

    this.buildCabinet();
    this.buildSeams();
    this.buildReels();
    this.buildLever();
    this.buildWordmark();
    this.buildBalance();
  }

  // ------------------------------------------------------------- cabinet

  /**
   * Open-fronted shell: four fascia panels plus side/top/bottom walls, so the
   * reel window is a genuine recess with depth instead of a decal on a box.
   */
  buildCabinet() {
    const { shell, face, metal, metalDark, well } = this.mats;

    const W = CABINET_W;
    const H = CABINET_H;
    const D = CABINET_D;
    const halfW = W / 2;
    const halfH = H / 2;
    const front = CABINET_FRONT;

    const winL = -WINDOW_W / 2;
    const winR = WINDOW_W / 2;
    const winB = WINDOW_Y - WINDOW_H / 2;
    const winT = WINDOW_Y + WINDOW_H / 2;

    const panel = (w, h, x, y, mat = shell, depth = D, z = 0, r = RADIUS) => {
      const m = new THREE.Mesh(
        new RoundedBoxGeometry(w, h, depth, 5, Math.min(r, w / 2.05, h / 2.05)),
        mat,
      );
      m.position.set(x, y, z);
      this.body.add(m);
      return m;
    };

    // Back wall, sides, top and base of the shell.
    panel(W - 0.06, H - 0.06, 0, 0, face, 0.1, -front + 0.05);
    panel(0.26, H, -halfW + 0.13, 0, shell, D, 0, RADIUS);
    panel(0.26, H, halfW - 0.13, 0, shell, D, 0, RADIUS);
    panel(W, 0.26, 0, halfH - 0.13, shell, D, 0, RADIUS);
    panel(W, 0.26, 0, -halfH + 0.13, shell, D, 0, RADIUS);

    // Front fascia: top band, bottom band, and the two pillars around the window.
    panel(W, halfH - winT, 0, (winT + halfH) / 2, face, D, 0, RADIUS);
    panel(W, winB + halfH, 0, (winB - halfH) / 2, face, D, 0, RADIUS);
    panel(winL + halfW, WINDOW_H, (-halfW + winL) / 2, WINDOW_Y, face, D, 0, RADIUS);
    panel(halfW - winR, WINDOW_H, (winR + halfW) / 2, WINDOW_Y, face, D, 0, RADIUS);

    // Interior: a dark well so the window has real depth.
    const throat = (w, h, x, y, rotX, rotY) => {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w, h), well);
      g.position.set(x, y, -0.06);
      g.rotation.x = rotX;
      g.rotation.y = rotY;
      this.body.add(g);
    };
    throat(WINDOW_W, D * 0.9, 0, winT, Math.PI / 2, 0);
    throat(WINDOW_W, D * 0.9, 0, winB, -Math.PI / 2, 0);
    throat(D * 0.9, WINDOW_H, winL, WINDOW_Y, 0, Math.PI / 2);
    throat(D * 0.9, WINDOW_H, winR, WINDOW_Y, 0, -Math.PI / 2);

    // Machined bezel: a thin metal frame, the only bright edge on the front.
    const bez = (w, h, x, y) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.075, 3, 0.022), metal);
      m.position.set(x, y, front + 0.005);
      this.body.add(m);
    };
    bez(WINDOW_W + 0.16, 0.055, 0, winT + 0.028);
    bez(WINDOW_W + 0.16, 0.055, 0, winB - 0.028);
    bez(0.055, WINDOW_H + 0.11, winL - 0.055, WINDOW_Y);
    bez(0.055, WINDOW_H + 0.11, winR + 0.055, WINDOW_Y);

    // Glass across the window.
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(WINDOW_W, WINDOW_H),
      new THREE.MeshPhysicalMaterial({
        map: glassTexture(), transparent: true, opacity: 0.5,
        roughness: 0.06, metalness: 0, clearcoat: 1,
        depthWrite: false, toneMapped: false,
      }),
    );
    glass.position.set(0, WINDOW_Y, front - 0.02);
    this.body.add(glass);

    // Payline: one hairline, not a slot-cabinet stripe.
    const lineMat = new THREE.MeshBasicMaterial({
      color: ACCENT, transparent: true, opacity: 0.22, toneMapped: false,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_W - 0.02, 0.008), lineMat);
    line.position.set(0, WINDOW_Y, front - 0.015);
    this.body.add(line);
    this.payline = line;
    this.paylineBase = 0.22;

    // Plinth: a black slab that grounds the object.
    const plinth = new THREE.Mesh(
      new RoundedBoxGeometry(W + 0.16, 0.24, D + 0.2, 4, 0.06),
      new THREE.MeshPhysicalMaterial({
        color: 0x05080d, metalness: 0.5, roughness: 0.36,
        clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.8,
      }),
    );
    plinth.position.set(0, -halfH - 0.10, 0);
    this.body.add(plinth);

    // Contact shadow: a soft dark ellipse under the plinth. Grounds the object
    // without adding any light to the scene.
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 1.6, D + 1.5),
      new THREE.MeshBasicMaterial({
        map: glowTexture('rgba(0,0,0,0.62)', 'rgba(0,0,0,0)', 256),
        transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, -halfH - 0.24, 0.08);
    this.body.add(pool);
    this.pool = pool;

    // Paytable, low contrast, on the lower fascia.
    const pay = new THREE.Mesh(
      new THREE.PlaneGeometry(2.5, 0.625),
      new THREE.MeshBasicMaterial({
        map: paytableTexture(), transparent: true, toneMapped: false, opacity: 0.85,
      }),
    );
    pay.position.set(0, -1.22, front + 0.004);
    this.body.add(pay);
    this.paytable = pay;

    // The coin tray becomes a simple machined slot.
    const slot = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.09, 0.06, 3, 0.02), metalDark);
    slot.position.set(0, -1.80, front + 0.01);
    this.body.add(slot);

    const slotVoid = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x020306, toneMapped: false }),
    );
    slotVoid.position.set(0, -1.80, front + 0.045);
    this.body.add(slotVoid);
  }

  /**
   * The visual identity in two thin lines: a hairline along the top of the face
   * and one along the bottom. Everything else stays dark.
   */
  buildSeams() {
    const front = CABINET_FRONT;
    const mat = new THREE.MeshBasicMaterial({
      color: ACCENT, transparent: true, opacity: 0.16, toneMapped: false,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.seamMat = mat;

    const topRule = new THREE.Mesh(new THREE.PlaneGeometry(CABINET_W - 0.7, 0.007), mat);
    topRule.position.set(0, CABINET_H / 2 - 0.44, front + 0.006);
    this.body.add(topRule);


  }

  // --------------------------------------------------------------- reels

  buildReels() {
    const voidBox = new THREE.Mesh(
      new THREE.BoxGeometry(WINDOW_W, WINDOW_H, 1.3),
      this.mats.well,
    );
    voidBox.position.set(0, WINDOW_Y, 0.0);
    this.body.add(voidBox);

    const xStart = -1.16;
    const gap = 1.16;

    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      group.position.set(xStart + i * gap, WINDOW_Y, DRUM_Z);
      this.body.add(group);

      const backer = new THREE.Mesh(
        new THREE.CylinderGeometry(DRUM_R * 0.998, DRUM_R * 0.998, CELL_W, 40, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x0a0f17, metalness: 0.45, roughness: 0.7 }),
      );
      backer.rotation.z = Math.PI / 2;
      group.add(backer);

      const drum = new THREE.Group();
      group.add(drum);

      const cells = [];
      const mats = [];
      for (let k = 0; k < STRIP_LEN; k++) {
        const symbol = STRIPS[i][k];
        const mat = new THREE.MeshBasicMaterial({ map: symbolTexture(symbol), toneMapped: false });
        const cell = new THREE.Mesh(new THREE.PlaneGeometry(CELL_W, CELL_H * 0.995), mat);
        const a = k * STEP;
        cell.position.set(0, -Math.sin(a) * DRUM_R, Math.cos(a) * DRUM_R);
        cell.rotation.x = a;
        cell.userData.symbol = symbol;
        cell.userData.stop = k;
        drum.add(cell);
        cells.push(cell);
        mats.push(mat);
      }

      // Hairline seams between symbols instead of chunky dark bars.
      for (let k = 0; k < STRIP_LEN; k++) {
        const a = (k + 0.5) * STEP;
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(CELL_W, 0.006, 0.006),
          new THREE.MeshBasicMaterial({ color: 0x1b2534, toneMapped: false }),
        );
        bar.position.set(0, -Math.sin(a) * (DRUM_R + 0.004), Math.cos(a) * (DRUM_R + 0.004));
        bar.rotation.x = a;
        drum.add(bar);
      }

      const smear = new THREE.Mesh(
        new THREE.CylinderGeometry(DRUM_R * 1.015, DRUM_R * 1.015, CELL_W * 0.98, 40, 1, true),
        new THREE.MeshBasicMaterial({
          map: streakTexture(), transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
        }),
      );
      smear.rotation.z = Math.PI / 2;
      group.add(smear);

      // Only used for the brief flare as a reel lands.
      const light = new THREE.PointLight(0xcfe4ff, 0, 2.2, 2);
      light.position.set(0, 0.1, 0.5);
      group.add(light);

      this.reels.push({ group, drum, cells, mats, smear, light, index: i });
    }

    // Curvature shading: the window edges fall into shadow.
    const shadeCanvas = document.createElement('canvas');
    shadeCanvas.width = 8;
    shadeCanvas.height = 256;
    const sctx = shadeCanvas.getContext('2d');
    const sg = sctx.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, 'rgba(0,0,0,0.92)');
    sg.addColorStop(0.15, 'rgba(0,0,0,0.4)');
    sg.addColorStop(0.36, 'rgba(0,0,0,0)');
    sg.addColorStop(0.5, 'rgba(150,190,255,0.03)');
    sg.addColorStop(0.64, 'rgba(0,0,0,0)');
    sg.addColorStop(0.85, 'rgba(0,0,0,0.4)');
    sg.addColorStop(1, 'rgba(0,0,0,0.92)');
    sctx.fillStyle = sg;
    sctx.fillRect(0, 0, 8, 256);
    const shade = new THREE.Mesh(
      new THREE.PlaneGeometry(WINDOW_W, WINDOW_H),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(shadeCanvas),
        transparent: true, depthWrite: false, toneMapped: false,
      }),
    );
    shade.position.set(0, WINDOW_Y, CABINET_FRONT + 0.03);
    this.body.add(shade);
  }

  // --------------------------------------------------------------- lever

  buildLever() {
    const { metal, metalDark, face } = this.mats;

    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.30, 0.54, 0.46, 4, 0.08), face);
    housing.position.set(CABINET_W / 2 + 0.08, 0.30, 0.30);
    this.body.add(housing);

    // Pivot sits outside the flank so the arm sweeps clear of the cabinet.
    const pivot = new THREE.Group();
    pivot.position.set(CABINET_W / 2 + 0.30, 0.34, 0.30);
    this.body.add(pivot);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.2, 28), metal);
    hub.rotation.z = Math.PI / 2;
    pivot.add(hub);

    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.26, 20), metalDark);
    boss.rotation.z = Math.PI / 2;
    pivot.add(boss);

    const arm = new THREE.Group();
    pivot.add(arm);

    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.055, 1.55, 20), metal);
    rod.position.y = 0.81;
    arm.add(rod);

    // Knurled grip rings near the hub.
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.009, 8, 22), metalDark);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.24 + i * 0.062;
      arm.add(ring);
    }

    // Dark knob: the one soft, rounded mass on the machine.
    const knobMat = new THREE.MeshPhysicalMaterial({
      color: 0x141b26, metalness: 0.35, roughness: 0.24,
      clearcoat: 1, clearcoatRoughness: 0.14, envMapIntensity: 1.2,
      emissive: ACCENT, emissiveIntensity: 0,
    });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 24), knobMat);
    knob.position.y = 1.60;
    arm.add(knob);
    this.knobMat = knobMat;

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 10, 28), metal);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.45;
    arm.add(collar);

    const restZ = 0.08;
    pivot.rotation.z = restZ;
    // Negative Z swings the arm clockwise, dropping the knob toward the floor.
    this.lever = { pivot, arm, knob, restZ, pullZ: -1.24 };
  }

  buildWordmark() {
    const tex = wordmarkTexture({ text: 'SINGULARITY', sub: 'STARDUST' });
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.62, 0.405),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, opacity: 0.72 }),
    );
    plate.position.set(0, 1.72, CABINET_FRONT + 0.004);
    this.body.add(plate);
    this.wordmark = plate;
  }

  buildBalance() {
    const { texture, redraw } = balanceTexture();
    this.balanceRedraw = redraw;
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(2.72, 1.02),
      new THREE.MeshBasicMaterial({
        map: texture, transparent: true, toneMapped: false, depthWrite: false,
      }),
    );
    sprite.position.set(0, 3.26, 0.1);
    this.root.add(sprite);
    this.balanceSprite = sprite;

    this.balanceState = { balance: 100, bet: 10, busted: false, flash: 0, flashColor: '#5f9cff' };
    this.balanceFlash = new Follower(0, 6);
    this.setBalance(100, 10, false);
    this.dirtyBalance = true;
  }

  setBalance(balance, bet, busted) {
    this.balanceState.balance = balance;
    this.balanceState.bet = bet;
    this.balanceState.busted = busted;
    this.dirtyBalance = true;
  }

  flashBalance(color = '#5f9cff') {
    this.balanceState.flashColor = color;
    this.balanceFlash.value = 1;
    this.balanceFlash.target = 1;
    this.tweens.add({
      dur: 0.9, from: 1, to: 0, ease: easeOutQuart,
      onUpdate: (v) => {
        this.balanceFlash.target = v;
        this.balanceFlash.value = Math.max(this.balanceFlash.value, v * 0.9);
        this.dirtyBalance = true;
      },
    });
    this.dirtyBalance = true;
  }

  // ---------------------------------------------------------------- spin

  /**
   * @param {{stops:number[], anticipation:boolean}} result
   * @returns {Promise<void>} resolves when every reel has landed
   */
  spin({ stops, anticipation = false }) {
    this.spinning = true;
    this.excite = 1;
    this.jolt = 1;
    this.joltVel = 0;

    const promises = [];
    for (let i = 0; i < 3; i++) {
      const delay = i * 0.11;
      // Travel a whole number of strips past the current position. A cell sits
      // facing the glass at local angle k*STEP, so rotation -k*STEP centres
      // stop k; the landing angle is therefore the negation of the stop index.
      const from = this.rotStops[i];
      const extraSpins = (4 + i * 2) * STRIP_LENGTH;
      const landing = (STRIP_LENGTH - stops[i]) % STRIP_LENGTH;
      const target = Math.ceil(from / STRIP_LENGTH) * STRIP_LENGTH + extraSpins + landing;

      // Last reel takes a long, teasing crawl when two symbols already match.
      const teasing = anticipation && i === 2;
      const dur = 1.15 + i * 0.2 + (teasing ? 1.05 : 0) + Math.random() * 0.05;

      this.spinState[i] = 'spin';
      promises.push(new Promise((resolve) => {
        this.tweens.add({
          delay,
          dur,
          from,
          to: target,
          ease: easeOutQuart,
          onUpdate: (v, k) => {
            this.rotStops[i] = v;
            const speed = 1 - k;
            this.reels[i].smear.material.opacity = clamp(speed * 1.1, 0, 0.5);
            this.reels[i].light.intensity = clamp(speed * 0.9, 0, 0.9);
          },
          onDone: () => {
            this.rotStops[i] = target;
            this.reels[i].smear.material.opacity = 0;
            this.reels[i].light.intensity = 0;
            this.spinState[i] = 'idle';
            this.landReel(i, teasing);
            resolve();
          },
        });
      }));
    }

    return Promise.all(promises).then(() => {
      this.spinning = false;
    });
  }

  landReel(i, teased) {
    this.jolt = Math.max(this.jolt, teased ? 1.4 : 0.85);
    this.joltVel = -2.0;
    this.onReelLand?.(i, teased);

    const reel = this.reels[i];
    this.tweens.add({
      dur: 0.5, from: 0.7, to: 0, ease: easeOutQuart,
      onUpdate: (v) => { reel.light.intensity = v; },
    });
    this.tweens.add({
      dur: 0.28, from: 0, to: 1, ease: (t) => spring(t, 3.2, 7),
      onUpdate: (v) => { reel.group.position.y = WINDOW_Y - v * 0.012; },
    });
  }

  /** Strip index currently sitting on the payline. */
  centeredStop(i) {
    const rot = Math.round(this.rotStops[i]) % STRIP_LENGTH;
    return ((STRIP_LENGTH - rot) % STRIP_LENGTH + STRIP_LENGTH) % STRIP_LENGTH;
  }

  /** Pulse the centred cell of each reel, e.g. on a win. */
  highlight(reels, accent = '#ffffff') {
    const tint = new THREE.Color(accent);
    for (const i of reels) {
      const reel = this.reels[i];
      if (!reel) continue;
      const mat = reel.mats[this.centeredStop(i)];
      if (!mat) continue;
      this.tweens.add({
        dur: 1.3,
        from: 0,
        to: 1,
        onUpdate: (v) => {
          // Lerp toward the accent (never past white) so pale symbols keep
          // their detail; a small additive lift gives the bloom.
          const pulse = Math.sin(v * Math.PI);
          const lift = 1 + pulse * 0.12;
          mat.color.setRGB(
            lerp(1, tint.r, pulse * 0.3) * lift,
            lerp(1, tint.g, pulse * 0.3) * lift,
            lerp(1, tint.b, pulse * 0.3) * lift,
          );
        },
        onDone: () => mat.color.setRGB(1, 1, 1),
      });
    }
  }

  /** Seams and payline react to a winning line. */
  celebrate(tier) {
    this.winGlow = 1;
    this.excite = 1;
    const strength = tier === 'jackpot' ? 2.6 : tier === 'big' ? 1.8 : 1;
    this.tweens.add({
      dur: 1.4 * strength, from: 1, to: 0, ease: easeOutQuart,
      onUpdate: (v) => { this.winGlow = v; },
    });
    this.jolt = Math.max(this.jolt, 1.1 * strength);
    this.joltVel = -3.0 * strength;
  }

  pullLever() {
    this.tweens.add({
      dur: 0.22, from: this.lever.restZ, to: this.lever.pullZ, ease: easeOutQuart,
      onUpdate: (v) => { this.leverPull = v; },
    });
    this.tweens.add({
      delay: 0.34, dur: 0.85, from: this.lever.pullZ, to: this.lever.restZ,
      ease: (t) => easeOutBack(t, 1.55),
      onUpdate: (v) => { this.leverPull = v; },
    });
  }

  setTilt(nx, ny) {
    this.tiltX.target = clamp(ny, -1, 1);
    this.tiltY.target = clamp(nx, -1, 1);
  }

  setPointerHover(on) {
    this.hover = on;
  }

  update(dt) {
    this.time += dt;

    this.tiltX.step(dt);
    this.tiltY.step(dt);
    this.balanceFlash.step(dt);

    const t = this.time;
    // Restraint: a whisper of independent motion, so the object still feels
    // alive when the cursor never moves.
    const breathe = Math.sin(t * 0.62) * 0.006;
    const bob = Math.sin(t * 0.94) * 0.018;

    const leanX = this.tiltX.value * 0.058;
    const leanY = this.tiltY.value * 0.088;
    this.root.rotation.x = damp(this.root.rotation.x, leanX + breathe, 7, dt);
    this.root.rotation.y = damp(this.root.rotation.y, leanY, 7, dt);
    this.root.rotation.z = damp(this.root.rotation.z, -leanY * 0.05, 6, dt);
    this.root.position.y = bob;

    // Mechanical jolt on the Y axis with spring decay.
    this.joltVel += -this.jolt * 42 * dt;
    this.joltVel *= Math.exp(-7 * dt);
    this.jolt += this.joltVel * dt;
    this.body.position.y = this.jolt * 0.045;
    this.body.rotation.z = this.jolt * 0.009;

    this.excite = damp(this.excite, this.spinning ? 1 : 0.1, 3, dt);

    for (let i = 0; i < 3; i++) {
      const r = this.reels[i];
      r.drum.rotation.x = this.rotStops[i] * STEP;
      r.drum.position.z = Math.sin(t * 1.9 + i) * 0.0015;
    }

    if (this.lever) {
      this.lever.pivot.rotation.z = this.leverPull;
      this.knobMat.emissiveIntensity = 0;
    }

    // Seams breathe with the machine's state; on a win they flare.
    const seam = 0.16 + 0.3 * this.winGlow + this.excite * 0.16 + Math.sin(t * 1.1) * 0.03;
    this.seamMat.opacity = damp(this.seamMat.opacity, seam, 6, dt);

    const pl = this.paylineBase + this.winGlow * 0.55 + Math.sin(t * 1.7) * 0.03;
    this.payline.material.opacity = damp(this.payline.material.opacity, pl, 7, dt);

    this.pool.material.opacity = damp(
      this.pool.material.opacity,
      0.85 + this.winGlow * 0.12,
      5, dt,
    );

    this.updateBalance(dt, t);
  }

  updateBalance(dt, t) {
    const flash = clamp(this.balanceFlash.value, 0, 1);
    const needRedraw = this.dirtyBalance || Math.abs(flash - (this._lastFlash ?? -1)) > 0.004;
    if (needRedraw) {
      this._lastFlash = flash;
      this.dirtyBalance = false;
      this.balanceRedraw({
        balance: this.balanceState.balance,
        bet: this.balanceState.bet,
        busted: this.balanceState.busted,
        flash,
        flashColor: this.balanceState.flashColor,
      });
    }

    // The readout floats above the cabinet and counter-rotates to stay legible.
    const s = this.balanceSprite;
    s.position.y = 3.26 + Math.sin(t * 1.2) * 0.028 + this.winGlow * 0.03;
    s.scale.setScalar(1 + flash * 0.03 + this.winGlow * 0.02);
    s.rotation.z = -this.root.rotation.z * 0.7;
    s.rotation.y = -this.root.rotation.y * 0.55;
    s.rotation.x = -this.root.rotation.x * 0.4;
  }
}
