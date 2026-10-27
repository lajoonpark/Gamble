import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BlackHole } from './blackhole.js';
import { damp } from './util.js';

// Everything the camera has to keep on screen, in world units. The lever swings
// down past the cabinet now, so the box is a little wider than it was.
const CONTENT = { halfW: 3.45, halfH: 3.85, centerY: 0.26 };
const FRAME_MARGIN = 1.14;

// Where the shadow goes, in screen uv relative to centre, and how big it is as a
// fraction of the short side. The hole is the subject of this wallpaper; the
// machine stands in front of it rather than the other way round.
// `?hole=frac,panX,panY` overrides it, which is how the framing below was
// arrived at: the composition has to be judged by eye, not by arithmetic.
// The hole is framed in screen space, so these are fractions of the viewport
// rather than world units. `frac` is the shadow's radius as a fraction of the
//short  edge: it has to be large enough that the frame reads as a black hole first
// and a slot machine second, but the shadow must stay behind the machine.
const HOLE = { panX: -0.30, panY: 0.12, frac: 0.55 };
{
  const q = new URLSearchParams(location.search).get('hole');
  if (q) {
    const [frac, panX, panY] = q.split(',').map(Number);
    if (Number.isFinite(frac)) HOLE.frac = frac;
    if (Number.isFinite(panX)) HOLE.panX = panX;
    if (Number.isFinite(panY)) HOLE.panY = panY;
  }
}

// Exposed for tuning from the console and from tools/: framing is a visual
// judgement, so being able to sweep it without a rebuild matters.
if (typeof window !== 'undefined') window.__holeCfg = HOLE;

export class Stage {
  constructor(container, { tweens = null } = {}) {
    this.container = container;
    this.tweens = tweens;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,   // the composer's output pass handles AA
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 220);
    this.camera.position.set(0, CONTENT.centerY, 13);

    this.scene.environment = this.buildEnv();
    this.scene.environmentIntensity = 0.75;

    this.buildBlackHole();
    this.buildLights();
    this.buildPost();

    this.excite = 0;
    this.parallax = new THREE.Vector2();
    this.parallaxTarget = new THREE.Vector2();
    this.baseZ = 13;
    this.punch = 0;
    this.punchTarget = 0;
    this.shake = 0;
    this.shakeDecay = 0;

    this.viewW = 1;
    this.viewH = 1;
    this.skyPan = new THREE.Vector2(HOLE.panX, HOLE.panY);

    window.addEventListener('resize', () => this.resize());
    this.watchPixelRatio();
    this.resize();
  }

  /**
   * The black hole is a real one: an offscreen pass that integrates a null
   * geodesic per pixel (see blackhole.js) and returns a full-screen image of the
   * sky with the accretion disc lensed through it. The stage draws that image as
   * a backdrop quad and composites the machine over it, which is why the shadow
   * can sit behind the cabinet and still be genuinely black.
   */
  buildBlackHole() {
    this.hole = new BlackHole(this.renderer);
    this.scene.add(this.hole.quad);
  }

  /**
   * The environment map chrome samples. Cool strips plus one white overhead
   * softbox: a plain room env makes metal read as flat grey, and warm strips
   * would fight the blue palette. One amber panel stands in for the accretion
   * disc so the polished edges pick up a little of its heat.
   */
  buildEnv() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04060a);

    const panel = (w, h, color, intensity, x, y, z) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(intensity),
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      scene.add(m);
    };

    panel(7, 2.4, 0xf2f7ff, 3.6, 0, 8, 0.5);
    panel(4.5, 8, 0x3d6ea8, 1.5, -6.5, 1.0, 1.5);
    panel(4.5, 8, 0x2a4f80, 1.2, 6.5, 1.0, 1.5);
    panel(9, 5, 0x2b3d55, 0.5, 0, -5.5, 2.0);
    // The disc, off to one side: warm bounce on the metal, matched to the hole.
    panel(6, 3.2, 0xff9a54, 0.5, -3.0, 2.4, -4.5);
    panel(1.1, 1.1, 0xffffff, 6.0, -2.6, 5.2, 5.0);
    panel(1.1, 1.1, 0xffffff, 4.2, 3.1, 4.4, 5.0);
    panel(2.2, 0.5, 0xffffff, 5.0, 0.4, 2.2, 7.0);

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
    this.scene.add(new THREE.AmbientLight(0x9fb6d4, 0.26));

    // Key is a narrow spot so the cabinet reads as lit, not glowing.
    const key = new THREE.SpotLight(0xeaf2ff, 165, 40, 0.54, 0.7, 1.5);
    key.position.set(0, 10, 12);
    key.target.position.set(0, 0.2, 0);
    this.scene.add(key, key.target);
    this.key = key;

    // Cool rim strips: these are what make the lever look like metal.
    this.rimL = new THREE.PointLight(0x6f9cff, 34, 22, 2);
    this.rimL.position.set(-7.0, 2.4, 5.0);
    this.scene.add(this.rimL);

    this.rimR = new THREE.PointLight(0x8fb4e8, 22, 22, 2);
    this.rimR.position.set(7.0, 1.8, 4.6);
    this.scene.add(this.rimR);

    // Warm bounce from the accretion disc, up and to the left where it sits.
    this.discLight = new THREE.PointLight(0xffa869, 30, 30, 2);
    this.discLight.position.set(-9.5, 5.0, -2.0);
    this.scene.add(this.discLight);

    // Tight highlight that travels down the lever rod.
    this.leverKick = new THREE.PointLight(0xffffff, 20, 12, 2);
    this.leverKick.position.set(3.2, 3.0, 3.6);
    this.scene.add(this.leverKick);

    // Very low fill from below so the underside is not a silhouette.
    this.under = new THREE.PointLight(0x4a6b96, 8, 14, 2);
    this.under.position.set(0, -3.4, 3.2);
    this.scene.add(this.under);
  }

  buildPost() {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // A tight, high-threshold bloom. A wide one bleeds the disc's glow into the
    // shadow and the whole thing turns into a grey blob, which is exactly the
    // failure this wallpaper is trying to avoid.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.62,  // strength
      0.22,  // radius
      1.05,  // threshold
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.bloomTarget = 0.62;
    this.bloomLevel = 0.62;
  }

  /**
   * Moving the window between a Retina and a non-Retina display changes
   * devicePixelRatio without firing `resize`, so listen for it directly. The
   * query embeds the current ratio, so it has to be rebuilt after each change.
   */
  watchPixelRatio() {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => { this.resize(); this.watchPixelRatio(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange, { once: true });
    else if (mq.addListener) mq.addListener(onChange);
    this._ratioMq = mq;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 2) || 1;
    this.viewW = w;
    this.viewH = h;

    this.renderer.setPixelRatio(dpr);
    // `false` keeps three.js from writing inline styles, so the CSS size has to
    // be set here. Without this the canvas lays out at its backing-store size
    // (w*dpr by h*dpr) and a HiDPI display shows only the top-left quadrant,
    // which reads as a huge unexplained zoom.
    this.renderer.setSize(w, h, false);
    const canvas = this.renderer.domElement;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // Fit the whole presentation (cabinet, lever, floating readout) rather than
    // guessing a distance: a fixed number clipped the readout on short windows.
    const halfW = CONTENT.halfW * FRAME_MARGIN;
    const halfH = CONTENT.halfH * FRAME_MARGIN;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const tanV = Math.tan(vFov / 2);
    const distH = halfH / tanV;
    const distW = halfW / (tanV * this.camera.aspect);
    this.baseZ = Math.max(distH, distW);
    // Snap rather than ease: on load and on any resize the frame should already
    // be correct, not slide into place over half a second.
    this.camera.position.y = CONTENT.centerY;
    this.camera.position.z = this.baseZ;
    this.camera.updateProjectionMatrix();

    // The hole is framed in screen space so the composition survives any aspect
    // ratio: same relative size, same place relative to the machine.
    this.hole.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.hole.setFraming(w, h, HOLE.frac, HOLE.panX, HOLE.panY);
    // Accumulated frames from before the resize describe a different image.
    this.hole.resetAccumulation();
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

  /** Mechanical impact: a quick positional kick that rings down. */
  impact(strength = 1) {
    this.shake = Math.max(this.shake, strength * 0.1);
    this.shakeDecay = 9;
  }

  update(dt, t) {
    this.parallax.x = damp(this.parallax.x, this.parallaxTarget.x, 2.6, dt);
    this.parallax.y = damp(this.parallax.y, this.parallaxTarget.y, 2.6, dt);

    const px = this.parallax.x;
    const py = this.parallax.y;

    this.punch = damp(this.punch, this.punchTarget, 7, dt);
    this.shake = damp(this.shake, 0, this.shakeDecay, dt);

    this.camera.position.x = damp(this.camera.position.x, px * 0.9, 6, dt)
      + Math.sin(t * 61) * this.shake;
    this.camera.position.y = damp(this.camera.position.y, CONTENT.centerY - py * 0.4, 6, dt)
      + Math.cos(t * 83) * this.shake * 0.7;
    this.camera.position.z = damp(
      this.camera.position.z,
      this.baseZ * (1 - this.punch * 0.05),
      6,
      dt,
    );
    this.camera.lookAt(px * 0.25, CONTENT.centerY - py * 0.18, 0);

    // The hole drifts a fraction of the machine's parallax: enough to feel far
    // away, not enough to slide the shadow off its mark. A slow sine keeps the
    // wallpaper alive when the cursor never moves.
    this.skyPan.set(
      HOLE.panX - px * 0.022 + Math.sin(t * 0.061) * 0.007,
      HOLE.panY - py * 0.015 + Math.cos(t * 0.047) * 0.005,
    );
    this.hole.setFraming(this.viewW, this.viewH, HOLE.frac, this.skyPan.x, this.skyPan.y);
    this.hole.update(t, this.excite);

    this.rimL.intensity = 34 + Math.sin(t * 1.5) * 5 + this.excite * 20;
    this.rimR.intensity = 22 + Math.cos(t * 1.35) * 4 + this.excite * 12;
    this.discLight.intensity = 30 + Math.sin(t * 0.43) * 4 + this.excite * 22;
    this.under.intensity = 8 + this.excite * 6;

    this.bloomLevel = damp(this.bloomLevel, this.bloomTarget + this.excite * 0.10, 4, dt);
    this.bloom.strength = this.bloomLevel;
  }

  render() {
    // Offscreen first: the sky has to exist before the scene composites onto it.
    this.hole.render();
    this.composer.render();
  }
}
