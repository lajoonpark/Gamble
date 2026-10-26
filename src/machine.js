import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STRIPS, STRIP_LENGTH } from './game.js';
import {
  marqueeTexture, balanceTexture, symbolTexture, streakTexture, glowTexture,
  paytableTexture,
} from './textures.js';
import { clamp, lerp, damp, Follower, Tweens, easeOutQuart, easeOutBack, spring } from './util.js';

const STRIP_LEN = STRIP_LENGTH;
const STEP = (Math.PI * 2) / STRIP_LEN;

// Cabinet proportions. Reels are viewed through a recessed window, so the
// drum sits behind the front face and the neighbouring symbols curve away.
const DRUM_R = 1.12;
const CELL_W = 0.98;
// 12 stops around the drum: one cell of arc, so 3 cells fill the window and
// the neighbouring symbols curve away just out of view.
const CELL_H = (Math.PI * 2 * DRUM_R) / STRIP_LEN;
const DRUM_Z = -0.62;
const WINDOW_Y = 0.34;
const WINDOW_W = 3.42;
const WINDOW_H = CELL_H * 3;
// Depth of the cabinet shell; the fascia (and everything mounted on it) sits
// at +CABINET_FRONT so trim and marquee stand proud of the body.
const CABINET_D = 1.45;
const CABINET_FRONT = CABINET_D / 2;
const CABINET_W = 4.0;
const CABINET_H = 4.35;

const PALETTE = {
  cabinet: 0x2a0a3c,
  cabinetDeep: 0x14041f,
  chrome: 0xeef2ff,
  gold: 0xffc95c,
  magenta: 0xff3fb0,
  cyan: 0x38e8ff,
  red: 0xff1f3d,
};

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
    this.tiltX = new Follower(0, 5.5);
    this.tiltY = new Follower(0, 5.5);
    this.jolt = 0;
    this.joltVel = 0;
    this.excite = 0;
    this.winGlow = 0;
    this.spinning = false;
    this.leverPull = 0;
    this.hover = false;
    this.onReelLand = null;

    this.mats = {
      chrome: new THREE.MeshPhysicalMaterial({
        color: PALETTE.chrome, metalness: 1, roughness: 0.16, envMapIntensity: 1.35,
      }),
      gold: new THREE.MeshPhysicalMaterial({
        color: PALETTE.gold, metalness: 1, roughness: 0.26, envMapIntensity: 1.2,
        clearcoat: 1, clearcoatRoughness: 0.18,
      }),
      lacquer: new THREE.MeshPhysicalMaterial({
        color: PALETTE.cabinet, metalness: 0.35, roughness: 0.22,
        clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.95,
      }),
      lacquerDeep: new THREE.MeshPhysicalMaterial({
        color: PALETTE.cabinetDeep, metalness: 0.3, roughness: 0.42,
        clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 0.7,
      }),
    };

    this.buildCabinet();
    this.buildReels();
    this.buildLever();
    this.buildMarquee();
    this.buildBulbs();
    this.buildBalance();
  }

  // ------------------------------------------------------------- cabinet

  /**
   * The cabinet is an open-fronted box: four fascia panels plus a shell, so the
   * reel window is a genuine hole with 1.45 units of depth instead of a decal
   * on a solid box (a solid front would occlude the drums entirely).
   */
  buildCabinet() {
    const { chrome, gold, lacquer, lacquerDeep } = this.mats;

    const W = CABINET_W;
    const H = CABINET_H;
    const D = CABINET_D;
    const halfW = W / 2;
    const halfH = H / 2;
    const front = D / 2;

    const winL = -WINDOW_W / 2;
    const winR = WINDOW_W / 2;
    const winB = WINDOW_Y - WINDOW_H / 2;
    const winT = WINDOW_Y + WINDOW_H / 2;

    const panel = (w, h, x, y, mat = lacquer, depth = D, z = 0) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, depth, 4, 0.06), mat);
      m.position.set(x, y, z);
      this.body.add(m);
      return m;
    };

    // Back, sides, top and bottom of the shell.
    panel(W - 0.1, H - 0.1, 0, 0, lacquerDeep, 0.12, -front + 0.06);
    panel(0.3, H, -halfW + 0.15, 0, lacquer);
    panel(0.3, H, halfW - 0.15, 0, lacquer);
    panel(W, 0.3, 0, halfH - 0.15, lacquer);
    panel(W, 0.3, 0, -halfH + 0.15, lacquer);

    // Front fascia: top band, bottom band and the two side pillars.
    panel(W, halfH - winT, 0, (winT + halfH) / 2, lacquer);
    panel(W, winB + halfH, 0, (winB - halfH) / 2, lacquer);
    panel(winL + halfW, WINDOW_H, (-halfW + winL) / 2, WINDOW_Y, lacquer);
    panel(halfW - winR, WINDOW_H, (winR + halfW) / 2, WINDOW_Y, lacquer);

    // Soft inner throat so the window has depth rather than a flat edge.
    const throatMat = new THREE.MeshStandardMaterial({
      color: 0x150a22, metalness: 0.55, roughness: 0.55, side: THREE.DoubleSide,
    });
    const throat = (w, h, x, y, rotX = 0, rotY = 0, z = 0) => {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w, h), throatMat);
      g.position.set(x, y, z);
      g.rotation.x = rotX;
      g.rotation.y = rotY;
      this.body.add(g);
    };
    throat(WINDOW_W, D * 0.86, 0, winT, Math.PI / 2, 0, -0.1);
    throat(WINDOW_W, D * 0.86, 0, winB, -Math.PI / 2, 0, -0.1);
    throat(D * 0.86, WINDOW_H, winL, WINDOW_Y, 0, Math.PI / 2, -0.1);
    throat(D * 0.86, WINDOW_H, winR, WINDOW_Y, 0, -Math.PI / 2, -0.1);

    const bez = (w, h, x, y, mat, d = 0.1, r = 0.03) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
      m.position.set(x, y, front + 0.03);
      this.body.add(m);
      return m;
    };
    // Gold frame, chrome hairline inside it.
    bez(WINDOW_W + 0.34, 0.11, 0, winT + 0.06, gold);
    bez(WINDOW_W + 0.34, 0.11, 0, winB - 0.06, gold);
    bez(0.11, WINDOW_H + 0.23, winL - 0.12, WINDOW_Y, gold);
    bez(0.11, WINDOW_H + 0.23, winR + 0.12, WINDOW_Y, gold);
    bez(WINDOW_W + 0.12, 0.028, 0, winT + 0.005, chrome, 0.06, 0.01);
    bez(WINDOW_W + 0.12, 0.028, 0, winB - 0.005, chrome, 0.06, 0.01);

    // Gold trim ribbon running around the whole fascia.
    const ribbon = (w, h, x, y) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.07, 3, 0.025), gold);
      m.position.set(x, y, front + 0.02);
      this.body.add(m);
    };
    ribbon(W - 0.06, 0.05, 0, winT + 0.30);
    ribbon(W - 0.06, 0.05, 0, -1.42);
    ribbon(0.05, 1.0, -1.72, 1.72);
    ribbon(0.05, 1.0, 1.72, 1.72);

    // Plinth.
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(4.32, 0.46, 1.72, 4, 0.1), lacquerDeep);
    plinth.position.set(0, -2.30, 0.01);
    this.body.add(plinth);

    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(4.0, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xffcf5c, toneMapped: false }),
    );
    skirt.position.set(0, -2.23, front + 0.12);
    this.body.add(skirt);
    this.skirt = skirt;

    // Paytable on the lower fascia.
    const pay = new THREE.Mesh(
      new THREE.PlaneGeometry(2.62, 0.655),
      new THREE.MeshBasicMaterial({ map: paytableTexture(), transparent: true, toneMapped: false }),
    );
    pay.position.set(0, -1.13, front + 0.045);
    this.body.add(pay);
    this.paytable = pay;

    // Coin tray on the lower fascia.
    const trayLip = new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.28, 0.3, 4, 0.09), chrome);
    trayLip.position.set(0, -1.92, front + 0.02);
    trayLip.rotation.x = -0.26;
    this.body.add(trayLip);

    const trayVoid = new THREE.Mesh(
      new RoundedBoxGeometry(1.82, 0.2, 0.1, 4, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x05010a }),
    );
    trayVoid.position.set(0, -1.91, front + 0.13);
    trayVoid.rotation.x = -0.26;
    this.body.add(trayVoid);

    // Crown.
    const crown = new THREE.Mesh(new RoundedBoxGeometry(4.06, 0.28, 1.5, 4, 0.09), gold);
    crown.position.set(0, halfH + 0.06, 0);
    this.body.add(crown);

    // Side chrome rails.
    for (const sgn of [-1, 1]) {
      const rail = new THREE.Mesh(new RoundedBoxGeometry(0.1, H - 0.5, 1.16, 4, 0.04), chrome);
      rail.position.set(sgn * (halfW + 0.04), 0, 0);
      this.body.add(rail);
    }

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 3.2),
      new THREE.MeshBasicMaterial({
        map: glowTexture('rgba(255,60,190,0.5)', 'rgba(255,60,190,0)', 256),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, -2.55, 0.2);
    this.body.add(glow);
    this.underGlow = glow;
  }

  // --------------------------------------------------------------- reels

  buildReels() {
    // The dark void behind the drums.
    const voidBox = new THREE.Mesh(
      new THREE.BoxGeometry(WINDOW_W, WINDOW_H, 1.4),
      new THREE.MeshStandardMaterial({
        color: 0x08030f, metalness: 0.3, roughness: 0.9, side: THREE.BackSide,
      }),
    );
    voidBox.position.set(0, WINDOW_Y, 0.02);
    this.body.add(voidBox);

    const xStart = -1.06;
    const gap = 1.06;

    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      group.position.set(xStart + i * gap, WINDOW_Y, DRUM_Z);
      this.body.add(group);

      // Cylinder body of the drum, slightly proud of the symbol faces.
      const backer = new THREE.Mesh(
        new THREE.CylinderGeometry(DRUM_R * 0.999, DRUM_R * 0.999, CELL_W, 32, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x07030d, metalness: 0.35, roughness: 0.88 }),
      );
      backer.rotation.z = Math.PI / 2;
      group.add(backer);

      const drum = new THREE.Group();
      group.add(drum);

      const cells = [];
      const mats = [];
      for (let k = 0; k < STRIP_LEN; k++) {
        const symbol = STRIPS[i][k];
        const tex = symbolTexture(symbol);
        const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
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

      // Dark seams between symbols.
      for (let k = 0; k < STRIP_LEN; k++) {
        const a = (k + 0.5) * STEP;
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(CELL_W, 0.02, 0.015),
          new THREE.MeshStandardMaterial({ color: 0x160828, metalness: 0.8, roughness: 0.3 }),
        );
        bar.position.set(0, -Math.sin(a) * (DRUM_R + 0.006), Math.cos(a) * (DRUM_R + 0.006));
        bar.rotation.x = a;
        drum.add(bar);
      }

      // Motion smear during the spin.
      const smear = new THREE.Mesh(
        new THREE.CylinderGeometry(DRUM_R * 1.02, DRUM_R * 1.02, CELL_W * 0.98, 32, 1, true),
        new THREE.MeshBasicMaterial({
          map: streakTexture('#ffffff'),
          transparent: true, opacity: 0, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
        }),
      );
      smear.rotation.z = Math.PI / 2;
      group.add(smear);

      // Only used for the brief flare when a reel lands; the printed cells are
      // emissive, so the drums need no standing illumination.
      const light = new THREE.PointLight(0xfff2e0, 0, 2.6, 2);
      light.position.set(0, 0.1, 0.55);
      group.add(light);

      this.reels.push({ group, drum, cells, mats, smear, light, index: i });
    }

    // Curvature shading: dark at the window edges, bright through the middle.
    const shadeCanvas = document.createElement('canvas');
    shadeCanvas.width = 8;
    shadeCanvas.height = 256;
    const sctx = shadeCanvas.getContext('2d');
    const sg = sctx.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, 'rgba(0,0,0,0.85)');
    sg.addColorStop(0.13, 'rgba(0,0,0,0.34)');
    sg.addColorStop(0.32, 'rgba(0,0,0,0)');
    sg.addColorStop(0.5, 'rgba(255,235,215,0.05)');
    sg.addColorStop(0.68, 'rgba(0,0,0,0)');
    sg.addColorStop(0.87, 'rgba(0,0,0,0.34)');
    sg.addColorStop(1, 'rgba(0,0,0,0.85)');
    sctx.fillStyle = sg;
    sctx.fillRect(0, 0, 8, 256);
    const shadeTex = new THREE.CanvasTexture(shadeCanvas);
    const shade = new THREE.Mesh(
      new THREE.PlaneGeometry(WINDOW_W, WINDOW_H),
      new THREE.MeshBasicMaterial({
        map: shadeTex, transparent: true, depthWrite: false, toneMapped: false,
      }),
    );
    shade.position.set(0, WINDOW_Y, CABINET_FRONT + 0.06);
    this.body.add(shade);

    // Glass.
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(WINDOW_W, WINDOW_H),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, transparent: true, opacity: 0.05,
        roughness: 0.05, metalness: 0, clearcoat: 1,
      }),
    );
    glass.position.set(0, WINDOW_Y, 0.86);
    this.body.add(glass);

    // Payline.
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xff2244, transparent: true, opacity: 0.3, toneMapped: false,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_W + 0.06, 0.018), lineMat);
    line.position.set(0, WINDOW_Y, 0.885);
    this.body.add(line);
    this.payline = line;

    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.ConeGeometry(0.075, 0.17, 4),
        new THREE.MeshBasicMaterial({ color: 0xff3355, toneMapped: false }),
      );
      cap.position.set(s * (WINDOW_W / 2 + 0.04), WINDOW_Y, 0.885);
      cap.rotation.z = -s * Math.PI / 2;
      cap.rotation.y = Math.PI / 4;
      this.body.add(cap);
    }
  }

  // --------------------------------------------------------------- lever

  buildLever() {
    // Housing bolted to the right flank.
    const housing = new THREE.Mesh(
      new RoundedBoxGeometry(0.34, 0.62, 0.52, 4, 0.09),
      this.mats.lacquerDeep,
    );
    housing.position.set(CABINET_W / 2 + 0.10, 0.42, 0.30);
    this.body.add(housing);

    const plate = new THREE.Mesh(
      new RoundedBoxGeometry(0.08, 0.5, 0.42, 3, 0.04),
      this.mats.gold,
    );
    plate.position.set(CABINET_W / 2 + 0.28, 0.42, 0.30);
    this.body.add(plate);

    // Pivot sits outside the flank so the arm sweeps clear of the cabinet.
    const pivot = new THREE.Group();
    pivot.position.set(CABINET_W / 2 + 0.34, 0.46, 0.30);
    this.body.add(pivot);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.22, 24), this.mats.chrome);
    hub.rotation.z = Math.PI / 2;
    pivot.add(hub);

    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.30, 18), this.mats.gold);
    boss.rotation.z = Math.PI / 2;
    pivot.add(boss);

    const arm = new THREE.Group();
    pivot.add(arm);

    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.07, 1.62, 18), this.mats.chrome);
    rod.position.y = 0.85;
    arm.add(rod);

    // Ribbed grip near the hub.
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.013, 8, 20), this.mats.gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.26 + i * 0.075;
      arm.add(ring);
    }

    const knobMat = new THREE.MeshPhysicalMaterial({
      color: 0xff1a45, metalness: 0.18, roughness: 0.09,
      clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x3a0008, emissiveIntensity: 0.9,
    });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.235, 32, 24), knobMat);
    knob.position.y = 1.72;
    arm.add(knob);
    this.knobMat = knobMat;

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.03, 10, 26), this.mats.gold);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.54;
    arm.add(collar);

    const knobGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.40, 20, 16),
      new THREE.MeshBasicMaterial({
        color: 0xff2450, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    knobGlow.position.y = 1.72;
    arm.add(knobGlow);

    const restZ = 0.10;
    pivot.rotation.z = restZ;
    // Negative Z swings the arm clockwise, so the knob drops toward the floor.
    this.lever = { pivot, arm, knob, knobGlow, restZ, pullZ: -1.30 };
  }

  // ------------------------------------------------------------- marquee

  buildMarquee() {
    const tex = marqueeTexture({ text: 'LUCKY 7', sub: 'DIAMOND EDITION' });
    const panel = new THREE.Mesh(
      new RoundedBoxGeometry(3.62, 1.24, 0.16, 4, 0.07),
      new THREE.MeshPhysicalMaterial({
        color: 0x140424, metalness: 0.65, roughness: 0.24, clearcoat: 1,
        clearcoatRoughness: 0.1, envMapIntensity: 0.9,
      }),
    );
    panel.position.set(0, 1.72, CABINET_FRONT + 0.02);
    this.body.add(panel);

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(3.36, 1.05),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    );
    plate.position.set(0, 1.72, CABINET_FRONT + 0.10);
    this.body.add(plate);
    this.marquee = plate;
  }

  // --------------------------------------------------------------- bulbs

  buildBulbs() {
    const positions = [];
    const halfW = WINDOW_W / 2 + 0.27;
    const yBot = WINDOW_Y - WINDOW_H / 2 - 0.19;
    const yTop = WINDOW_Y + WINDOW_H / 2 + 0.19;
    const z = CABINET_FRONT + 0.075;

    // Bulb rails down both sides of the window.
    const rows = 9;
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      const y = lerp(yBot, yTop, t);
      positions.push([-halfW, y, z]);
      positions.push([halfW, y, z]);
    }
    // Along the crown.
    for (let i = 0; i <= 13; i++) {
      const x = lerp(-1.80, 1.80, i / 13);
      positions.push([x, CABINET_H / 2 + 0.13, z]);
    }

    const geo = new THREE.SphereGeometry(0.046, 12, 10);
    // White bulb plus a bright bloom shell so each one reads as a glowing lamp.
    const mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      positions.length,
    );
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(positions.length * 3), 3,
    );

    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    positions.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2]);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setRGB(1, 0.8, 0.3));
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.body.add(mesh);

    const halos = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({
        map: glowTexture('rgba(255,220,140,1)', 'rgba(255,150,40,0)', 128),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        toneMapped: false, opacity: 0.85,
      }),
      positions.length,
    );
    positions.forEach((p, i) => {
      m.makeTranslation(p[0], p[1], p[2] + 0.03);
      halos.setMatrixAt(i, m);
    });
    halos.instanceMatrix.needsUpdate = true;
    this.body.add(halos);

    this.bulbs = { mesh, halos, count: positions.length, positions };
  }

  buildBalance() {
    const { texture, redraw } = balanceTexture();
    this.balanceRedraw = redraw;
    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, toneMapped: false, depthWrite: false,
    });
    const sprite = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.16), mat);
    sprite.position.set(0, 3.30, 0.1);
    this.root.add(sprite);
    this.balanceSprite = sprite;

    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 2.4),
      new THREE.MeshBasicMaterial({
        map: glowTexture('rgba(255,190,90,0.35)', 'rgba(255,120,200,0)', 256),
        transparent: true, opacity: 0.7, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    );
    halo.position.set(0, 3.30, 0.02);
    this.root.add(halo);
    this.balanceHalo = halo;

    this.balanceState = { balance: 100, bet: 10, busted: false, flash: 0, flashColor: '#39ffa0' };
    this.balanceFlash = new Follower(0, 6);
    this.balanceShown = 100;
    this.setBalance(100, 10, false);
  }

  setBalance(balance, bet, busted) {
    this.balanceState.balance = balance;
    this.balanceState.bet = bet;
    this.balanceState.busted = busted;
    this.dirtyBalance = true;
  }

  flashBalance(color = '#39ffa0') {
    this.balanceState.flashColor = color;
    this.balanceFlash.value = 1;
    this.balanceFlash.target = 1;
    this.tweens.add({ dur: 0.9, from: 1, to: 0, ease: easeOutQuart, onUpdate: (v) => { this.balanceFlash.target = v; this.balanceFlash.value = Math.max(this.balanceFlash.value, v * 0.9); this.dirtyBalance = true; } });
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
            this.reels[i].smear.material.opacity = clamp(speed * 1.25, 0, 0.72);
            this.reels[i].light.intensity = clamp(speed * 1.1, 0, 1.1);
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
    this.jolt = Math.max(this.jolt, teased ? 1.5 : 0.9);
    this.joltVel = -2.2;
    this.onReelLand?.(i, teased);

    const reel = this.reels[i];
    this.tweens.add({
      dur: 0.5,
      from: 0.85,
      to: 0,
      ease: easeOutQuart,
      onUpdate: (v) => { reel.light.intensity = v; },
    });
    this.tweens.add({
      dur: 0.28,
      from: 0,
      to: 1,
      ease: (t) => spring(t, 3.2, 7),
      onUpdate: (v) => { reel.group.position.y = WINDOW_Y - v * 0.016; },
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
          const lift = 1 + pulse * 0.28;
          mat.color.setRGB(
            lerp(1, tint.r, pulse * 0.55) * lift,
            lerp(1, tint.g, pulse * 0.55) * lift,
            lerp(1, tint.b, pulse * 0.55) * lift,
          );
        },
        onDone: () => mat.color.setRGB(1, 1, 1),
      });
    }
  }

  /** Bulbs, lights and payline react to a winning line. */
  celebrate(tier) {
    this.winGlow = 1;
    this.excite = 1;
    const strength = tier === 'jackpot' ? 3 : tier === 'big' ? 1.9 : 1;
    this.tweens.add({
      dur: 1.4 * strength,
      from: 1,
      to: 0,
      ease: easeOutQuart,
      onUpdate: (v) => { this.winGlow = v; },
    });
    this.jolt = Math.max(this.jolt, 1.2 * strength);
    this.joltVel = -3.4 * strength;
    this.tweens.add({
      dur: 0.7,
      from: 0.42,
      to: 0.36,
      ease: easeOutQuart,
      onUpdate: (v) => { this.payline.material.opacity = v; },
    });
  }

  pullLever() {
    this.tweens.add({
      dur: 0.22,
      from: this.lever.restZ,
      to: this.lever.pullZ,
      ease: easeOutQuart,
      onUpdate: (v) => { this.leverPull = v; },
    });
    this.tweens.add({
      delay: 0.34,
      dur: 0.85,
      from: this.lever.pullZ,
      to: this.lever.restZ,
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

    // Idle breathing plus pointer tilt.
    const t = this.time;
    const breathe = Math.sin(t * 0.7) * 0.012;
    const bob = Math.sin(t * 1.1) * 0.035;

    const leanX = this.tiltX.value * 0.17;
    const leanY = this.tiltY.value * 0.26;
    this.root.rotation.x = damp(this.root.rotation.x, leanX + breathe, 9, dt);
    this.root.rotation.y = damp(this.root.rotation.y, leanY, 9, dt);
    this.root.rotation.z = damp(this.root.rotation.z, -leanY * 0.06, 8, dt);
    this.root.position.y = bob + this.excite * 0.0;

    // Mechanical jolt on the Y axis with spring decay.
    this.joltVel += -this.jolt * 42 * dt;
    this.joltVel *= Math.exp(-7 * dt);
    this.jolt += this.joltVel * dt;
    this.body.position.y = this.jolt * 0.05;
    this.body.rotation.z = this.jolt * 0.012;

    this.excite = damp(this.excite, this.spinning ? 1 : 0.12, 3, dt);

    for (let i = 0; i < 3; i++) {
      const r = this.reels[i];
      r.drum.rotation.x = this.rotStops[i] * STEP;
      // Subtle wobble of each drum against its neighbours.
      r.drum.position.z = Math.sin(t * 2.1 + i) * 0.002;
    }

    // Lever.
    if (this.lever) {
      this.lever.pivot.rotation.z = this.leverPull;
      this.lever.knobGlow.material.opacity = 0.13 + 0.08 * Math.sin(t * 3.4) + this.excite * 0.2;
      this.knobMat.emissiveIntensity = 0.7 + this.excite * 1.4;
    }

    this.updateBulbs(t);
    this.updateBalance(dt, t);

    const hoverLift = this.hover ? 0.02 : 0;
    this.underGlow.scale.setScalar(1 + this.winGlow * 0.12 + hoverLift);
    this.underGlow.material.opacity = 0.55 + this.winGlow * 0.5;

    const pl = 0.30 + 0.10 * Math.sin(t * 2.4) + this.winGlow * 0.5;
    this.payline.material.opacity = damp(this.payline.material.opacity, pl, 8, dt);
  }

  updateBulbs(t) {
    const { mesh, count } = this.bulbs;
    const c = new THREE.Color();
    const chase = t * (this.spinning ? 7.5 : 2.4);
    const win = this.winGlow;

    for (let i = 0; i < count; i++) {
      const p = this.bulbs.positions[i];
      const around = (p[0] + 2.0) * 2.6 + (p[1] + 0.6) * 1.7;
      const wave = 0.5 + 0.5 * Math.sin(chase - around * 1.6);
      const lit = clamp(wave ** 2.2);

      if (win > 0.02) {
        const strobe = 0.5 + 0.5 * Math.sin(t * 26 + i * 1.9);
        const k = lit * (0.45 + win) + strobe * win * 0.8;
        c.setRGB(1.0, 0.55 + 0.45 * strobe, 0.12);
        c.multiplyScalar(clamp(k, 0, 3.2));
      } else {
        const warm = 0.35 + 1.15 * lit;
        c.setRGB(1.0 * warm, (0.62 + 0.3 * lit) * warm, (0.18 + 0.1 * lit) * warm);
      }
      mesh.setColorAt(i, c);
    }
    mesh.instanceColor.needsUpdate = true;
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

    // The readout floats: gentle bob, and it counter-rotates so it stays legible.
    const s = this.balanceSprite;
    s.position.y = 3.30 + Math.sin(t * 1.35) * 0.055 + this.winGlow * 0.05;
    s.scale.setScalar(1 + flash * 0.045 + this.winGlow * 0.03);
    s.rotation.z = -this.root.rotation.z * 0.55;
    s.rotation.y = -this.root.rotation.y * 0.42;
    s.rotation.x = -this.root.rotation.x * 0.3;
    this.balanceHalo.rotation.copy(s.rotation);
    this.balanceHalo.position.y = s.position.y;
    this.balanceHalo.material.opacity = 0.5 + 0.12 * Math.sin(t * 1.6) + flash * 0.4;
  }
}
