import * as THREE from 'three';
import { coinTexture, glowTexture } from './textures.js';
import { clamp } from './util.js';

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();

/**
 * One pooled Points system per look so we never allocate during a spin.
 * Each particle: p (pos), v (vel), life, ttl, size, spin, hue.
 */
export class Particles {
  constructor({ count = 420, map, blending = THREE.AdditiveBlending, sizeAttenuation = true } = {}) {
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

/** Coin fountain that bursts from the machine and falls under gravity. */
export class CoinBurst {
  constructor({ max = 260, origin = new THREE.Vector3(0, -1.3, 1.2) } = {}) {
    this.origin = origin.clone();
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({
        map: coinTexture(), transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.NormalBlending, side: THREE.DoubleSide,
      }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.max = max;
    this.items = Array.from({ length: max }, () => ({
      active: false, p: new THREE.Vector3(), v: new THREE.Vector3(),
      rx: 0, ry: 0, wx: 0, wy: 0, life: 0, ttl: 1, scale: 1,
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

  burst({ count = 90, power = 1, spread = 2.2, origin = null, up = 7.4, size = 1 }) {
    const o = origin ?? this.origin;
    for (let n = 0; n < count; n++) {
      const it = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      it.active = true;
      it.p.copy(o);
      it.p.x += (Math.random() - 0.5) * spread * 0.5;
      it.p.y += (Math.random() - 0.5) * 0.12;
      it.v.set(
        (Math.random() - 0.5) * 5.4 * power,
        (0.45 + Math.random() * 0.85) * up * power * 0.42,
        (Math.random() * 0.8 + 0.1) * 2.4 * power,
      );
      it.rx = Math.random() * Math.PI * 2;
      it.ry = Math.random() * Math.PI * 2;
      it.wx = (Math.random() - 0.5) * 16;
      it.wy = (Math.random() - 0.5) * 16;
      it.life = 0;
      it.ttl = 1.5 + Math.random() * 1.1;
      it.scale = size * (0.62 + Math.random() * 0.6);
    }
  }

  update(dt, carry = null) {
    const g = -13.5;
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
      it.v.multiplyScalar(Math.exp(-0.55 * dt));
      it.p.addScaledVector(it.v, dt);
      it.rx += it.wx * dt;
      it.ry += it.wy * dt;

      const k = it.life / it.ttl;
      const fade = k > 0.78 ? 1 - (k - 0.78) / 0.22 : 1;
      tmp.position.copy(it.p);
      tmp.rotation.set(it.rx, it.ry, 0);
      tmp.scale.setScalar(it.scale * fade);
      tmp.updateMatrix();
      this.mesh.setMatrixAt(i, tmp.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Full effects rig: sparks, coin spray, screen flash and shockwave rings. */
export class Effects {
  constructor(scene, machine) {
    this.scene = scene;
    this.machine = machine;

    this.sparks = new Particles({
      count: 500,
      map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 128),
    });
    scene.add(this.sparks.points);

    this.dust = new Particles({
      count: 220,
      map: glowTexture('rgba(255,235,255,1)', 'rgba(255,180,240,0)', 128),
      blending: THREE.NormalBlending,
    });
    scene.add(this.dust.points);

    this.coins = new CoinBurst();
    scene.add(this.coins.mesh);

    this.rings = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1.0, 72),
        new THREE.MeshBasicMaterial({
          color: 0xffd75e, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.set(0, 0.3, 1.05);
      ring.visible = false;
      scene.add(ring);
      this.rings.push({ mesh: ring, t: 0, active: false, dur: 1 });
    }

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    this.flash.position.set(0, 0, 4.5);
    scene.add(this.flash);
    this.flashLevel = 0;

    this.lingering = 0;
  }

  screenPoint(x, y, z = 1.2) {
    return new THREE.Vector3(x, y, z);
  }

  ring({ color = 0xffd75e, dur = 0.9, scale = 4.5 } = {}) {
    const r = this.rings.find((x) => !x.active) ?? this.rings[0];
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.scale = scale;
    r.mesh.visible = true;
    r.mesh.material.color.set(color);
    r.mesh.material.opacity = 0.85;
  }

  coinSpray(power = 1, count = 90) {
    this.coins.burst({
      count: Math.round(count),
      power,
      origin: new THREE.Vector3(0, -1.5, 1.15),
      up: 7.2,
    });
  }

  sparkBurst({ count = 60, color = '#ffd75e', power = 1, at = null, size = 0.26, ttl = 1.1 } = {}) {
    const o = at ?? new THREE.Vector3(0, 0.28, 1.2);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.8 + Math.random() * 3.4) * power;
      this.sparks.spawn({
        x: o.x + (Math.random() - 0.5) * 1.6,
        y: o.y + (Math.random() - 0.5) * 0.8,
        z: o.z + Math.random() * 0.5,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.8 + 1.2 * power,
        vz: 0.6 + Math.random() * 1.4,
        color,
        size: size * (0.55 + Math.random() * 0.9),
        ttl: ttl * (0.65 + Math.random() * 0.7),
        gravity: -2.2,
        drag: 1.6,
      });
    }
  }

  /** Reel landing puff. */
  landPuff(i) {
    const x = -1.12 + i * 1.12;
    for (let n = 0; n < 16; n++) {
      this.dust.spawn({
        x: x + (Math.random() - 0.5) * 0.7,
        y: 0.28 + (Math.random() - 0.5) * 1.0,
        z: 1.0,
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 0.7,
        vz: 0.4 + Math.random() * 0.5,
        color: '#c9a6ff',
        size: 0.16 + Math.random() * 0.3,
        ttl: 0.6 + Math.random() * 0.5,
        drag: 3.2,
      });
    }
  }

  screenFlash(color = '#ffffff', amount = 0.35, dur = 0.45) {
    this.flash.material.color.set(color);
    this.flashLevel = amount;
    this.flashDur = dur;
    this.flashT = 0;
    this.flash.material.opacity = amount;
  }

  smallWin() {
    this.sparkBurst({ count: 40, color: '#ffd75e', power: 0.8, ttl: 0.9 });
    this.screenFlash('#ffcf6a', 0.10, 0.3);
  }

  mediumWin() {
    this.sparkBurst({ count: 90, color: '#ffd75e', power: 1.3 });
    this.sparkBurst({ count: 40, color: '#ff5fd0', power: 1.1, at: new THREE.Vector3(0, 1.2, 1.0) });
    this.coinSpray(1.0, 55);
    this.ring({ color: 0xffd75e, dur: 0.85, scale: 5.0 });
    this.screenFlash('#ffdf8a', 0.20, 0.4);
  }

  bigWin() {
    this.sparkBurst({ count: 180, color: '#ffe27a', power: 2.1, ttl: 1.5 });
    this.sparkBurst({ count: 90, color: '#7ce8ff', power: 1.8, at: new THREE.Vector3(-1.4, 0.6, 1.1) });
    this.sparkBurst({ count: 90, color: '#ff5fd0', power: 1.8, at: new THREE.Vector3(1.4, 0.6, 1.1) });
    this.coinSpray(1.75, 150);
    this.ring({ color: 0xffe27a, dur: 1.0, scale: 7.5 });
    this.ring({ color: 0x7ce8ff, dur: 1.35, scale: 9.5 });
    this.screenFlash('#fff3c4', 0.42, 0.6);
  }

  jackpot() {
    this.sparkBurst({ count: 260, color: '#fff1a8', power: 2.8, ttl: 1.9, size: 0.32 });
    for (let i = 0; i < 6; i++) {
      setTimeout(() => this.coinSpray(2.0, 90), i * 170);
    }
    this.ring({ color: 0xffe27a, dur: 1.5, scale: 11 });
    this.ring({ color: 0xff5fd0, dur: 1.9, scale: 14 });
    this.ring({ color: 0x7ce8ff, dur: 2.3, scale: 17 });
    this.screenFlash('#ffffff', 0.62, 0.9);
    this.lingering = 1.6;
  }

  update(dt) {
    this.sparks.update(dt);
    this.dust.update(dt);
    this.coins.update(dt);

    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = clamp(r.t / r.dur);
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const s = 0.4 + k * r.scale;
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = 0.8 * (1 - k) ** 1.6;
    }

    if (this.flashLevel > 0) {
      this.flashT += dt;
      const k = clamp(this.flashT / this.flashDur);
      this.flash.material.opacity = this.flashLevel * (1 - k) ** 2;
      if (k >= 1) this.flashLevel = 0;
    }

    if (this.lingering > 0) {
      this.lingering -= dt;
      if (Math.random() < 0.5) {
        this.sparks.spawn({
          x: (Math.random() - 0.5) * 5,
          y: 2.4 + Math.random() * 1.4,
          z: 0.8 + Math.random(),
          vx: (Math.random() - 0.5) * 0.8,
          vy: -0.6 - Math.random() * 0.9,
          vz: 0,
          color: Math.random() < 0.5 ? '#ffe27a' : '#7ce8ff',
          size: 0.12 + Math.random() * 0.2,
          ttl: 1.4,
          gravity: -0.6,
          drag: 0.3,
        });
      }
    }
  }
}
