export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const inv = (a, b, v) => clamp((v - a) / (b - a));

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeOutQuart = (t) => 1 - (1 - t) ** 4;
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const easeInQuad = (t) => t * t;
export const easeOutBack = (t, s = 1.9) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
export const easeOutElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c = (2 * Math.PI) / 3;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c) + 1;
};

/** Decaying oscillation for mechanical settle: starts at 1, rings down to 0. */
export function spring(t, freq = 5.5, decay = 5) {
  return Math.exp(-decay * t) * Math.cos(t * freq * Math.PI * 2);
}

export const smoothstep = (t) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

/** Minimal tween runner; time is injected so pausing is trivial. */
export class Tweens {
  constructor() {
    this.items = [];
  }

  add({ dur, from = 0, to = 1, ease = easeOutCubic, onUpdate, onDone, delay = 0 }) {
    const item = { t: -delay, dur, from, to, ease, onUpdate, onDone, done: false };
    this.items.push(item);
    return item;
  }

  /** Promise-friendly wait, resolved by the same clock as everything else. */
  wait(dur) {
    return new Promise((resolve) => {
      this.add({ dur, onDone: resolve });
    });
  }

  update(dt) {
    for (const it of this.items) {
      if (it.done) continue;
      it.t += dt;
      if (it.t < 0) continue;
      const k = it.dur <= 0 ? 1 : clamp(it.t / it.dur);
      it.onUpdate?.(lerp(it.from, it.to, it.ease(k)), k);
      if (k >= 1) {
        it.done = true;
        it.onDone?.();
      }
    }
    if (this.items.length > 64) this.items = this.items.filter((i) => !i.done);
  }
}

/** Frame-rate independent exponential follow that also handles hitches. */
export class Follower {
  constructor(value = 0, lambda = 8) {
    this.value = value;
    this.target = value;
    this.lambda = lambda;
    this.velocity = 0;
  }

  step(dt) {
    const prev = this.value;
    this.value = damp(this.value, this.target, this.lambda, dt);
    this.velocity = dt > 0 ? (this.value - prev) / dt : 0;
    return this.value;
  }
}
