// Verifies the shipped paytable against the shipped strips, then samples sessions.
import { STRIPS, STRIP_LENGTH, evaluate, betFor, mulberry32, money, round2 } from '../src/game.js';

const N = STRIP_LENGTH;
let rtp = 0, hit = 0, total = 0;
const dist = {};
for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) {
  const line = [STRIPS[0][a], STRIPS[1][b], STRIPS[2][c]];
  const o = evaluate(line);
  const key = o.kind === 'none' ? 'loss' : `${o.kind}:${o.symbol}`;
  dist[key] = (dist[key] || 0) + 1;
  rtp += o.mult; if (o.mult > 0) hit++; total++;
}
console.log(`exact RTP ${(100 * rtp / total).toFixed(2)}%  hit rate ${(100 * hit / total).toFixed(1)}%  (${total} outcomes)`);
for (const [k, v] of Object.entries(dist).sort((x, y) => y[1] - x[1])) {
  console.log('  ', k.padEnd(14), (100 * v / total).toFixed(2).padStart(6) + '%');
}

function play(seed, maxSpins) {
  const rng = mulberry32(seed);
  let balance = 100, peak = 100, spins = 0;
  while (balance >= 1 && spins < maxSpins) {
    const bet = betFor(balance);
    const line = [0, 1, 2].map((r) => STRIPS[r][Math.floor(rng() * N) % N]);
    const o = evaluate(line);
    balance = round2(round2(balance - bet) + round2(bet * o.mult));
    peak = Math.max(peak, balance);
    spins++;
  }
  return { balance, peak, spins };
}

for (const cap of [25, 50, 100, 200, 400]) {
  const runs = [];
  for (let s = 1; s <= 2000; s++) runs.push(play(s, cap));
  const alive = runs.filter((r) => r.balance >= 1).length;
  const aliveBals = runs.filter((r) => r.balance >= 1).map((r) => r.balance).sort((a, b) => a - b);
  const peaks = runs.map((r) => r.peak).sort((a, b) => a - b);
  console.log(
    `cap ${String(cap).padStart(3)}: alive ${(100 * alive / runs.length).toFixed(0).padStart(3)}%` +
    `  median surviving ${money(aliveBals[aliveBals.length >> 1] ?? 0, 0).padStart(8)}` +
    `  p50 peak ${money(peaks[1000], 0).padStart(7)}` +
    `  p99 peak ${money(peaks[1980], 0).padStart(8)}`,
  );
}

let seed = 1, bigWin = null;
while (!bigWin && seed < 5000) {
  const r = play(seed++, 60);
  if (r.peak > 400) bigWin = { ...r, seed: seed - 1 };
}
console.log('first session reaching >$400:', JSON.stringify(bigWin));
