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
uniform float uThick;      // scale-height multiplier (disc thickness)
uniform float uOpacity;    // optical depth per unit density
uniform float uDust;       // strength of the dark lanes cutting the gas
uniform float uLane;       // where the dust lanes start biting, in field units
uniform vec2  uTurb;       // (azimuthal, radial) frequency scale of the gas
uniform float uNoiseLod;   // scale on the noise LOD (1 = nominal footprint)
uniform float uRingW;      // width of the hot inner rim, as a fraction of the span
uniform float uRingGain;
uniform float uRingBand;   // width, in BCRIT, of the higher-order image suppression band
uniform float uRingFan;    // how much the near-critical crossings widen their footprint
uniform float uSecGain;    // strength of the disc's secondary (lensed) image
uniform float uSecW;       // width of that arc, in BCRIT, at its widest
uniform float uHeat;       // steepness of the radial temperature falloff
uniform float uFlare;      // extra outward flare on the slab height
uniform float uFine;       // radial rate of the fine bands, relative to uTurb.y
uniform float uGrazMin;    // floor on the incidence cosine, capping grazing elongation
uniform float uWind;       // shear clock (s): differential winding saturates past this
uniform float uSpin;       // rigid rotation rate once the winding has saturated (rad/s)

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

// Same field, with the octaves finer than the pixel footprint replaced by their
// mean. fp is per unit of the input coordinate. Used where the field modulates
// something with a hard edge -- the slab thickness, the vertical profile -- where
// an unresolved octave does not average away but combs into a visible fringe.
float fbmLod(vec2 p, vec2 fp) {
  float s = 0.0;
  float a = 0.5;
  float f = 1.0;
  for (int i = 0; i < 4; i++) {
    float n = vnoise(p);
    s += a * mix(0.5, n, 1.0 - smoothstep(0.55, 1.55, max(fp.x, fp.y) * f));
    p = p * 2.07 + 11.7;
    f *= 2.07;
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
//
// The disc is a flared slab of gas, not a painted plane. A photon path that
// crosses it marches a handful of samples through the slab and accumulates
// emission with transmittance, so the near wall genuinely hides the far one and
// the gas has depth. A single sample on the plane — what this did before — can
// only ever produce a sheet: flat, and with none of the billowing structure that
// makes an accretion disc read as matter rather than as a decal.
//
// Everything below is in Schwarzschild radii, y is the disc's own axis.

// Scale height of the slab. Flared, because a real disc is puffed up by the
// pressure of its own hot inner gas: a constant thickness reads as a plank.
float discHeight(float r) {
  return uThick * (0.055 + 0.030 * pow(max(r, 1.0), 1.12) * (1.0 + 0.55 * uFlare));
}

// Turbulence in the co-rotating polar frame.
//
// Angular position is fed in as a point on a circle, so the field closes on
// itself at the wrap with no seam, and its angular frequency is just the radius
// of that circle. radialPos advances the field outward. Keeping the angular
// frequency well below the radial one stretches each cell along the orbit, which
// is what differential rotation does to the gas: structure is sheared into long
// trailing filaments rather than left as even cotton wool.
// fp is the pixel footprint in the units the field is sampled in -- x along the
// co-rotating circle, y along the radial coordinate. It is per axis because the
// disc shears: a pixel can span a lot of angle and almost no radius, or the
// reverse. An octave whose cells are smaller than the footprint cannot be
// resolved; neighbouring pixels fall in unrelated cells and the band turns to
// dashes. Such an octave is replaced by its mean rather than dropped, because
// dropping it lowers the sum and these fields feed narrow smoothstep windows,
// so a small shift in the level is the difference between a sheet of gas and
// empty sky.
float streakFbm(vec2 circ, float radialPos, float angF, float radF, int oct,
                vec2 fp) {
  float s = 0.0;
  float a = 0.52;
  for (int i = 0; i < 4; i++) {
    if (i >= oct) break;
    float n = vnoise(circ * angF + vec2(3.7, radialPos * radF));
    float cells = max(fp.x * angF, fp.y * radF);
    s += a * mix(0.5, n, 1.0 - smoothstep(0.55, 1.55, cells));
    angF *= 2.13;
    radF *= 2.07;
    a *= 0.50;
  }
  return s;
}

// Density and temperature at one point inside the slab. The co-rotating
// coordinates and the shear are computed once per march and passed in: they only
// depend on radius and angle.
float discDensity(vec3 p, float r, vec2 circ, float rn, float shear, vec2 fp,
                  float vstep, float rtol, out vec3 tint) {
  // Radial profile: a bright plateau from the ISCO outward that fades slowly,
  // then an outer taper that reaches zero tangentially. A steep power law still
  // leaves a visible step where it hits the cut-off, which reads as the disc
  // ending in mid-air.
  // The inner edge is the steepest thing in the whole disc, and rays that graze
  // the photon sphere cross it at wildly different radii from one pixel to the
  // next. Unfiltered, that step aliases into a dotted ring; rtol is how much
  // radius the crossing actually covers, so the onset softens exactly as far as
  // the sampling requires and no further.
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float radial = smoothstep(uInner - rtol, uInner + 0.14 + rtol, r)
               * pow(1.0 - t, 0.75);
  radial *= smoothstep(1.0, 0.80, t);

  // Bend the azimuth by a low-frequency field before sampling the gas. A
  // perfectly concentric field reads as grooves on a record; bending the angle
  // by something that varies with angle turns each groove into a wavy filament
  // that starts and stops, which is the difference between vinyl and gas.
  float bend = fbm(circ * 0.85 + vec2(0.0, rn * 0.50) + 13.1) - 0.5;
  float bsw = shear + bend * 2.6;
  vec2 circ2 = vec2(cos(bsw), sin(bsw));



  // Filament field. Each band of the smoothstep is a separate ribbon, and the
  // gaps between them are genuine zero-density gaps rather than a dim version
  // of the ribbon: that hard contrast is what the eye reads as turbulence. The
  // three scales are the broad billows, the ribbons, and the fraying on their
  // edges.
  // Only the finer two scales follow uTurb.x. Scaling the broad field with them
  // too turns the whole disc into an even marble, with no large arms left for
  // the fine structure to sit on -- and large, smooth sweeping arms are what
  // make the disc read as a disc rather than as a texture.
  float big = streakFbm(circ2, rn, 2.2, 1.05 * uTurb.y, 3, fp);
  float mid = streakFbm(circ2, rn, 2.2 * uTurb.x * 0.55, 2.90 * uTurb.y, 3, fp);
  float fine = streakFbm(circ2, rn, 2.2 * uTurb.x, 4.60 * uTurb.y * uFine, 2, fp);

  // The cloud field sets the slab thickness and the vertical profile, so an
  // unresolved octave in it combs the rim into a fringe instead of averaging out.
  vec2 cpn = vec2(1.25, 0.55) * fp;
  float cloud = fbmLod(circ2 * 1.25 + vec2(7.3, rn * 0.55), cpn);

  // Vertical profile: a Gaussian of the local scale height, widened by how much
  // of it one march step covers. Rays skimming the photon sphere cross the slab
  // almost tangentially, a step at a time, and an unfiltered Gaussian lets a
  // single sample land on the crest and its neighbours miss it entirely: that
  // is the speckle along the ring.
  //
  // The displacement is kept small on purpose. Displacing the slab's surface by
  // the cloud field looks right where the disc is seen face-on, but along the
  // near wall the path runs almost in the plane, and any vertical shift there
  // stacks the displaced sheets into hard horizontal bands.
  float h = discHeight(r) * (0.82 + 0.36 * cloud);
  float yy = (p.y - h * (cloud - 0.45) * 0.35) / max(h, 1e-3);
  float widen = 1.0 + pow(vstep / max(h, 1e-3), 2.0);
  float vert = exp(-yy * yy * 1.6 / widen) * inversesqrt(widen);
  // Broad billows: a slow, high-contrast mask that breaks the disc into
  // separate sheets of gas instead of tiling it evenly.
  // The windows are narrow on purpose: the noise returns values bunched around
  // its mean, so a wide smoothstep only ever produces a soft gradient. Squeezing
  // the window is what turns the same field into sheets of gas with genuinely
  // empty sky between them, which is the contrast the reference has.
  float billow = smoothstep(0.38, 0.62, big + bend * 0.30);
  // Ribbons, cut so the valleys really are empty.
  float ribbon = smoothstep(0.40, 0.66, mid + bend * 0.22);
  float density = radial * vert;
  density *= (0.02 + 2.10 * billow) * (0.015 + 1.70 * ribbon * ribbon)
            * (0.80 + 0.40 * fine);
  // Slow clumping: gas collects into knots along the ribbons.
  density *= 0.10 + 1.60 * cloud * cloud;

  // Dust lanes: broad, soft-edged channels cut out of the gas. Real discs are
  // laced with shadowed dust that silhouettes the glow behind it, and without
  // them any amount of bright structure still reads as a gradient with speckle.
  // Multiplicative rather than subtracted, so they darken without ever punching
  // a hole through to the sky.
  // Two octave scales, because one leaves the lanes evenly stippled across the
  // disc. Real dust collects into broad shadowed banks with sharper edges
  // inside them, and the eye reads those banks, not the fine texture, as depth.
  float dustField = streakFbm(circ2, rn, 1.6 * uTurb.x, 2.20 * uTurb.y, 3, fp);
  float dustFine = streakFbm(circ2, rn, 4.1 * uTurb.x, 5.30 * uTurb.y * uFine, 2, fp);
  dustField = smoothstep(uLane, uLane + 0.44, dustField + bend * 0.50 + dustFine * 0.22);
  // uDust is a strength dial, so it spends part of its range past 1. Clamp the
  // mix weight: extrapolating a mix toward a value below 0.03 drives density
  // negative, and a negative density emits nothing while still consuming
  // transmittance, which turns the whole disc black.
  density *= mix(1.0, 0.03 + 0.99 * (1.0 - dustField), clamp(uDust, 0.0, 1.0));

  // The hot inner rim used to live here as a Gaussian in radius, boosted by
  // uRingGain. It is gone: a radius-keyed Gaussian is sampled at whichever
  // radius each pixel's geodesic happens to cross, and near the photon sphere
  // adjacent pixels cross tens of scale heights apart, so the rim combed into a
  // dotted arc no amount of filtering fixed. The rim is now keyed on the impact
  // parameter in main(), where it cannot alias. What is left here is the plain
  // radial profile, so the gas still brightens toward the ISCO on its own.

  // Temperature: white-hot at the inner edge, salmon through the body, deep
  // ember out. Real thin-disc emission is broad and warm; a neutral grey-brown
  // ramp is the single most "painted" failure available here.
  // A steep exponent keeps the body in the copper range and saves white for the
  // innermost gas. Too shallow and the whole disc washes out to cream, which is
  // the single most "rendered" looking failure here.
  float temp = pow(uInner / max(r, uInner), uHeat);
  // The base of the ramp is deliberately near-black. Most of the disc is cold
  // dust seen at an angle, and it should read as dark brown mass; the bright
  // filaments come from density, not from the tint. A mid-body that is already
  // a bright orange makes every square inch of gas look equally lit, which is
  // the flat, washed-out look this ramp exists to avoid.
  tint = mix(vec3(0.058, 0.0165, 0.0060), vec3(0.34, 0.085, 0.024),
             smoothstep(0.06, 0.46, temp));
  tint = mix(tint, vec3(0.95, 0.300, 0.080), smoothstep(0.58, 0.94, temp));
  // White is reserved for the last few percent of the temperature range. Spread
  // any wider and the whole inner disc, which is where most of the near wall
  // comes from, sits in a range that ACES desaturates to cream.
  tint = mix(tint, vec3(1.00, 0.79, 0.58), smoothstep(0.965, 1.0, temp));

  // The hottest gas sits in a skin at the inner lip. It stays copper, never
  // peach: lensing magnifies this band until it wraps most of the shadow, and
  // anything whiter here reads as a cream halo around the hole rather than as
  // hot gas. The narrow bright line is the photon ring's job, not the lip's.
  float lip = clamp((r - uInner) / (0.055 * (uOuter - uInner)), 0.0, 1.0);
  tint = mix(vec3(0.98, 0.320, 0.085), tint, smoothstep(0.0, 0.75, lip));

  // Light the thin gas on the slab's faces hotter than its interior: a uniform
  // temperature through the thickness flattens the body into a sticker.
  tint *= 1.0 + 0.30 * abs(yy);

  return density;
}

// Emission from the segment of the path that lies inside the disc. The march is
// uniform in path length and short: the slab is thin compared with the frame,
// and the same turbulence sampled more coarsely only reads as smoother.
vec3 discColor(vec3 entry, vec3 dir, float r, float rstep, float fan,
               out float alpha) {
  float h = discHeight(r);
  // Path length through the slab, clamped: a ray running almost exactly in the
  // plane would otherwise integrate for an unbounded distance and pick up an
  // emission spike, which shows up as a bright seam across the disc.
  // Five scale heights either side: three was cutting the Gaussian's tail, and
  // the missing mass is what made the lensed secondary image, which is only a
  // few pixels wide, come out as a dotted arc instead of a line.
  float span = min(5.0 * h / max(abs(dir.y), 0.06), 7.0 * h);
  // Sampling has to keep up with the Gaussian, not with the span: too few
  // samples and the thin bright features land on one sample and miss the next,
  // which shows up as grain on the near wall and as dots along the ring.
  const int MARCH = 18;
  float dt = span / float(MARCH);

  float ang = atan(entry.z, entry.x);
  // Keplerian shear. The inner gas laps the outer many times over, which is
  // what drags the turbulence into long trailing spirals.
  //
  // That winding must be bounded. Shear is proportional to d(omega)/dr, so its
  // radial gradient grows in proportion to t with no upper bound: at 120 s it is
  // tens of radians per unit radius, far finer than the noise's own radial axis
  // (~3.3). Every filament is then wound into a ring a fraction of a pixel wide,
  // the noise averages to its mean, and the disc collapses into smooth
  // concentric grooves -- the flat washer this rewrite exists to avoid. Softening
  // the clock's growth bounds the gradient, so the gas keeps shearing until its
  // filaments are as thin as the field can carry and then holds that state.
  float omega = pow(max(r, 1.0), -1.5);
  float tEff = uWind * uTime * inversesqrt(uWind * uWind + uTime * uTime);
  // Saturated shear no longer moves, so the pattern would freeze once wound
  // out. Rigid rotation keeps it alive: being independent of radius it adds no
  // winding of its own, so it cannot reintroduce the rings.
  float shear = ang - omega * tEff * 2.6 - uTime * uSpin;
  vec2 circ = vec2(cos(shear), sin(shear));
  // Radial coordinate for the noise: compressed, so the outer disc does not
  // carry a far higher spatial frequency than the inner one.
  float rn = pow(max(r, 1.0), 0.62) * 2.2;

  // Relativistic beaming: the limb sweeping toward us blazes, the receding limb
  // dims and reddens, plus gravitational redshift near the horizon. One term
  // per path is enough: over the slab the radius barely changes.
  vec3 tang = normalize(cross(vec3(0.0, 1.0, 0.0), entry));
  float beta = sqrt(0.5 / max(r, 1.6));
  float gam = inversesqrt(max(1.0 - beta * beta, 1e-3));
  float dop = 1.0 / (gam * max(1.0 - beta * dot(tang, -dir), 0.10));
  float grav = sqrt(max(1.0 - RS / max(r, 1.06), 0.0));
  // Clamped: without it the approaching limb saturates the whole frame and the
  // shadow stops reading as black at all.
  // Capped lower than the beaming term would naturally go. Past about 1.5 the
  // brightest gas crosses 1.0 in linear space and ACES spends its top range
  // desaturating to white, which is what turned the lensed inner rim into a
  // cream halo instead of hot copper.
  float beam = min(pow(dop * grav, 2.3), 1.55);

  vec3 acc = vec3(0.0);
  float T = 1.0;
  // The march is dense enough to stand on its own, so it starts at a fixed half
  // step: no positional jitter at all. Jittering it per frame was the source of
  // the grain on the near wall, because the slab there is thin compared with a
  // step and a jitter of one full step changed which samples landed inside it.
  float jit = 0.5;
  for (int i = 0; i < MARCH; i++) {
    // Centred on the plane crossing, which is where the path meets y = 0: the
    // slab extends to either side of it.
    vec3 p = entry + dir * (dt * (float(i) - float(MARCH) * 0.5 + 0.5 + jit));
    // Radius at this sample rather than at the crossing: on the near wall the
    // march covers a noticeable slice of the disc, and holding r fixed makes
    // the slab look like it is made of concentric bands.
    float rs = length(p.xz);
    // Angular footprint of one *pixel* at this radius. It has to come from the
    // pixel, not from the march step: the step is a quadrature resolution, and
    // scaling the noise by it blurred the whole disc into a flat sheet. What the
    // eye integrates is the pixel, and near the photon sphere a pixel sweeps a
    // long way round the disc, which is where the fine octaves alias.
    // Divided by the incidence cosine, not just the distance. A pixel covers a
    // fixed solid angle, but the patch of disc plane it lands on is elongated by
    // 1/|cos| when the plane is seen at a glancing angle, and the near wall of
    // this disc is very glancing indeed. Omitting that factor under-reported the
    // footprint exactly on the wall and left its finest octaves aliased -- the
    // zippered herringbone that no amount of octave filtering elsewhere cured.
    float pixAng = 2.0 * uTanHalf / max(uResolution.y, 1.0)
                 * length(uCam) / max(rs, 1.0) / max(abs(dir.y), uGrazMin);
    // Both axes must be the *pixel's* footprint, in the units their noise
    // coordinate is sampled in. fp.x is an angle in radians, which is what the
    // azimuth coordinate already is. fp.y is the same pixel converted into rn
    // through d(rn)/dr.
    //
    // Deliberately not the march step's radial extent. The march carries no
    // per-frame jitter, so its step is a fixed quadrature resolution and the
    // same for every pixel that crosses there: it produces no noise the eye has
    // to integrate away. Folding it in filtered the radial axis as hard as the
    // step is coarse, which is everywhere -- that is what flattened the disc
    // into smooth sheets whenever the filtering was strong enough to work.
    // d(rn)/dr, the radial compression the noise coordinate applies.
    float drn = 0.62 * pow(max(rs, 1.0), -0.38) * 2.2;
    float pixRn = pixAng * rs * drn;
    vec3 tint;
    // How much radius this crossing covers. Two sources: the slab path itself,
    // and -- the one that matters -- how far the radius moved across the whole
    // march step. Adjacent pixels trace geodesics that diverge sharply near the
    // photon sphere, so their crossings land at radii tens of scale heights
    // apart; the ring is a narrow Gaussian in radius, so an unfiltered crossing
    // is either on it or off it, and the rim comes out as a comb of dots.
    float rfar = length((entry + dir * span).xz);
    float rspan = max(rstep, abs(rfar - r) * 0.6);
    // The crossing is a segment of disc, not a point, so its noise footprint in
    // r covers as much radius as that segment spans. Unlike the march step this
    // term does vary between neighbouring pixels -- near the photon sphere the
    // crossings fan out over tens of scale heights -- and that fanning is what
    // beads the inner rim. Filtering by it is filtering the thing the eye is
    // actually integrating.
    vec2 fp = vec2(pixAng, pixRn) * uNoiseLod * fan;
    float d = discDensity(p, rs, circ, rn, shear, fp, abs(dir.y) * dt,
                          rspan, tint);
    // Emission-absorption, with a floor on the transmittance step so the very
    // dense core does not band into rings where T collapses in one sample.
    float od = d * dt * uOpacity;
    // Emission weighted by the same optical depth as absorption, so the march
    // converges on the source function instead of on its integral over the
    // path. Without this, a long grazing path through the near wall accumulates
    // many times the light a real optically thick surface could emit, and that
    // is what painted the near wall as a blown-out white band.
    float a = 1.0 - exp(-od);
    acc += T * tint * a;
    T *= 1.0 - a;
    if (T < 0.02) break;
  }

  alpha = 1.0 - T;
  // Hue-preserving shoulder. The near wall is where most of the disc's light
  // comes from, and its integrated emission runs well past 1.0 in linear space;
  // ACES spends its entire top end desaturating that, so the brightest gas came
  // out as a pale cream sheet no matter what tint it was given. Compressing
  // luminance here, before the tone map, keeps the ratios between the channels
  // (so the gas stays copper) while still leaving range for the rim to read as
  // the hottest part.
  vec3 lit = acc * beam * uDiscGain;
  float lum = dot(lit, vec3(0.2126, 0.7152, 0.0722));
  const float KNEE = 0.85;
  const float SPAN = 0.55;
  float mapped = lum <= KNEE ? lum : KNEE + SPAN * (1.0 - exp(-(lum - KNEE) / SPAN));
  return lit * (mapped / max(lum, 1e-5));
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
  float T = 1.0;        // remaining transmittance along the path
  int crossings = 0;

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

    // Crossings accumulate with transmittance rather than stopping at the
    // first one. An opaque first-crossing rule can only ever draw a surface,
    // so the near wall of the disc hid the lensed far side instead of glowing
    // through it. The cap on crossings is what keeps a near-critical ray, which
    // can orbit many times, from stacking up emission it could never reach —
    // that is what once filled the shadow with brown haze.
    // A plane sign change is not the only way to enter the disc. Near the
    // photon sphere a ray runs almost parallel to the plane, and it can dip
    // into the slab and climb back out inside a single step: no sign flip, so
    // the crossing was silently dropped. That is exactly what the dotted arc
    // along the lensed inner rim is -- not noise and not thin gas, but
    // crossings that never registered. A turning point inside the slab counts
    // as a crossing too, and the Hermite y-curve already computed for the step
    // gives where it happens.
    bool crossing = p.y * pn.y < 0.0;
    float tt = crossing ? p.y / (p.y - pn.y) : 0.5;
    if (!crossing && v.y * vn.y < 0.0
        && min(abs(p.y), abs(pn.y)) < 3.0 * discHeight(length(p.xz))) {
      float m0 = v.y * dt;
      float m1 = vn.y * dt;
      float qa = 6.0 * p.y + 3.0 * m0 - 6.0 * pn.y + 3.0 * m1;
      float qb = -6.0 * p.y - 4.0 * m0 + 6.0 * pn.y - 2.0 * m1;
      float qd = qb * qb - 4.0 * qa * m0;
      if (qd >= 0.0 && abs(qa) > 1e-6) {
        float sq = sqrt(qd);
        float u1 = (-qb + sq) / (2.0 * qa);
        float u2 = (-qb - sq) / (2.0 * qa);
        // The outer root is the turning point; the inner one is the other
        // extremum of the same cubic and is usually outside the step.
        float u = (u1 > 0.02 && u1 < 0.98) ? u1
                : ((u2 > 0.02 && u2 < 0.98) ? u2 : 0.5);
        tt = u;
        crossing = true;
      }
    }
    if (crossing) {
      vec3 hitp = mix(p, pn, tt);
      float rr = length(hitp.xz);
      // Only the *outer* edge is a hard cut, and that is safe because the
      // density has already faded to nothing there. The inner edge is not a
      // cut at all: rejecting crossings just inside uInner would send the ray
      // on to the sky, so a step function in impact parameter turns the disc's
      // inner rim into a dotted ring of sky-coloured gaps. Let the density fade.
      if (rr < uOuter) {
        float a;
        // Taper the band of impact parameters that wraps the photon sphere.
        // Rays there orbit before escaping, so how many crossings the march
        // registers swings from pixel to pixel and the higher-order image the
        // disc casts comes out as a chevron comb rather than a line. The ring in
        // main() carries that light instead.
        //
        // Only higher-order crossings are tapered. Keying the suppression on b
        // alone also dimmed the first crossing, and the first crossing *is* the
        // face-on disc: it spans b from zero upwards, so a band wide enough to
        // reach the comb carved a dark ring out of the bright body and forced
        // the disc gain up to compensate. The comb is built entirely from
        // rays that cross the plane two or more times, so gating on the
        // crossing count leaves the primary image untouched.
        float ringBand = uRingBand <= 0.0 ? 0.0 : exp(-pow((length(hv) - BCRIT) / (uRingBand * BCRIT), 2.0));
        float higher = crossings > 0 ? 1.0 : 0.0;
        // Rays near the critical impact parameter wind round the photon sphere,
        // so how many times they cross the plane, and at which radii, swings
        // violently from pixel to pixel. Their crossings genuinely fan out over
        // a wide span of the disc, so widen the footprint the density is
        // filtered with to match. Without this the higher-order image the disc
        // casts over the shadow is a chevron comb; with it, a continuous band.
        float fan = 1.0 + 9.0 * exp(-pow((length(hv) - BCRIT) / (0.20 * BCRIT), 2.0));
        col += T * discColor(hitp, normalize(vn), rr,
                             abs(length(pn.xz) - length(p.xz)), fan, a)
             * (1.0 - ringBand * higher * uRingFan);
        T *= 1.0 - a;
        crossings++;
        if (T < 0.04) break;
      }
    }

    p = pn;
    v = vn;
  }

  // The photon ring, keyed on the impact parameter rather than on radius.
  //
  // h2 is conserved along a Schwarzschild geodesic, so this profile is constant
  // over the whole ray: it is a property of which ray you are, not of where the
  // march happened to sample. That is what makes it immune to the combing that
  // any radial rim suffers -- there is no discretisation in b for it to alias
  // against, only the smooth function of the camera ray.
  //
  // Physically this is the disc's own light: rays with b just above BCRIT wind
  // around the photon sphere and pick up emission from every pass, so the
  // brightest line in a real image sits at the shadow's edge and is made of the
  // disc, not of anything painted on. Multiplying the light those rays already
  // gathered is the cheap version of that sum.
  //
  // The width is floored in pixels: db per pixel is the camera distance times
  // the pixel angle, and a profile thinner than that would alias in b the same
  // way the radial rim aliased in r.
  // The width is a hairline, and it can be, because b is a smooth function of
  // the pixel: it is computed from the ray direction alone, with no discretised
  // march behind it. Flooring the sigma at a pixel of b is all the anti-aliasing
  // it needs -- the earlier, fat version was compensating for a comb that came
  // from somewhere else. uRingW is the floor in b units.
  float b = sqrt(h2);
  float pixB = length(uCam) * (2.0 * uTanHalf / max(uResolution.y, 1.0));
  float bSig = max(uRingW, 0.9 * pixB);
  float ring = exp(-pow((b - BCRIT) / bSig, 2.0));
  // Gated on b, not on escapedness: rays right at the critical impact parameter
  // are the ones that exhaust the step budget, so an escapedness gate punched a
  // hole exactly at the ring's peak. Everything with b below the shadow edge is
  // swallowed and must stay black, and the ramp up to the half-power point
  // keeps that from becoming a second hard edge next to the shadow's own.
  ring *= smoothstep(BCRIT - 1.5 * bSig, BCRIT + 0.5 * bSig, b);
  // Additive, not a multiplier on the gathered light. Rays at b ~ BCRIT are the
  // ones whose march is least able to sample the disc: they wind around the
  // photon sphere crossing it a wildly varying number of times per pixel, so
  // multiplying that sparse, uneven emission by the ring profile re-printed the
  // comb no matter how smooth the profile was. The profile itself is the smooth
  // part, so the ring has to *be* the emission: this stands in for the light of
  // all the orbits the march could not afford to take.
  // It must not be a uniformly bright circle either: a profile that adds the
  // same amount everywhere is a vector stroke, and a stroke is the tell that
  // the hole is faked. Real ring brightness follows the disc -- brightest where
  // the disc is behind the shadow and Doppler-boosted on the approaching side,
  // fading to almost nothing where there is no gas to lens. Weighting by the
  // light the ray already gathered does that for free, with a floor so the ring
  // still closes around the whole shadow instead of breaking into arcs.
  // The weighting is geometric, not taken from the gathered light. Sampling
  // that light per pixel put the noise straight back into the profile: two
  // neighbouring pixels on the ring can differ by an order of magnitude in
  // what their marches happened to catch, so the ring came out beaded again.
  // Screen angle around the shadow is smooth by construction, so it varies the
  // ring the way the disc does without importing any of its sampling.
  vec2 sc = uv - uPan;
  sc.x *= uAspect;
  vec2 sd = normalize(sc + vec2(1e-5));
  // Brightest on the approaching (left) side and around the near wall where
  // the disc crosses in front; faintest over the top, where there is least gas
  // to lens.
  float ringMod = 0.10
                + 0.92 * smoothstep(0.62, -0.45, sd.y)
                + 0.42 * (0.5 - 0.5 * sd.x) * smoothstep(0.80, -0.10, sd.y);
  ringMod = clamp(ringMod, 0.0, 1.0);
  vec3 ringCol = vec3(1.0, 0.62, 0.34);
  col += ringCol * ring * ringMod * uRingGain;

  // The disc's secondary image: the far side of the disc, bent over the top of
  // the shadow. This is the arc the reference is built around and it is what
  // makes the hole read as gravitationally lensed rather than as a black dot
  // with a ring scratched around it.
  //
  // It is synthesised rather than marched. The marching integrator *does* find
  // these crossings, but rays near the critical impact parameter wind round the
  // photon sphere, so how many times a given pixel crosses the plane, and where,
  // swings wildly from one pixel to the next. The result is a chevron comb:
  // discrete emission packets, not a continuous band. Widening the noise
  // footprint tenfold and suppressing the band both left it untouched, which is
  // what rules out aliasing as the cause -- the quantisation is in the crossing
  // count itself.
  //
  // So the geometry is drawn explicitly: an annulus of width proportional to
  // distance from the shadow edge, in which the disc plane is re-sampled with
  // the same turbulence the primary image uses, at a radius and azimuth that
  // fold the far side over the top. Being keyed on b, it is as smooth as the
  // photon ring and cannot comb.
  {
    float excess = (b - BCRIT) / BCRIT;
    // Widens upward: the far side is lifted highest directly over the shadow
    // and thins to nothing at the sides, which is where the near wall takes over.
    float up = smoothstep(-0.30, 0.85, sd.y);
    float bandW = mix(uSecW * 0.55, uSecW, up);
    float gate = smoothstep(0.004, 0.05, excess)
               * exp(-pow(excess / bandW, 2.0));
    // Fades out where the disc is in front of the hole: the near wall already
    // draws that, and a second copy there reads as a ghost.
    gate *= smoothstep(-0.62, 0.10, sd.y) * uSecGain;
    if (gate > 0.002) {
      float q = clamp(excess / bandW, 0.0, 1.0);
      float ang = atan(sd.y, sd.x);
      // Turbulence has to be sampled at a frequency this band can actually
      // resolve. The band is a *compressed* picture of the far side -- the far
      // disc folded over the shadow -- so per-pixel gas noise has no meaning
      // here: neighbouring pixels look at unrelated cells and the arc speckles
      // into a comb. Instead the field is anisotropic and low-frequency, which
      // is also the correct look: long streaks along the flow, laddered across
      // it, exactly as the primary disc reads.
      // The angular coordinate is a *point on a circle*, not an angle. atan
      // wraps at +-PI, which is the left horizontal axis, so sampling raw angle
      // tore a hard horizontal seam into the arc there. A closed circle has no
      // wrap. q stays radial, which is what makes the field anisotropic: it
      // varies fast across the band and slowly along it.
      float spin = uTime * 0.045;
      vec2 circA = vec2(cos(ang + spin), sin(ang + spin));
      vec2 afp = vec2(0.012, 0.012);
      float st = streakFbm(circA, q, 1.9, 3.4, 3, afp);
      float fineSt = streakFbm(circA, q, 5.3, 8.5, 2, afp);
      float band = smoothstep(0.30, 0.60, st + fineSt * 0.30);
      // Dust lanes: two scales, because one leaves the arc evenly stippled. The
      // broad banks are what the eye reads as depth; the fine division inside
      // them is what makes it read as gas rather than as smoke.
      float laneB = streakFbm(circA, q, 3.3, 2.5, 3, afp + 0.01);
      float laneF = streakFbm(circA, q, 7.6, 10.0, 2, afp);
      float lane = smoothstep(0.27, 0.55, laneB) * (0.45 + 1.10 * smoothstep(0.33, 0.62, laneF));
      float body = (0.10 + 1.45 * band) * (0.22 + 1.05 * lane);

      // Temperature falls outward across the band: the inner edge is gas close
      // to the ISCO and runs hot, the outer edge is cold dust.
      float tq = pow(1.0 - q, 1.15);
      vec3 aCol = mix(vec3(0.075, 0.022, 0.0080), vec3(0.36, 0.092, 0.026),
                      smoothstep(0.05, 0.55, tq));
      aCol = mix(aCol, vec3(1.00, 0.52, 0.20), smoothstep(0.72, 0.99, tq));
      col += aCol * body * gate;
    }
  }

  // Transmittance carries into the sky: the tenuous outer disc must let the
  // background through, or every wisp of gas reads as opaque paint.
  if (escaped) col += sky(normalize(v)) * T;

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

// 4x4 ordered sample pattern for the sub-pixel jitter (a Bayer matrix, offset to
// cell centres). Sixteen phases are what it takes for the lensed inner rim to
// average into a line instead of a string of dots.
const RING_JITTER = (() => {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return bayer.map((n) => [(n % 4 + 0.5) / 4, (Math.floor(n / 4) + 0.5) / 4]);
})();

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
    // A few degrees above the plane is what makes the near wall of the disc
    // cross the shadow and the far side arc over it. Much lower and the disc
    // flattens into a band; much higher and the shadow reads as a lid.
    this.elevation = 0.46;
    this.inner = 3.0;
    // The disc has to run off the edges of the frame. Ending inside it made the
    // hole look like an object in a box instead of something far larger than the
    // frame, which is most of why it read as underwhelming.
    this.outer = 46.0;
    this.thick = 4.4;
    this.opacity = 1.0;
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
        uDiscGain: { value: 19.0 },
        uThick: { value: 4.4 },
        uOpacity: { value: 2.4 },
        uDust: { value: 2.4 },
        uLane: { value: 0.60 },
        uTurb: { value: new THREE.Vector2(9.0, 1.6) },
        uNoiseLod: { value: 0.75 },
        uRingW: { value: 0.011 },
        uRingGain: { value: 3.6 },
        uRingBand: { value: 2.6 },
        uRingFan: { value: 1.0 },
        uSecGain: { value: 3.6 },
        uSecW: { value: 0.46 },
        uHeat: { value: 2.8 },
        uFlare: { value: 1.0 },
        uFine: { value: 7.5 },
        uGrazMin: { value: 0.04 },
        uWind: { value: 5.0 },
        uSpin: { value: 0.012 },
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

  // `thick` and `opacity` are the tuning surface used from the console and from
  // tools/, but the shader reads uniforms. Without these accessors a write to
  // either one silently did nothing, which is how a thickness change could look
  // like it had no effect at all.
  get thick() { return this._thick; }
  set thick(v) {
    this._thick = v;
    if (this.material) this.material.uniforms.uThick.value = v;
  }

  // Same reason: the march budget is a uniform, and a plain field write left it
  // at the constructor's value, so raising `steps` to test the shadow's edge
  // changed nothing.
  get steps() { return this._steps; }
  set steps(v) {
    this._steps = v;
    if (this.material) this.material.uniforms.uSteps.value = v;
  }

  get opacity() { return this._opacity; }
  set opacity(v) {
    this._opacity = v;
    if (this.material) this.material.uniforms.uOpacity.value = v;
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
    u.uEscape.value = Math.max(this.distance * 1.6, this.outer * 1.15);
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
    // 4x4 ordered pattern. Four phases were not enough: along the photon ring
    // neighbouring pixels trace geodesics that diverge sharply, so a pixel has
    // to average over a real spread of sub-pixel rays before the ring closes up.
    const JIT = RING_JITTER;
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
