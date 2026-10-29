import * as THREE from 'three';
import { moteTexture, glowTexture } from './textures.js';
import { clamp } from './util.js';

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

// Wins celebrate in light, not colour: ice-white cores with a single amber
// accent reserved for the jackpot. That keeps the palette monochrome while
// still giving each tier a distinct feel.
const ICE = '#dfeeff';
const COLD = '#8fb9ff';
const ACCENT = '#5f9cff';
const AMBER = '#ffd9a0';

/**
 * One pooled Points system per look so we never allocate during a spin.
 * Each particle: p (pos), v (vel), life, ttl, size, gravity, drag.
 */
export class Particles {
  constructor({ count = 420, map, blending = THREE.AdditiveBlending } = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.siz = new Float32Array(count);
    this.baseSize = new Float32Array(count);
    this.life = new Float32Array(count);
    this.ttl = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1));

    // Custom material: PointsMaterial's `size` is a uniform, so per-particle
    // sizes need their own attribute and shader.
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uScale: { value: 190 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec3 aColor;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.001, -mv.z);
          vAlpha = clamp(aSize * 6.0, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          if (tex.a < 0.01) discard;
          gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending,
      toneMapped: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
  }

  spawn({ x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, color = '#ffffff', size = 0.2, ttl = 1, gravity = 0, drag = 0 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    tmpColor.set(color);
    this.col[i3] = tmpColor.r; this.col[i3 + 1] = tmpColor.g; this.col[i3 + 2] = tmpColor.b;
    this.baseSize[i] = size;
    this.siz[i] = 0;
    this.life[i] = 0;
    this.ttl[i] = ttl;
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt) {
    const { pos, vel, life, ttl, siz, baseSize, grav, drag } = this;
    for (let i = 0; i < this.count; i++) {
      if (ttl[i] <= 0) {
        if (siz[i] !== 0) siz[i] = 0;
        continue;
      }
      life[i] += dt;
      const k = life[i] / ttl[i];
      if (k >= 1) {
        ttl[i] = 0;
        siz[i] = 0;
        continue;
      }
      const i3 = i * 3;
      vel[i3 + 1] += grav[i] * dt;
      const d = Math.exp(-drag[i] * dt);
      vel[i3] *= d; vel[i3 + 1] *= d; vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      // Pop in, fade out.
      const pop = k < 0.14 ? k / 0.14 : 1;
      const fade = 1 - clamp((k - 0.55) / 0.45);
      siz[i] = baseSize[i] * pop * fade;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

/**
 * Stardust: a drifting swarm of tiny lit motes rather than a coin fountain.
 * They rise, slow, and settle — the visual language of a win is "the air fills
 * with light", not "money falls out".
 */
export class DustSwarm {
  constructor({ max = 320, origin = new THREE.Vector3(0, -1.2, 1.0) } = {}) {
    this.origin = origin.clone();
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({
        map: moteTexture(), transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.max = max;
    this.items = Array.from({ length: max }, () => ({
      active: false,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      spin: 0,
      w: 0,
      life: 0,
      ttl: 1,
      scale: 1,
    }));
    this.cursor = 0;
    this.hideAll();
  }

  hideAll() {
    for (let i = 0; i < this.max; i++) {
      tmp.position.set(0, 0, 0);
      tmp.scale.setScalar(0);
      tmp.updateMatrix();
      this.mesh.setMatrixAt(i, tmp.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  burst({ count = 90, power = 1, spread = 2.2, origin = null, lift = 2.4, size = 1 }) {
    const o = origin ?? this.origin;
    for (let n = 0; n < count; n++) {
      const it = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      it.active = true;
      it.p.copy(o);
      it.p.x += (Math.random() - 0.5) * spread * 0.55;
      it.p.y += (Math.random() - 0.5) * 0.3;
      // Mostly outward and up, with a little depth.
      const a = Math.random() * Math.PI * 2;
      const spin = (0.5 + Math.random() * 1.6) * power;
      it.v.set(
        Math.cos(a) * spin,
        Math.sin(a) * spin * 0.55 + (0.6 + Math.random() * 0.8) * lift,
        (Math.random() * 0.7 + 0.1) * 1.2,
      );
      it.spin = Math.random() * Math.PI * 2;
      it.w = (Math.random() - 0.5) * 5;
      it.life = 0;
      // Long, slow lifetimes: motes should hang in the air, not fall.
      it.ttl = 1.8 + Math.random() * 1.8;
      it.scale = size * (0.5 + Math.random() * 0.9);
    }
  }

  update(dt) {
    // Barely any gravity and heavy drag: dust drifts and settles.
    const g = -1.1;
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      it.life += dt;
      if (it.life >= it.ttl) {
        it.active = false;
        tmp.position.set(0, -999, 0);
        tmp.scale.setScalar(0);
        tmp.updateMatrix();
        this.mesh.setMatrixAt(i, tmp.matrix);
        continue;
      }
      it.v.y += g * dt;
      it.v.multiplyScalar(Math.exp(-1.35 * dt));
      it.p.addScaledVector(it.v, dt);
      it.spin += it.w * dt;

      const k = it.life / it.ttl;
      const pop = k < 0.1 ? k / 0.1 : 1;
      const fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      tmp.position.copy(it.p);
      tmp.rotation.set(0, 0, it.spin);
      tmp.scale.setScalar(it.scale * pop * fade);
      tmp.updateMatrix();
      this.mesh.setMatrixAt(i, tmp.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Full effects rig: sparks, dust, screen flash and shockwave rings. */
export class Effects {
  constructor(scene, machine) {
    this.scene = scene;
    this.machine = machine;

    this.sparks = new Particles({
      count: 520,
      map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 128),
    });
    scene.add(this.sparks.points);

    this.dust = new Particles({
      count: 240,
      map: glowTexture('rgba(235,245,255,1)', 'rgba(150,190,255,0)', 128),
      blending: THREE.NormalBlending,
    });
    scene.add(this.dust.points);

    this.swarm = new DustSwarm();
    scene.add(this.swarm.mesh);

    this.rings = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.96, 1.0, 128),
        new THREE.MeshBasicMaterial({
          color: 0xdfeeff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      // Squashed to a wide ellipse so it reads as light sweeping across the
      // payline rather than a circle drawn on the glass.
      ring.scale.y = 0.16;
      ring.position.set(0, 0.42, 1.05);
      ring.visible = false;
      scene.add(ring);
      this.rings.push({ mesh: ring, t: 0, active: false, dur: 1, scale: 1 });
    }

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 40),
      new THREE.MeshBasicMaterial({
        color: 0xdfeeff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    this.flash.position.set(0, 0, 4.5);
    scene.add(this.flash);
    this.flashLevel = 0;

    this.lingering = 0;
  }

  ring({ color = 0xdfeeff, dur = 0.9, scale = 1.6 } = {}) {
    const r = this.rings.find((x) => !x.active) ?? this.rings[0];
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.scale = scale;
    r.mesh.visible = true;
    r.mesh.material.color.set(color);
    r.mesh.material.opacity = 0.34;
  }

  dustSpray(power = 1, count = 90) {
    this.swarm.burst({
      count: Math.round(count),
      power,
      origin: new THREE.Vector3(0, -1.6, 1.05),
      spread: 2.4,
      lift: 2.6 * power,
    });
  }

  sparkBurst({ count = 60, color = ICE, power = 1, at = null, size = 0.26, ttl = 1.1 } = {}) {
    const o = at ?? new THREE.Vector3(0, 0.28, 1.2);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.8 + Math.random() * 3.0) * power;
      this.sparks.spawn({
        x: o.x + (Math.random() - 0.5) * 1.6,
        y: o.y + (Math.random() - 0.5) * 0.8,
        z: o.z + Math.random() * 0.5,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.8 + 1.1 * power,
        vz: 0.6 + Math.random() * 1.3,
        color,
        size: size * (0.5 + Math.random() * 0.85),
        ttl: ttl * (0.65 + Math.random() * 0.7),
        gravity: -2.0,
        drag: 1.7,
      });
    }
  }

  /** Reel landing puff. */
  landPuff(i) {
    const x = -1.16 + i * 1.16;
    for (let n = 0; n < 14; n++) {
      this.dust.spawn({
        x: x + (Math.random() - 0.5) * 0.6,
        y: 0.28 + (Math.random() - 0.5) * 0.9,
        z: 1.0,
        vx: (Math.random() - 0.5) * 1.0,
        vy: (Math.random() - 0.5) * 0.6,
        vz: 0.4 + Math.random() * 0.4,
        color: COLD,
        size: 0.12 + Math.random() * 0.22,
        ttl: 0.55 + Math.random() * 0.45,
        drag: 3.2,
      });
    }
  }

  screenFlash(color = '#ffffff', amount = 0.3, dur = 0.45) {
    this.flash.material.color.set(color);
    this.flashLevel = amount;
    this.flashDur = dur;
    this.flashT = 0;
    this.flash.material.opacity = amount;
  }

  smallWin() {
    this.sparkBurst({ count: 34, color: ICE, power: 0.75, ttl: 0.9 });
    this.screenFlash(COLD, 0.02, 0.28);
  }

  mediumWin() {
    this.sparkBurst({ count: 80, color: ICE, power: 1.2 });
    this.sparkBurst({ count: 30, color: COLD, power: 1.0, at: new THREE.Vector3(0, 1.2, 1.0) });
    this.dustSpray(0.9, 45);
    this.ring({ color: 0xdfeeff, dur: 0.8, scale: 1.4 });
    this.screenFlash(ICE, 0.03, 0.34);
  }

  bigWin() {
    this.sparkBurst({ count: 110, color: ICE, power: 1.7, ttl: 1.5, size: 0.19 });
    this.sparkBurst({ count: 70, color: COLD, power: 1.6, at: new THREE.Vector3(-1.3, 0.6, 1.1) });
    this.sparkBurst({ count: 70, color: ACCENT, power: 1.6, at: new THREE.Vector3(1.3, 0.6, 1.1) });
    this.dustSpray(1.5, 130);
    this.ring({ color: 0xdfeeff, dur: 0.9, scale: 1.7 });
    this.ring({ color: 0x8fb9ff, dur: 1.2, scale: 2.2 });
    this.screenFlash(ICE, 0.045, 0.45);
  }

  jackpot() {
    this.sparkBurst({ count: 150, color: ICE, power: 2.0, ttl: 1.9, size: 0.2 });
    this.sparkBurst({ count: 60, color: AMBER, power: 1.7, ttl: 2.0, size: 0.18 });
    for (let i = 0; i < 6; i++) {
      setTimeout(() => this.dustSpray(1.4, 34), i * 190);
    }
    this.ring({ color: 0xdfeeff, dur: 1.0, scale: 1.9 });
    this.ring({ color: 0x8fb9ff, dur: 1.35, scale: 2.4 });
    this.ring({ color: 0xffd9a0, dur: 1.7, scale: 2.9 });
    this.screenFlash(ICE, 0.06, 0.6);
    this.lingering = 1.8;
  }

  update(dt) {
    this.sparks.update(dt);
    this.dust.update(dt);
    this.swarm.update(dt);

    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = clamp(r.t / r.dur);
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const sc = 0.4 + k * r.scale;
      r.mesh.scale.set(sc, sc * 0.16, 1);
      r.mesh.material.opacity = 0.34 * (1 - k) ** 2.0;
    }

    if (this.flashLevel > 0) {
      this.flashT += dt;
      const k = clamp(this.flashT / this.flashDur);
      this.flash.material.opacity = this.flashLevel * (1 - k) ** 2;
      if (k >= 1) this.flashLevel = 0;
    }

    // After a jackpot the air keeps glittering for a moment.
    if (this.lingering > 0) {
      this.lingering -= dt;
      if (Math.random() < 0.5) {
        this.sparks.spawn({
          x: (Math.random() - 0.5) * 4.6,
          y: 2.4 + Math.random() * 1.4,
          z: 0.8 + Math.random(),
          vx: (Math.random() - 0.5) * 0.7,
          vy: -0.5 - Math.random() * 0.8,
          vz: 0,
          color: Math.random() < 0.5 ? ICE : COLD,
          size: 0.1 + Math.random() * 0.18,
          ttl: 1.6,
          gravity: -0.5,
          drag: 0.3,
        });
      }
    }
  }
}
