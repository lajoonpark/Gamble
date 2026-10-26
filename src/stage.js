import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { moteTexture, glowTexture } from './textures.js';
import { clamp, damp } from './util.js';

// Everything the camera has to keep on screen, in world units.
const CONTENT = { halfW: 2.75, halfH: 3.6, centerY: 0.34 };
const FRAME_MARGIN = 1.2;

// How far behind the machine the black hole sits. Kept well back so it reads as
// a halo around the silhouette rather than a rival subject.
const HOLE_Z = -34;

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
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 220);
    this.camera.position.set(0, CONTENT.centerY, 13);

    this.scene.environment = this.buildEnv();
    this.scene.environmentIntensity = 0.75;

    this.buildStars();
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

    window.addEventListener('resize', () => this.resize());
    this.watchPixelRatio();
    this.resize();
  }

  /**
   * Two star layers at different depths. The near layer drifts further with the
   * cursor, which is what makes the machine feel like it is *in* the scene
   * rather than pasted on top of it.
   */
  buildStars() {
    const make = (count, spread, size, opacity) => {
      const pos = new Float32Array(count * 3);
      const ph = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * spread;
        pos[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.7;
        pos[i * 3 + 2] = -18 - Math.random() * 60;
        ph[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: moteTexture() },
          uTime: { value: 0 },
          uOpacity: { value: opacity },
          uSize: { value: size },
        },
        vertexShader: /* glsl */ `
          attribute float aPhase;
          uniform float uTime;
          uniform float uSize;
          varying float vTwinkle;
          void main() {
            vTwinkle = 0.55 + 0.45 * sin(uTime * (0.6 + aPhase * 1.6) + aPhase * 6.283);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uSize * (0.6 + aPhase * 1.1);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform float uOpacity;
          varying float vTwinkle;
          void main() {
            vec4 t = texture2D(uMap, gl_PointCoord);
            if (t.a < 0.02) discard;
            gl_FragColor = vec4(vec3(0.86, 0.92, 1.0) * t.rgb, t.a * uOpacity * vTwinkle);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });

      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.scene.add(pts);
      return pts;
    };

    this.starsFar = make(1500, 170, 2.4, 0.85);
    this.starsNear = make(360, 110, 3.4, 0.6);
  }

  /**
   * The black hole as a single coherent image rather than a stack of meshes.
   * What makes a black hole legible is the *lensed* silhouette: a shadow with a
   * bright rim that is thick and hot on one flank, plus the accretion disc
   * sweeping across the front of it. RingGeometry outlines read as stickers, so
   * all of it is painted into one canvas and faded at the edges.
   */
  buildBlackHole() {
    const group = new THREE.Group();
    group.position.set(-10.5, 4.6, HOLE_Z);
    this.scene.add(group);
    this.hole = group;

    const SIZE = 30;

    const body = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshBasicMaterial({
        map: this.blackHoleTexture(),
        transparent: true, depthWrite: false,
        blending: THREE.NormalBlending, toneMapped: false, opacity: 0.95,
      }),
    );
    group.add(body);
    this.photon = body;

    // Wide, very faint spill: this is what lights the scene around the hole.
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE * 2.1, SIZE * 2.1),
      new THREE.MeshBasicMaterial({
        map: glowTexture('rgba(96,132,196,0.30)', 'rgba(40,64,120,0)', 256),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        toneMapped: false, opacity: 0.5,
      }),
    );
    halo.position.z = -1.2;
    group.add(halo);
    this.halo = halo;

    this.disc = body;
    this.capBand = body;
  }

  /**
   * Paints the hole into one canvas: shadow, beamed rim, and the accretion
   * disc crossing in front.
   *
   * Two details make or break this. The shadow has to be genuinely opaque, so
   * the mesh uses normal blending (additive can only add light, so a "black"
   * shadow would just show the sky through it). And the rim has to be built
   * from concentric full circles rather than a comb of arc segments, which is
   * what produced visible ribbing.
   */
  blackHoleTexture() {
    const S = 1024;
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.185;

    const layer = () => {
      const c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      return [c, c.getContext('2d')];
    };

    // --- rim, in its own layer so it can be beamed left-to-right -------------
    const [rimC, rim] = layer();
    for (let i = 0; i < 150; i++) {
      const t = i / 150;
      // Radial profile: a bright thin edge just outside the shadow, falling off.
      const r = R * (0.985 + t * 0.30);
      const alpha = 0.55 * (1 - t) ** 2.2;
      rim.strokeStyle = `rgba(232,243,255,${alpha})`;
      rim.lineWidth = 1.6;
      rim.beginPath();
      rim.arc(cx, cy, r, 0, Math.PI * 2);
      rim.stroke();
    }
    // Doppler beaming: multiply the rim out toward the right.
    rim.globalCompositeOperation = 'destination-in';
    const beam = rim.createLinearGradient(cx - R * 1.35, 0, cx + R * 1.35, 0);
    beam.addColorStop(0, 'rgba(255,255,255,1)');
    beam.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    beam.addColorStop(1, 'rgba(255,255,255,0.05)');
    rim.fillStyle = beam;
    rim.fillRect(0, 0, S, S);

    // --- accretion disc, feathered so it dissolves into the sky -------------
    const [discC, disc] = layer();
    disc.translate(cx, cy);
    disc.rotate(-0.05);
    for (let k = 0; k < 520; k++) {
      const y = (Math.random() - 0.5) * R * 1.15;
      // Elliptical falloff: filaments die out toward the top and bottom.
      const span = Math.sqrt(Math.max(0, 1 - (y / (R * 0.62)) ** 2));
      const halfLen = R * (0.55 + Math.random() * 0.7) * span;
      if (halfLen < 2) continue;
      const x0 = -halfLen * (0.2 + Math.random() * 0.8);
      const len = halfLen * (0.25 + Math.random() * 0.75);
      const alpha = (0.05 + Math.random() * 0.22) * span;
      const warm = Math.random();
      disc.strokeStyle = warm > 0.84
        ? `rgba(255,236,212,${alpha})`
        : `rgba(${Math.round(180 + warm * 50)},${Math.round(208 + warm * 32)},255,${alpha})`;
      disc.lineWidth = 0.6 + Math.random() * 1.7;
      disc.beginPath();
      disc.moveTo(x0, y + (Math.random() - 0.5) * 1.5);
      disc.lineTo(x0 + len, y + (Math.random() - 0.5) * 1.5);
      disc.stroke();
    }
    // Fade the disc's outer reach without touching the shadow.
    disc.setTransform(1, 0, 0, 1, 0, 0);
    disc.globalCompositeOperation = 'destination-in';
    const dfade = disc.createRadialGradient(cx, cy, R * 1.05, cx, cy, R * 2.3);
    dfade.addColorStop(0, 'rgba(255,255,255,1)');
    dfade.addColorStop(1, 'rgba(255,255,255,0)');
    disc.fillStyle = dfade;
    disc.fillRect(0, 0, S, S);

    // --- assemble -----------------------------------------------------------
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d');

    // Outer glow first; the shadow will cover its middle.
    const glow = ctx.createRadialGradient(cx, cy, R * 1.0, cx, cy, R * 3.4);
    glow.addColorStop(0, 'rgba(150,190,250,0.20)');
    glow.addColorStop(0.45, 'rgba(110,150,215,0.07)');
    glow.addColorStop(1, 'rgba(70,110,180,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 3.4, 0, Math.PI * 2);
    ctx.fill();

    // The silhouette. Opaque black is the whole point.
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // The lensed far side of the disc, which appears as a thin arc above the
    // shadow and a brighter one below it.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.05);
    for (const [ry, alpha, w] of [[1.02, 0.5, 2.6], [1.16, 0.28, 1.8]]) {
      ctx.strokeStyle = `rgba(226,240,255,${alpha})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 1.42, R * ry * 0.30, 0, Math.PI * 0.06, Math.PI * 0.94);
      ctx.stroke();
    }
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(rimC, 0, 0);
    ctx.drawImage(discC, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    // Without this the glow still has alpha at the canvas border, which shows up
    // as a rectangular seam the size of the plane. Fade out well inside the
    // edge; the shadow (radius R) is far inside the fade start.
    ctx.globalCompositeOperation = 'destination-in';
    const edge = ctx.createRadialGradient(cx, cy, R * 1.35, cx, cy, S * 0.46);
    edge.addColorStop(0, 'rgba(255,255,255,1)');
    edge.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    edge.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * The environment map chrome samples. Cool strips plus one white overhead
   * softbox: a plain room env makes metal read as flat grey, and warm strips
   * would fight the blue palette.
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

    // Overhead softbox: the main specular streak along every rounded edge.
    panel(7, 2.4, 0xf2f7ff, 3.6, 0, 8, 0.5);
    // Cold vertical strips left and right.
    panel(4.5, 8, 0x3d6ea8, 1.5, -6.5, 1.0, 1.5);
    panel(4.5, 8, 0x2a4f80, 1.2, 6.5, 1.0, 1.5);
    // Faint floor bounce so the underside of the plinth is not pure black.
    panel(9, 5, 0x2b3d55, 0.5, 0, -5.5, 2.0);
    // Small hot pings that give polished metal its sparkle.
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
    this.scene.add(new THREE.AmbientLight(0x9fb6d4, 0.30));

    // Key is a narrow spot so the cabinet reads as lit, not glowing.
    const key = new THREE.SpotLight(0xeaf2ff, 150, 40, 0.54, 0.7, 1.5);
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

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.42,  // strength
      0.72,  // radius
      0.80,  // threshold
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.bloomTarget = 0.42;
    this.bloomLevel = 0.42;
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

    // Stars drift at different rates: the near layer moves furthest.
    this.starsFar.material.uniforms.uTime.value = t;
    this.starsNear.material.uniforms.uTime.value = t;
    this.starsNear.position.x = px * 0.55;
    this.starsNear.position.y = -py * 0.35;
    this.starsFar.position.x = px * 0.22;
    this.starsFar.position.y = -py * 0.14;

    // The hole turns very slowly and breathes; on a win the ring flares.
    const flare = this.excite * 0.5;
    this.photon.material.opacity = 0.72 + Math.sin(t * 0.4) * 0.05 + flare * 0.5;
    this.halo.material.opacity = 0.4 + Math.sin(t * 0.3) * 0.04 + flare * 0.35;
    this.hole.position.x = -10.5 + px * -0.6;
    this.hole.position.y = 4.6 + py * 0.3 + Math.sin(t * 0.22) * 0.08;

    this.rimL.intensity = 34 + Math.sin(t * 1.5) * 5 + this.excite * 20;
    this.rimR.intensity = 22 + Math.cos(t * 1.35) * 4 + this.excite * 12;
    this.under.intensity = 8 + this.excite * 6;

    this.bloomLevel = damp(this.bloomLevel, this.bloomTarget + this.excite * 0.10, 4, dt);
    this.bloom.strength = this.bloomLevel;
  }

  render() {
    this.composer.render();
  }
}
