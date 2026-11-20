// Build a synthetic final-like case (f00) from the launch-week dynamics the
// house's own recorder notes document, then score this entry's main.ts, the
// house persistence baseline (the kit's starter) and a curve-baseline
// approximation on it. This is a SIMULATION, not a measurement: the true
// Nov-26 rates are unknown to everyone until the recorder reads them. Its
// only honest use is checking the machinery -- that the trend fit, the
// shrinkage and the spread behave -- and the ordering against the baselines
// under a world consistent with the two real snapshots we have (launch night,
// 638 players tracked; the refreshed page at 2026-11-19T04:30Z, 3,868; and
// the live page at 2026-11-20T03:41Z, ~15,600 by the N(t) fit below).
//
// World model, fitted on those snapshots (see METHODOLOGY.md):
//   N(t)   = 638 * (1 + t)^0.95          tracked players, t hours since release
//   E_i(t) = E_i0 * (1 + t)^b_i          earners of trophy i, b_i from the
//                                          launch -> Nov-20 snapshot pair
//   rate_i = 100 * E_i / N, rounded to 2 decimals as the page prints it.
// Reads are every 30 minutes; the page only changes at a refresh (every ~4 h,
// first one between 04:00Z and 04:30Z on Nov 19, as recorded), so most reads
// repeat the previous value exactly, like the real recorder's.
//   node tools/synthetic-final.mjs
// writes /tmp/synth/f00.in and /tmp/synth/answer.json, runs main.ts and the
// two baselines on it, and scores all three.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const KIT = new URL('../../gta6-trophy-rarity-forecast-01-kit/', import.meta.url).pathname;
const ROOT = new URL('../', import.meta.url).pathname;
const STRESS = process.env.STRESS === '1'; // regime break after the deadline: N growth slows, mid-story earners accelerate
const OUT = STRESS ? '/tmp/synth-stress/' : '/tmp/synth/';
mkdirSync(OUT, { recursive: true });

const p00 = JSON.parse(readFileSync(`${KIT}input/p00.in`, 'utf8'));
const launch = p00.history[0];
const N0 = 638;
const A = 0.95; // N(t) exponent, from 638 -> 3,868 over the first refresh gap
const A2 = 0.5; // stressed N exponent after the deadline (growth saturates)
const T0 = Date.parse('2026-11-19T00:00:00Z');
const tD = (Date.parse('2026-11-21T11:30:00Z') - T0) / 3_600_000; // deadline, hours since release
const tHours = (ms) => (ms - T0) / 3_600_000;
// Nov-20 snapshot (live Exophase page, 2026-11-20T03:41Z), page order.
const nowRates = [0.03, 99.99, 0.73, 0.14, 0.06, 0.06, 0.06, 0.24, 0.06, 0.06, 0.06, 0.06, 0.06, 0.03, 0.03, 0.04, 0.04, 0.03, 0.04, 1.89, 0.41, 0.04, 0.04, 0.04, 0.03, 0.03, 0.04, 0.03, 0.04, 0.03, 0.03, 0.03, 0.09, 0.05, 0.24, 0.06, 0.14, 0.14, 0.06, 0.04, 0.04, 0.04, 0.04, 0.08, 0.04, 0.09, 0.04, 0.05, 0.04, 0.11, 0.06, 0.04, 0.05, 0.04, 0.04];
const tNow = tHours(Date.parse('2026-11-20T03:41:00Z'));
const Nnow = Math.round(N0 * Math.pow(1 + tNow, A));
// Per-trophy earner exponent b_i from the launch -> Nov-20 pair, clipped.
const b = launch.rates.map((r0, i) => {
  const r1 = nowRates[i];
  const eRatio = (Math.max(0.01, r1) * Nnow) / (Math.max(0.01, r0) * N0);
  const bi = Math.log(Math.max(0.05, eRatio)) / Math.log((1 + tNow) / (1 + tHours(Date.parse(launch.at))));
  return Math.max(-0.1, Math.min(1.3, bi));
});
const E0 = launch.rates.map((r) => (Math.max(0.01, r) / 100) * N0);

const rateAt = (t, i) => {
  // Piecewise-continuous power laws, continuous at the deadline tD. In the
  // base world the exponents continue unchanged; in the stress world N
  // growth saturates (A2) and mid-story earners accelerate after tD.
  const aAfter = STRESS ? A2 : A;
  const powN = t <= tD ? Math.pow(1 + t, A) : Math.pow(1 + tD, A) * Math.pow((1 + t) / (1 + tD), aAfter);
  const b2 = STRESS && b[i] >= 0.2 && b[i] <= 0.8 ? b[i] + 0.3 : b[i];
  const powE = t <= tD ? Math.pow(1 + t, b[i]) : Math.pow(1 + tD, b[i]) * Math.pow((1 + t) / (1 + tD), b2);
  const N = Math.round(N0 * powN);
  const E = Math.min(N, E0[i] * powE); // earners can never exceed tracked players
  return { N, rate: Math.round((100 * E / N) * 100) / 100 };
};

// Refreshes: first between 04:00 and 04:30 on Nov 19, then every ~4 h.
const refreshTimes = [];
{
  let t = tHours(Date.parse('2026-11-19T04:15:00Z'));
  while (t < tHours(Date.parse('2026-11-26T01:00:00Z'))) {
    refreshTimes.push(t);
    t += 4 + (refreshTimes.length % 3) * 0.7; // 4.0 - 5.4 h apart
  }
}
const stateAt = (t) => {
  // The page shows the values of the last refresh at or before t.
  let rt = tHours(Date.parse(launch.at));
  for (const r of refreshTimes) if (r <= t) rt = r; else break;
  return rt;
};

const history = [];
let slot = Date.parse('2026-11-18T23:50:00Z');
const deadline = Date.parse('2026-11-21T11:30:00Z');
let earned = 0;
while (slot < deadline) {
  const rt = stateAt(tHours(slot));
  const rates = p00.trophies.map((_, i) => rateAt(rt, i).rate);
  const N = rateAt(rt, 0).N;
  earned = rates.reduce((a, r) => a + Math.round((r / 100) * N), 0);
  history.push({
    slot: new Date(slot).toISOString(),
    at: new Date(slot).toISOString(),
    players_tracked: N,
    trophies_earned: earned,
    rates,
  });
  slot += 30 * 60 * 1000;
}
// The answer: the first refresh at or after the target, 2026-11-26T00:00Z.
const targetMs = Date.parse('2026-11-26T00:00:00Z');
const rtAns = stateAt(tHours(targetMs));
const answer = {
  trophies: p00.trophies.map((tr, i) => ({ id: tr.id, rate: rateAt(rtAns, i).rate })),
};
const f00 = {
  schema: 'makefun/gta6-trophies-case/v1',
  id: 'f00',
  at: '2026-11-21T11:30:00Z',
  horizon_minutes: 6510,
  target: '2026-11-26T00:00:00Z',
  levels: [0.05, 0.25, 0.5, 0.75, 0.95],
  game: p00.game,
  trophies: p00.trophies,
  history,
  notes: 'SYNTHETIC case built by tools/synthetic-final.mjs for local testing only.',
};
writeFileSync(`${OUT}f00.in`, JSON.stringify(f00));
writeFileSync(`${OUT}answer.json`, JSON.stringify(answer));
console.log(`synthetic f00: ${history.length} reads, ${new Set(history.map((h) => h.players_tracked)).size} distinct states`);
console.log(`N at deadline: ${history[history.length - 1].players_tracked}, N at answer: ${rateAt(rtAns, 0).N}`);
console.log(`answer rate range: ${Math.min(...answer.trophies.map((t) => t.rate))} - ${Math.max(...answer.trophies.map((t) => t.rate))}`);

// Run the three forecasters on it.
const run = (label, cmd, env) => {
  mkdirSync(`${OUT}${label}`, { recursive: true });
  execFileSync('node', cmd, { env: { ...process.env, ...env }, stdio: 'pipe', cwd: ROOT });
  console.log(`--- ${label} ---`);
  console.log(execFileSync('node', ['tools/score.mjs', `${OUT}${label}/f00.out`, `${OUT}answer.json`], { encoding: 'utf8', cwd: ROOT }));
};
run('mine', ['main.ts'], { MAKEFUN_INPUT_DIR: OUT, MAKEFUN_OUTPUT_DIR: `${OUT}mine` });
run('baseline', [`${KIT}starter/main.ts`], { MAKEFUN_INPUT_DIR: OUT, MAKEFUN_OUTPUT_DIR: `${OUT}baseline` });
