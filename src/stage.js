import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { backdropTexture, rayTexture, glowTexture } from './textures.js';
import { clamp, damp } from './util.js';

// Everything the camera has to keep on screen, in world units.
const CONTENT = { halfW: 2.75, halfH: 3.45, centerY: 0.55 };
const FRAME_MARGIN = 1.12;

export class Stage {
  constructor(container, { tweens = null } = {}) {
    this.container = container;
    this.tweens = tweens;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x2a0430, 0.028);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    this.camera.position.set(0, CONTENT.centerY, 12);
    this.camera.lookAt(0, CONTENT.centerY, 0);

    this.scene.environment = this.buildEnv();
    this.scene.environmentIntensity = 0.85;

    this.buildBackdrop();
    this.buildLights();
    this.buildPost();

    this.raySpin = 0;
    this.excite = 0;
    this.parallax = new THREE.Vector2();
    this.parallaxTarget = new THREE.Vector2();
    this.baseZ = 12;
    this.punch = 0;        // 0..1, drives the win push-in
    this.punchTarget = 0;
    this.shake = 0;        // decaying impact shake
    this.shakeDecay = 0;

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  buildBackdrop() {
    const tex = backdropTexture();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 40),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: true, depthWrite: false }),
    );
    bg.position.set(0, 0, -14);
    this.scene.add(bg);
    this.backdrop = bg;

    const rays = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 46),
      new THREE.MeshBasicMaterial({
        map: rayTexture(), transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    rays.position.set(0, 0.4, -10.5);
    this.scene.add(rays);
    this.rays = rays;

    const core = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 22),
      new THREE.MeshBasicMaterial({
        map: glowTexture('rgba(255,190,240,0.5)', 'rgba(255,60,180,0)', 256),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    core.position.set(0, 0.2, -8.5);
    this.scene.add(core);
    this.core = core;

    // A "stage floor" of horizontal light bands for depth under the machine.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 26),
      new THREE.MeshBasicMaterial({
        map: glowTexture('rgba(255,120,220,0.30)', 'rgba(120,20,90,0)', 256),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -6.2, 1.5);
    this.scene.add(floor);
    this.floor = floor;
  }

  buildLights() {
    this.scene.add(new THREE.AmbientLight(0xffd9f2, 0.22));

    // Yaw around the cabinet so chrome picks up bright and dark bands instead
    // of reading as a uniform white tube.
    const key = new THREE.SpotLight(0xfff4e6, 120, 34, 0.5, 0.66, 1.4);
    key.position.set(0.8, 10, 11);
    key.target.position.set(0, 0.2, 0);
    this.scene.add(key, key.target);
    this.key = key;

    // Hard rim strips: these are what make the lever look like metal.
    const strip = (color, intensity, x, y, z) => {
      const l = new THREE.PointLight(color, intensity, 16, 2);
      l.position.set(x, y, z);
      this.scene.add(l);
      return l;
    };
    this.rimL = strip(0xff3fb0, 30, -6.0, 1.4, 5.2);
    this.rimR = strip(0x38e8ff, 30, 6.0, 1.4, 5.2);

    // Tight highlight that travels down the lever rod.
    this.leverKick = strip(0xffffff, 26, 3.4, 3.2, 3.6);

    this.under = new THREE.PointLight(0xffc453, 16, 12, 2);
    this.under.position.set(0, -3.2, 3.4);
    this.scene.add(this.under);

    this.top = new THREE.PointLight(0xff77dd, 20, 16, 2);
    this.top.position.set(0, 5.0, 3.0);
    this.scene.add(this.top);
  }

  /**
   * Builds the environment map the chrome and gold sample. A plain room env
   * gives flat grey metal; the cabinet needs hot magenta/cyan strips and a
   * bright overhead bar to read as polished chrome.
   */
  buildEnv() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0312);

    const panel = (w, h, color, intensity, x, y, z, lookAt = true) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(intensity),
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      m.position.set(x, y, z);
      if (lookAt) m.lookAt(0, 0, 0);
      scene.add(m);
      return m;
    };

    // Overhead softbox, the main specular streak on every rounded edge.
    panel(7, 2.2, 0xfff3e2, 4.2, 0, 8, 0.5);
    // Big coloured strips left and right.
    panel(4, 8, 0xff3fb0, 2.1, -6.5, 1.0, 1.5);
    panel(4, 8, 0x2ad8ff, 1.7, 6.5, 1.0, 1.5);
    // Warm floor bounce.
    panel(9, 5, 0xffb257, 0.7, 0, -5.5, 2.0);
    // Small hot pings that give metal its sparkle.
    panel(1.1, 1.1, 0xffffff, 7.0, -2.6, 5.2, 5.0);
    panel(1.1, 1.1, 0xffffff, 5.0, 3.1, 4.4, 5.0);
    panel(2.2, 0.5, 0xffffff, 6.0, 0.4, 2.2, 7.0);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromScene(scene, 0.02).texture;
    pmrem.dispose();
    scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    return tex;
  }

  buildLights() {
    this.scene.add(new THREE.AmbientLight(0xffd9f2, 0.22));

    // Key light is a narrow spot so the cabinet reads as lit, not glowing.
    const key = new THREE.SpotLight(0xfff4e6, 130, 34, 0.52, 0.62, 1.4);
    key.position.set(0, 10, 11);
    key.target.position.set(0, 0.2, 0);
    this.scene.add(key, key.target);
    this.key = key;

    const rimL = new THREE.PointLight(0xff38b4, 26, 20, 2);
    rimL.position.set(-7.5, 2.2, 4.4);
    this.scene.add(rimL);
    this.rimL = rimL;

    const rimR = new THREE.PointLight(0x33e6ff, 26, 20, 2);
    rimR.position.set(7.5, 2.2, 4.4);
    this.scene.add(rimR);
    this.rimR = rimR;

    const under = new THREE.PointLight(0xffc453, 14, 14, 2);
    under.position.set(0, -3.6, 3.2);
    this.scene.add(under);
    this.under = under;

    const top = new THREE.PointLight(0xff77dd, 18, 16, 2);
    top.position.set(0, 5.4, 2.8);
    this.scene.add(top);
    this.top = top;
  }

  buildPost() {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.58,  // strength
      0.62,  // radius
      0.86,  // threshold
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.bloomTarget = 0.58;
    this.bloomLevel = 0.58;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // Fit the whole presentation (cabinet + lever + floating readout) instead
    // of guessing a distance: a fixed number clipped the balance panel on short
    // or narrow windows.
    const halfW = CONTENT.halfW * FRAME_MARGIN;
    const halfH = CONTENT.halfH * FRAME_MARGIN;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const tanV = Math.tan(vFov / 2);
    const distH = halfH / tanV;
    const distW = halfW / (tanV * this.camera.aspect);
    this.baseZ = Math.max(distH, distW);
    this.camera.position.y = CONTENT.centerY;
    this.camera.updateProjectionMatrix();
  }

  setPointer(nx, ny) {
    this.parallaxTarget.set(nx, ny);
  }

  setExcite(v) {
    this.excite = v;
  }

  /** Push in toward the payline; `amount` 0..1, held for `dur` seconds. */
  punchIn(amount = 1, dur = 1.2) {
    this.tweens?.add?.({
      dur,
      from: amount,
      to: 0,
      ease: (t) => t,
      onUpdate: (v) => { this.punchTarget = v; },
    });
    this.punchTarget = amount;
  }

  /** Mechanical impact: quick positional kick that rings down. */
  impact(strength = 1) {
    this.shake = Math.max(this.shake, strength * 0.12);
    this.shakeDecay = 9;
  }

  update(dt, t) {
    this.parallax.x = damp(this.parallax.x, this.parallaxTarget.x, 3.2, dt);
    this.parallax.y = damp(this.parallax.y, this.parallaxTarget.y, 3.2, dt);

    const px = this.parallax.x;
    const py = this.parallax.y;

    this.punch = damp(this.punch, this.punchTarget, 7, dt);
    this.shake = damp(this.shake, 0, this.shakeDecay, dt);

    const shakeX = Math.sin(t * 61) * this.shake;
    const shakeY = Math.cos(t * 83) * this.shake * 0.7;

    this.camera.position.x = damp(this.camera.position.x, px * 1.15, 6, dt) + shakeX;
    this.camera.position.y =
      damp(this.camera.position.y, CONTENT.centerY - py * 0.55, 6, dt) + shakeY;
    this.camera.position.z = damp(
      this.camera.position.z,
      this.baseZ * (1 - this.punch * 0.055),
      6,
      dt,
    );
    this.camera.lookAt(px * 0.35, CONTENT.centerY - py * 0.25, 0);

    this.raySpin += dt * (0.045 + this.excite * 0.14);
    this.rays.rotation.z = this.raySpin;
    this.rays.material.opacity = 0.30 + Math.sin(t * 0.8) * 0.05 + this.excite * 0.2;

    this.core.scale.setScalar(1 + Math.sin(t * 0.65) * 0.03 + this.excite * 0.05);

    this.rimL.intensity = 26 + Math.sin(t * 1.5) * 5 + this.excite * 22;
    this.rimR.intensity = 26 + Math.cos(t * 1.35) * 5 + this.excite * 22;
    this.top.intensity = 18 + Math.sin(t * 0.9 + 1) * 4 + this.excite * 14;

    this.bloomLevel = damp(this.bloomLevel, this.bloomTarget + this.excite * 0.34, 4, dt);
    this.bloom.strength = this.bloomLevel;
  }

  render() {
    this.composer.render();
  }
}
