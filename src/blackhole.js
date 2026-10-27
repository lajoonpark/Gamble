import * as THREE from 'three';

// A Schwarzschild black hole, rendered by actually integrating light rays.
//
// The old version painted a shadow-and-ring into a canvas, which is exactly why
// it read as a black circle: nothing about it bent. Here every pixel launches a
// null geodesic from the camera and follows it with RK4 until it falls through
// the horizon or escapes. The accretion disc is sampled wherever the path
// crosses the disc plane, so the ring of light, the lensed far side arcing over
// the shadow and the thin secondary image underneath all fall out of the
// geometry instead of being drawn.
//
// Units: the Schwarzschild radius is 1, so the shadow always lands at an impact
// parameter of 3*sqrt(3)/2 ~= 2.598 whatever else the scene does.

const VERT = /* glsl */ `
  void main() {
    // Fullscreen triangle. z = w puts it on the far plane; depth test is off.
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec3  uCam;        // camera position in hole space (Rs = 1)
uniform vec2  uPan;        // screen uv (-1..1) the hole is centred on
uniform float uTanHalf;    // tan of half the vertical field of view
uniform float uAspect;
uniform float uTime;
uniform float uExcite;     // 0..1, win flare
uniform float uInner;      // disc inner radius (Rs)
uniform float uOuter;      // disc outer radius (Rs)
uniform float uEscape;     // stop integrating once this far out and leaving
uniform vec2  uResolution;
uniform int   uSteps;
uniform vec2  uJitter;     // sub-pixel offset, rotates over frames
uniform float uSkyGain;
uniform float uDiscGain;
uniform float uRimW;       // rim half-width, as a fraction of the disc span
uniform float uRimGain;
uniform float uFil;        // strength of the azimuthal filament lanes

const float RS      = 1.0;             // Schwarzschild radius
const float BCRIT   = 2.59807621135;   // 3*sqrt(3)/2, shadow edge
// GLSL ES 1.00 has no PI, and an undeclared identifier here fails the whole
// shader: the page then renders a black canvas with only a console error.
const float PI      = 3.14159265359;
const float TAU     = 6.28318530718;
const int   MAX_STEPS = 192;

// ------------------------------------------------------------------ noise
float hash12(vec2 p) {
  vec3 p3 = fract(p.xyx * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.07 + 11.7;
    a *= 0.5;
  }
  return s;
}

// --------------------------------------------------------------------- sky
// One candidate star per cell of a direction lattice.
//
// The distance has to be *angular*. Measuring it as a plain 3D length from a
// point inside the cell places the star off the unit sphere, and the
// intersection of two nearly tangent spheres is an elongated lens — which is
// why the field rendered as diagonal dashes instead of dots. Taking the chord
// between unit vectors gives a round star, stable under camera drift.
vec3 starLayer(vec3 d, float scale, float sizePx, float gain, float seed, float pxAngle) {
  vec3 p = d * scale + seed;
  vec3 id = floor(p);
  vec3 r = hash33(id);

  // The star sits at the direction of a point in its lattice cell, and the
  // distance to it is a chord on the unit sphere — the angle, for small values.
  // Measuring the offset inside the cell instead smears each star into a lens
  // wherever the sphere grazes the cell's radial axis.
  vec3 starDir = normalize(id + (0.18 + 0.64 * r));
  float dist = length(d - starDir);

  // Sizes are in pixels, converted through the pixel's angular width, so the
  // field looks the same at any render resolution.
  float core = pxAngle * sizePx;
  float m = smoothstep(core, 0.0, dist);
  if (m <= 0.001) return vec3(0.0);

  vec3 t = hash33(id + 19.3);
  float b = 0.06 + 0.94 * pow(t.x, 5.0);
  vec3 tint = mix(vec3(0.72, 0.83, 1.0), vec3(1.0, 0.87, 0.70), t.y * t.y);

  // Tight core inside a soft halo: the halo keeps a sub-pixel star from
  // flickering as it crosses sample boundaries.
  float halo = smoothstep(core * 3.4, 0.0, dist) * 0.14;
  return tint * (m * m * 1.5 + halo) * b * gain;
}


// A meteor is an arc of a great circle with its head at angle "head" and its
// tail "len" radians behind. Angles are measured in the A/B plane, where atan()
// folds into -PI..PI: the head has to be folded the same way and the distance
// behind it wrapped, or a meteor crossing that seam disappears and one whose
// head sits outside the range renders as a stationary dot.
vec3 meteor(vec3 d, vec3 A, vec3 B, float head, float len, float w, float bright) {
  float along = atan(dot(d, B), dot(d, A));
  float delta = mod(along - head + PI, TAU) - PI;
  if (delta > 0.02 || delta < -len) return vec3(0.0);

  // Angular distance from the great circle itself.
  float dist = length(d - (cos(along) * A + sin(along) * B));
  float taper = 1.0 + delta / len;
  taper *= taper;
  // A tight core inside a soft body: that is what reads as a streak rather
  // than a smear.
  float body = exp(-(dist * dist) / (w * w)) * taper;
  float core = exp(-(dist * dist) / (w * w * 0.10)) * taper * 1.6;
  return vec3(1.0, 0.96, 0.90) * (body + core) * bright;
}

vec3 sky(vec3 d) {
  float pxAngle = 2.0 * uTanHalf / max(uResolution.y, 1.0);

  // Deep, cold, and darkest overhead: the black has to stay black.
  vec3 col = mix(vec3(0.0130, 0.0168, 0.0295), vec3(0.0026, 0.0038, 0.0088),
                 smoothstep(-0.30, 0.90, abs(d.y)));

  // A faint galaxy band placed off-axis so the frame has a diagonal.
  vec3 bandN = normalize(vec3(0.46, 0.34, 0.82));
  float band = exp(-pow(dot(d, bandN) * 2.4, 2.0));
  vec2 bp = vec2(atan(d.z, d.x) * 1.7, d.y * 5.2);
  float bf = fbm(bp * vec2(2.2, 3.0)) * 0.62 + fbm(bp * 5.7) * 0.38;
  col += vec3(0.050, 0.058, 0.090) * band * (0.30 + 1.20 * bf);

  // (scale, angular radius, gain, seed, pixel angle)
  col += starLayer(d,  26.0, 1.05, 1.00,  0.0, pxAngle);
  col += starLayer(d,  41.0, 0.85, 0.55,  5.1, pxAngle);
  col += starLayer(d,  15.0, 1.55, 1.55, 11.7, pxAngle);

  // Meteors. Different periods and offsets so they never fire in a rhythm.
  //
  // The arc is anchored *in the visible sky*. Picking a random great circle and
  // sliding a head along it put most meteors behind the camera or at the frame
  // edge, where only a stub of the streak could ever show — rare events are
  // wasted unless they are guaranteed to cross open sky. So: pick a random
  // point in the upper part of the frame, then a random tangent there, and
  // sweep along that great circle.
  float t = uTime;
  vec3 fwd = normalize(-uCam);
  vec3 wrt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 wup = cross(wrt, fwd);

  // Six, not three. A wallpaper is ambient: someone watching for twenty seconds
  // should catch at least one streak, and with three at 13s+ periods most
  // glances landed between events. Staggered periods keep them from reading as
  // a loop.
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float period = 8.0 + fi * 3.4 + fi * fi * 0.6;
    float cyc = floor((t + fi * 5.71) / period);
    float age = (t + fi * 5.71) - cyc * period;
    float life = 0.85 + fi * 0.16;
    if (age < life) {
      vec3 h1 = hash33(vec3(cyc + fi * 17.0, fi * 3.1, 5.0));
      vec3 h2 = hash33(vec3(cyc * 1.7 + fi, 9.0, 2.0));

      // A point in the sky, biased high and clear of the disc's plane: a meteor
      // in front of the machine is invisible, and one at the very bottom reads
      // as scenery rather than as sky.
      // Anchored inside the frame, in units of the half-view. Offsetting by
      // more than one half-view puts the anchor outside the frustum, and the
      // streak then only ever appears as a stub at the very edge — which is
      // what made them look like stray orbital arcs. Biased up and to the
      // right, because the disc is framed low-left and that is where open sky
      // actually is.
      float su = 0.02 + h1.x * 0.78;
      float sv = 0.06 + h1.y * 0.70;
      vec3 anchor = normalize(fwd + wrt * (su * uAspect * uTanHalf)
        + wup * (sv * uTanHalf));

      // A random tangent direction at the anchor becomes the arc's second axis.
      float spin = h1.z * TAU;
      vec3 t1 = normalize(cross(anchor, abs(anchor.y) > 0.9
        ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
      vec3 t2 = cross(anchor, t1);
      vec3 axisB = normalize(t1 * cos(spin) + t2 * sin(spin));

      float k = age / life;
      float fade = smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.72, 1.0, k));
      // Kept short on purpose. A streak spanning a third of the frame stops
      // reading as a meteor and starts reading as an orbital arc, which is the
      // one thing in the sky that must not look like the disc.
      float travel = 0.20 + h2.y * 0.15;
      float len = 0.11 + h2.z * 0.10;
      // Head starts at the anchor and runs past the tail's own length, so the
      // whole streak crosses the screen instead of growing out of one spot.
      float head = smoothstep(0.0, 1.0, k) * (travel + len);
      // Brightness varies a lot; a sky where every streak is the same weight
      // reads as a screensaver. Occasionally one gets a head flare.
      float flare = 1.0 + 1.8 * smoothstep(0.86, 1.0, h2.x);
      col += meteor(d, anchor, axisB, head, len,
                    0.0021 + h2.x * 0.0019, (2.4 + 3.4 * h2.z) * fade * flare);
    }
  }

  return col * uSkyGain;
}

// -------------------------------------------------------------------- disc
// Emission where a photon path meets the disc plane. toCam is the photon's
// direction of travel toward the observer: that is what the Doppler term needs.
vec3 discColor(vec3 hit, vec3 toCam) {
  float r = length(hit.xz);
  float ang = atan(hit.z, hit.x);

  // Keplerian shear. Sampling turbulence in a co-rotating polar frame is what
  // turns it into spiral lanes; cartesian noise just boils in place. The inner
  // gas laps the outer by a factor of several, which is what draws the long
  // sweeping filaments instead of a static mottle.
  float omega = 1.0 / max(pow(r, 1.5), 0.001);
  float sw = ang - omega * uTime * 2.6;
  vec2 np = vec2(cos(sw), sin(sw)) * pow(r, 0.55) * 2.2;

  // Domain warp: warp the lookup of the second octave by the first. Straight
  // fbm reads as cotton wool; warped fbm reads as streaked gas.
  vec2 warp = vec2(fbm(np * 0.9 + 3.1), fbm(np * 0.9 + 17.7)) - 0.5;
  float n = fbm(np * 1.4 + warp * 1.9 + vec2(0.0, r * 0.26));
  float lanes = fbm(np * 5.1 + warp * 2.6 + 21.7);

  // Filaments. The np coordinate is isotropic, so the turbulence is roughly
  // every direction and the disc reads as even cotton wool. Real disc images
  // are dominated by long azimuthal streaks with dark gaps between them: the
  // gas is sheared along the orbit, so structure is fine across the disc and
  // coarse around it. Sampling on a circle whose radius carries the radial
  // coordinate gives exactly that anisotropy, with no seam at the wrap because
  // the circle is closed by construction.
  float fil = fbm(vec2(cos(sw), sin(sw)) * (1.6 + r * 1.15) + warp * 1.1);
  fil = smoothstep(0.32, 0.78, fil);

  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  // Inner lip a little wider than a pixel: the geometric rim of the disc is a
  // step in impact parameter, and a step is what aliases into a ring of dots.
  // It has to stay narrow, because this is also where the gas is hottest —
  // widening it to a visible fraction of the disc dims the whole core.
  float lip = clamp((r - uInner) / (0.085 * (uOuter - uInner)), 0.0, 1.0);
  // Outer falloff has to reach zero *tangentially*. A steep power law still
  // leaves a visible step where it hits the cut-off, which reads as the disc
  // ending in mid-air; this curve flattens into the sky.
  float dens = lip * pow(1.0 - t, 2.1) * smoothstep(1.0, 0.55, t);
  dens *= 0.16 + 1.85 * n * n;
  dens *= 0.34 + 1.25 * lanes * lanes;
  dens *= mix(1.0, fil * 1.65, uFil);

  // The inner rim is a separate, additive term rather than a brighter version
  // of the body. Gas at the ISCO is at its hottest and its fastest, and in a
  // real image it resolves to a razor line against the shadow; folding it into
  // the turbulence instead let the noise break it up, which is exactly what
  // makes a painted hole read as a soft circle.
  float rimW = uRimW * (uOuter - uInner);
  float rim = exp(-pow((r - uInner) / rimW, 2.0)) * step(uInner, r);

  // Temperature: white-hot at the inner edge, amber through the body, ember out.
  // The mid ramp is pushed toward saturation — a grey-brown disc is the single
  // most "painted" looking failure here, because real thin-disc emission is
  // broad and warm rather than neutral.
  float temp = pow(uInner / max(r, uInner), 0.72);
  vec3 c = mix(vec3(0.30, 0.075, 0.020), vec3(1.00, 0.44, 0.14), smoothstep(0.02, 0.34, temp));
  c = mix(c, vec3(1.00, 0.72, 0.44), smoothstep(0.34, 0.70, temp));
  c = mix(c, vec3(1.00, 0.94, 0.84), smoothstep(0.74, 1.0, temp));

  // Relativistic beaming: the limb sweeping toward us blazes, the receding limb
  // dims and reddens. Plus gravitational redshift as the gas nears the horizon.
  vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), hit));
  float beta = sqrt(0.5 / max(r, 1.6));
  float gam = inversesqrt(max(1.0 - beta * beta, 1e-3));
  float dop = 1.0 / (gam * max(1.0 - beta * dot(tang, toCam), 0.10));
  float grav = sqrt(max(1.0 - RS / max(r, 1.06), 0.0));
  // Clamp the boost: without it the approaching limb saturates the whole
  // frame and the shadow stops reading as black at all.
  float beam = min(pow(dop * grav, 3.0), 3.2);

  vec3 col = c * dens;
  col += vec3(1.0, 0.92, 0.82) * rim * uRimGain;
  return col * beam * uDiscGain;
}

// A small moon, mostly in shadow with a lit crescent toward the disc. It is a
// scale cue: without something of known size the hole and its rings have no
// reference, and the frame reads as a flat painting.
//
// Coverage, not a yes/no. The moon is barely twenty pixels across, so its rim
// is a step function across each of them; a hard boolean made the limb bead.
// The smoothing is done in angular units against the pixel angle, which is the
// only place that conversion is correct — doing it in world units at the moon's
// own distance puts the fade band far below one pixel wide and changes nothing.
float moonMask(vec3 ro, vec3 rd, out vec3 nrm, out vec3 surface, in float pxAngle) {
  vec3 c = vec3(-3.55, -0.62, 4.6);
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float perp2 = max(dot(oc, oc) - b * b, 0.0);
  float perp = sqrt(perp2);
  float dist = max(length(oc), 1e-3);
  float angRadius = asin(min(0.30 / dist, 1.0));
  float angDist = perp / dist;

  nrm = vec3(0.0);
  surface = c;
  if (angDist > angRadius + 3.0 * pxAngle) return 0.0;

  float cov = smoothstep(angRadius + 1.6 * pxAngle, angRadius - 1.6 * pxAngle, angDist);
  if (cov <= 0.0) return 0.0;

  float t0 = -b - sqrt(perp2 > 0.0 ? b * b - (dot(oc, oc) - 0.09) : 0.0);
  surface = ro + rd * max(t0, dist - 0.30);
  nrm = normalize(surface - c);
  return cov;
}
void main() {
  // Sub-pixel jitter: each frame samples the scene at a slightly different
  // point inside the pixel, and the frames are accumulated afterwards. A single
  // sample per pixel cannot resolve the shadow's edge, which is a step function
  // at this framing and shows up as a dotted fringe.
  vec2 uv = ((gl_FragCoord.xy + uJitter) / uResolution) * 2.0 - 1.0;

  vec3 fwd = normalize(-uCam);
  vec3 rt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fwd);
  vec3 rd = normalize(fwd
    + rt * ((uv.x - uPan.x) * uAspect * uTanHalf)
    + up * ((uv.y - uPan.y) * uTanHalf));

  // The moon is close, so test it before the geodesic: it occludes the disc.
  vec3 nrm;
  vec3 moonPos;
  float mh = moonMask(uCam, rd, nrm, moonPos,
    2.0 * uTanHalf / max(uResolution.y, 1.0));

  vec3 p = uCam;
  vec3 v = rd;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  // Escapedness has to be tracked explicitly. A ray still winding around the
  // photon sphere when the step budget runs out has *not* escaped, and treating
  // it as if it had is what painted the sky through the shadow as brown haze:
  // near-critical rays orbit for far more than any affordable number of steps.
  bool escaped = false;
  bool hitDisc = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;
    float r2 = dot(p, p);
    float r = sqrt(r2);
    if (r > uEscape && dot(p, v) > 0.0) { escaped = true; break; }
    if (r < RS * 1.0008) break;

    // Step proportional to radius: a constant number of steps per e-fold, so
    // a ray that starts 60 Rs out still resolves the plunge instead of
    // crawling in fixed increments and running out of budget.
    float dt = clamp(0.048 * r, 0.014, 3.2);
    float k = -1.5 * h2 / (r2 * r2 * r);

    vec3 a1 = p * k;
    vec3 p2 = p + v * (dt * 0.5);
    float rb = dot(p2, p2);
    vec3 a2 = p2 * (-1.5 * h2 / (rb * rb * sqrt(rb)));
    vec3 v2 = v + a1 * (dt * 0.5);

    vec3 p3 = p + v2 * (dt * 0.5);
    float rc = dot(p3, p3);
    vec3 a3 = p3 * (-1.5 * h2 / (rc * rc * sqrt(rc)));
    vec3 v3 = v + a2 * (dt * 0.5);

    vec3 p4 = p + v3 * dt;
    float rd2 = dot(p4, p4);
    vec3 a4 = p4 * (-1.5 * h2 / (rd2 * rd2 * sqrt(rd2)));
    vec3 v4 = v + a3 * dt;

    vec3 pn = p + (v + 2.0 * v2 + 2.0 * v3 + v4) * (dt / 6.0);
    vec3 vn = v + (a1 + 2.0 * a2 + 2.0 * a3 + a4) * (dt / 6.0);

    // The disc is optically thick, so the *first* crossing that lands inside it
    // is the visible surface and the path stops there. Accumulating every
    // crossing instead let near-critical rays that spiral many times pick up
    // disc emission they could never actually reach, which is what filled the
    // shadow with brown haze.
    if (p.y * pn.y < 0.0) {
      float tt = p.y / (p.y - pn.y);
      vec3 hitp = mix(p, pn, tt);
      float rr = length(hitp.xz);
      // Only the *outer* edge is a hard cut, and that is safe because the
      // density has already faded to nothing there. The inner edge is not a
      // cut at all: rejecting crossings just inside uInner sends the ray on to
      // the sky, so a step function in impact parameter turned the disc's inner
      // rim into a dotted ring of sky-coloured gaps. Let discColor fade it.
      if (rr < uOuter) {
        col = discColor(hitp, normalize(-vn));
        hitDisc = true;
        break;
      }
    }

    p = pn;
    v = vn;
  }

  if (escaped && !hitDisc) col += sky(normalize(v));

  // No painted photon ring. There used to be a bright analytic circle drawn at
  // exactly BCRIT, and it read as a hard vector stroke laid over the image —
  // the giveaway that the hole was faked. The real ring is already here: it is
  // the disc's own light, lensed around the shadow by the integration above,
  // and it comes out brighter on the approaching side on its own.

  if (mh > 0.0) {
    // The disc is the only light source, so the lit side faces it and the far
    // side stays almost black. This crescent is what makes the moon read as a
    // body rather than as a punched hole in the sky.
    vec3 toDisc = normalize(-moonPos);
    float lit = max(dot(nrm, toDisc), 0.0);
    col = mix(col * 0.03, col * 0.18 + vec3(1.0, 0.72, 0.44) * pow(lit, 1.6) * 1.5, mh);
  }

  col *= 1.0 + uExcite * 0.30;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// Accumulates a frame into the history buffer. Drawn with normal alpha
// blending and no clear, so the target becomes mix(history, frame, uAlpha) —
// the cheap form of a temporal filter, and all that is needed for anti-aliasing
// a scene whose camera drifts by a fraction of a pixel per frame.
const BLEND_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uSize;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(texture2D(tSrc, gl_FragCoord.xy / uSize).rgb, uAlpha);
}
`;

// Puts the rendered sky behind the scene. Drawn with depth off, so the machine
// composites over it normally.
const BLIT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tSky;
uniform vec2 uSize;      // size of the *screen*, not of tSky
void main() {
  // The sky is rendered at a reduced resolution but drawn over the whole
  // viewport, so the sample coordinate comes from screen pixels. Dividing by
  // the render target's own size instead squashes everything into the top-left.
  gl_FragColor = vec4(texture2D(tSky, gl_FragCoord.xy / uSize).rgb, 1.0);
}
`;

// 3*sqrt(3)/2: the impact parameter at which a photon is captured.
export const BCRIT = 2.59807621135;

export class BlackHole {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{maxPixels?:number, steps?:number}} opts
   */
  constructor(renderer, { maxPixels = 1_100_000, steps = 176 } = {}) {
    this.renderer = renderer;
    this.maxPixels = maxPixels;
    this.steps = steps;

    // `?sky=low|mid` trades resolution for speed on weak GPUs. `?sky=off` skips
    // the pass and its fullscreen blit altogether: software GL renders one frame
    // of it in seconds, which starves the e2e run of frames. `sky-check.mjs`
    // covers this pass at full quality, so the suite loses no coverage there.
    const q = new URLSearchParams(location.search).get('sky');
    this.qualityScale = q === 'low' ? 0.62 : q === 'mid' ? 0.82 : null;
    this.disabled = q === 'off';

    // Framing. `distance` and `elevation` decide the disc's apparent shape; a
    // few degrees above the plane is what produces the ring-like read.
    // A shallow elevation is what makes the disc cross in front of the shadow
    // and arc over the top: that double image is the black hole's signature. At
    // a near-edge-on 0.08 rad the disc is a flat band and the shadow reads as a
    // plain black circle, which was the original complaint.
    this.distance = 18;
    this.elevation = 0.22;
    this.inner = 3.0;
    this.outer = 7.5;
    this.tanHalf = 0.4;

    this.target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    // Accumulation history. The sky is drawn at a fixed, slightly reduced
    // resolution, so a single sample per pixel leaves the shadow's edge — a
    // step function across a handful of pixels — as a dotted fringe. Averaging
    // several jittered frames resolves it far better than raising the
    // resolution would, at no per-frame cost.
    this.history = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.accumAlpha = 0.28;
    this.jitterIndex = 0;
    this.accumWarm = 0;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3(0, 1.6, 20) },
        uPan: { value: new THREE.Vector2() },
        uTanHalf: { value: 0.4 },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uExcite: { value: 0 },
        uInner: { value: 3.0 },
        uOuter: { value: 8.5 },
        uEscape: { value: 32 },
        uResolution: { value: new THREE.Vector2(2, 2) },
        uSteps: { value: steps },
        uJitter: { value: new THREE.Vector2(0.5, 0.5) },
        uSkyGain: { value: 1 },
        uDiscGain: { value: 0.85 },
        uRimW: { value: 0.014 },
        uRimGain: { value: 5.0 },
        uFil: { value: 0.85 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute(
      [-1, 3, 0, -1, -1, 0, 3, -1, 0], 3,
    ));

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(tri, this.material));
    this.camera = new THREE.Camera();

    this.quad = new THREE.Mesh(tri.clone(), new THREE.ShaderMaterial({
      uniforms: {
        tSky: { value: this.target.texture },
        uSize: { value: new THREE.Vector2(2, 2) },
      },
      vertexShader: VERT,
      fragmentShader: BLIT_FRAG,
      depthTest: false,
      depthWrite: false,
    }));
    this.quad.frustumCulled = false;
    this.quad.renderOrder = -1000;
    this.quad.visible = !this.disabled;

    this.blend = new THREE.Mesh(tri.clone(), new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: this.target.texture },
        uSize: { value: new THREE.Vector2(2, 2) },
        uAlpha: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: BLEND_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.NormalBlending,
    }));
    this.blend.frustumCulled = false;
  }

  /**
   * Frame the hole so the shadow's radius is `frac` of the frame's short side,
   * centred on screen uv `panX/panY` (in -1..1 uv).
   */
  setFraming(width, height, frac, panX, panY) {
    const aspect = width / Math.max(1, height);
    // Angular radius of the shadow for Rs = 1 is asin(b_crit / D).
    const angular = Math.asin(Math.min(0.9, BCRIT / this.distance));
    const fit = angular / Math.max(0.02, frac * Math.min(1, aspect));
    this.tanHalf = Math.tan(fit);

    const u = this.material.uniforms;
    u.uTanHalf.value = this.tanHalf;
    u.uAspect.value = aspect;
    u.uPan.value.set(panX, panY);
    u.uInner.value = this.inner;
    u.uOuter.value = this.outer;
    u.uEscape.value = this.distance * 1.6;
  }

  setSize(width, height) {
    const k = this.qualityScale
      ?? Math.min(1, Math.sqrt(this.maxPixels / Math.max(1, width * height)));
    const w = Math.max(2, Math.round(width * k));
    const h = Math.max(2, Math.round(height * k));
    this.target.setSize(w, h);
    this.history.setSize(w, h);
    this.blend.material.uniforms.uSize.value.set(w, h);
    this.material.uniforms.uResolution.value.set(w, h);
    // Screen pixels: the blit maps the whole viewport onto the whole texture.
    this.quad.material.uniforms.uSize.value.set(width, height);
    return { w, h };
  }

  update(elapsed, excite) {
    const u = this.material.uniforms;
    const d = this.distance;
    u.uCam.value.set(0, d * Math.sin(this.elevation), d * Math.cos(this.elevation));
    u.uTime.value = elapsed;
    u.uExcite.value = excite;
  }

  render() {
    if (this.disabled) return;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const u = this.material.uniforms;

    // Rotate the sample point through the pixel in a 4x4 ordered pattern. A
    // fixed pattern is enough here: the camera drifts continuously, so each
    // frame lands in a different sub-pixel position anyway.
    const JIT = [[0.125, 0.375], [0.625, 0.125], [0.375, 0.875], [0.875, 0.625]];
    const j = JIT[this.jitterIndex % JIT.length];
    this.jitterIndex++;
    u.uJitter.value.set(j[0], j[1]);

    r.setRenderTarget(this.target);
    r.clear();
    r.render(this.scene, this.camera);

    // Fold the new frame into the history. The first few frames have nothing
    // meaningful to blend with, so they snap; after that the alpha settles at
    // its steady value. A resume from pause needs the same treatment, or the
    // first frame after a long gap ghosts against a stale image.
    this.accumWarm = Math.min(this.accumWarm + 1, 24);
    const a = this.accumWarm < 3 ? 1 : this.accumAlpha;
    this.blend.material.uniforms.uSize.value.copy(this.material.uniforms.uResolution.value);
    this.blend.material.uniforms.uAlpha.value = a;
    r.setRenderTarget(this.history);
    r.render(this.blend, this.camera);

    // Point the blit at the accumulated image rather than the raw frame.
    this.quad.material.uniforms.tSky.value = this.history.texture;

    r.setRenderTarget(prev);
  }

  /** Drop the accumulation history: call after a resize or a jump in time. */
  resetAccumulation() {
    this.accumWarm = 0;
    this.jitterIndex = 0;
  }
}
