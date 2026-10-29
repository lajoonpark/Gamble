// Pure game logic: no three.js, no DOM. Runs in the browser and in node (tools/sim.mjs).

export const START_BALANCE = 100;
export const BET_FRACTION = 0.1;
export const MIN_BET = 0.01;
export const BUST_LIMIT = 1;

export const SYMBOL_IDS = ['asteroid', 'comet', 'crescent', 'planet', 'nebula', 'singularity'];

// Rarity reads as brightness: dim slate for the common rock, ice-white for the
// jackpot. Keeping the palette monochrome means the reel's contrast carries the
// whole hierarchy.
export const SYMBOLS = {
  asteroid:    { name: 'Asteroid',    accent: '#6c7c91', ink: '#aab8c9', glyph: 'asteroid' },
  comet:       { name: 'Comet',       accent: '#7fa6cf', ink: '#c8dcf2', glyph: 'comet' },
  crescent:    { name: 'Crescent',    accent: '#9db6d2', ink: '#e2edfa', glyph: 'crescent' },
  planet:      { name: 'Planet',      accent: '#4f80bd', ink: '#b9d4f0', glyph: 'planet' },
  nebula:      { name: 'Nebula',      accent: '#5f9cff', ink: '#c9e0ff', glyph: 'nebula' },
  singularity: { name: 'Singularity', accent: '#dfeeff', ink: '#ffffff', glyph: 'singularity' },
};

/** Currency: stardust. Fractional by nature, so a 10% bet is always clean. */
export const UNIT = '\u2726';

// Physical reel strips: the drum mesh renders these exact stops, so the
// result you see is the result the RNG rolled. Each strip is 12 long and
// deliberately skewed (4 cherries per reel, rarer gems) for a ~52% hit rate.
export const STRIPS = [
  ['asteroid', 'comet', 'crescent', 'asteroid', 'planet', 'comet', 'asteroid', 'nebula', 'planet', 'asteroid', 'crescent', 'singularity'],
  ['comet', 'asteroid', 'planet', 'crescent', 'asteroid', 'singularity', 'comet', 'asteroid', 'nebula', 'planet', 'crescent', 'asteroid'],
  ['asteroid', 'crescent', 'comet', 'planet', 'asteroid', 'nebula', 'singularity', 'comet', 'crescent', 'asteroid', 'planet', 'asteroid'],
];

export const STRIP_LENGTH = STRIPS[0].length;

// Multipliers apply to the bet and pay gross (the bet is already deducted).
// Measured over all 1728 outcomes: 52.1% hit rate, 96.7% RTP.
export const PAYTABLE = {
  three: { asteroid: 3, comet: 8, crescent: 14, planet: 22, nebula: 45, singularity: 106 },
  pair: 1.2,
};

// Symbols that make the third reel crawl and glow when two line up.
export const ANTICIPATION_SYMBOLS = new Set(['crescent', 'planet', 'nebula', 'singularity']);

export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function betFor(balance) {
  if (balance <= 0) return 0;
  return Math.max(MIN_BET, round2(balance * BET_FRACTION));
}

/** Resolve the centre payline. Returns the gross multiplier on the bet. */
export function evaluate(line) {
  const [a, b, c] = line;
  if (a === b && b === c) {
    return { kind: 'three', symbol: a, mult: PAYTABLE.three[a] ?? 0 };
  }
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    if (line[i] === line[j]) {
      return { kind: 'pair', symbol: line[i], mult: PAYTABLE.pair };
    }
  }
  return { kind: 'none', symbol: null, mult: 0 };
}

/** Two reels agree on a premium symbol: worth a slow, glowing third reel. */
export function isAnticipation(line) {
  return line[0] === line[1] && ANTICIPATION_SYMBOLS.has(line[0]) && line[1] !== line[2];
}

export function dust(n, dp = 2) {
  const v = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (v >= 1e9) return `${sign}${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e5) return `${sign}${Math.round(v).toLocaleString('en-US')}`;
  return `${sign}${v.toFixed(dp)}`;
}

export class SlotGame {
  constructor({ balance = START_BALANCE, rng = Math.random, store = null } = {}) {
    this.rng = rng;
    this.store = store;
    const saved = store ? store.load() : null;
    this.balance = saved && Number.isFinite(saved.balance) ? saved.balance : balance;
    this.bestSeen = Math.max(balance, saved?.bestSeen ?? 0);
    this.spins = saved?.spins ?? 0;
    this.last = null;
  }

  get bet() {
    return betFor(this.balance);
  }

  get busted() {
    return this.balance < BUST_LIMIT;
  }

  get ready() {
    return !this.busted;
  }

  pull() {
    if (!this.ready) return null;
    const bet = this.bet;
    const stops = STRIPS.map((strip) => Math.floor(this.rng() * strip.length));
    const line = stops.map((idx, reel) => STRIPS[reel][idx]);
    const outcome = evaluate(line);
    const gross = round2(bet * outcome.mult);
    const balanceAfterBet = round2(this.balance - bet);
    const balanceBefore = this.balance;

    this.balance = round2(balanceAfterBet + gross);
    this.spins += 1;
    this.bestSeen = Math.max(this.bestSeen, this.balance);

    this.last = {
      bet,
      stops,
      line,
      outcome,
      gross,
      net: round2(gross - bet),
      balanceBefore,
      balanceAfterBet,
      balanceAfter: this.balance,
      anticipation: isAnticipation(line),
      busted: this.busted,
    };
    this.persist();
    return this.last;
  }

  /** Force the HUD to re-read state, e.g. after an external balance change. */
  notify() {
    this.persist();
  }

  /** Start a fresh run. The spin tally and peak are per-run, not lifetime. */
  reset(balance = START_BALANCE) {
    this.balance = balance;
    this.bestSeen = balance;
    this.spins = 0;
    this.last = null;
    this.persist();
    return this.balance;
  }

  persist() {
    this.store?.save({ balance: this.balance, spins: this.spins, bestSeen: this.bestSeen });
  }
}

/** Deterministic RNG so tests and screenshots are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const memoryStore = () => {
  let data = null;
  return { load: () => data, save: (d) => { data = { ...d }; } };
};

export const localStore = (key = 'gamble.slot.v2') => ({
  load: () => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  },
  save: (d) => {
    try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* private mode */ }
  },
});
