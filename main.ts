// GTA VI trophy rarity forecaster (make.fun gta6-trophy-rarity-forecast-01).
//
// Reads every case file /input/<id>.in (schema "makefun/gta6-trophies-case/v1":
// the house's recording of Exophase's Grand Theft Auto VI PS5 trophy page up
// to the case's checkpoint) and writes /output/<id>.out: for each of the game's
// trophies, five quantiles (5%, 25%, 50%, 75%, 95%) of its earn rate -- the
// percent of the players Exophase tracks for the game who will have earned it
// -- at the case's target. Node 22, standard library only, no network, fully
// deterministic: the same case always writes the same bytes.
//
// Method (see METHODOLOGY.md for the full write-up, with the numbers behind
// every constant):
//
// Exophase refreshes a game's counts on its own schedule, hours apart, not
// continuously: between refreshes the page is byte-identical. So the history
// is first collapsed to its DISTINCT reads -- a read whose players-tracked
// count and rates match the previous kept read carries no new information
// and must not count as a second observation.
//
// A trophy's earn rate is a ratio -- earners over tracked players -- and the
// two sides move for different reasons: the tracked base grows as new
// players sync their profiles (which dilutes every rate), while each
// trophy's earners grow as players reach it (which lifts that trophy's rate).
// So the forecast is built from the two sides separately, in log space:
//   ln N(t) -- the tracked players, one fit shared by all trophies, and
//   ln E_i(t) -- trophy i's earners, one fit a trophy, its slope shrunk
//   toward the cross-trophy median slope.
// Each is a straight line on x = ln(1 + hours since the game's release,
// 2026-11-19T00:00Z): both sides grow roughly like powers of (1 + t) in a
// launch week, so their log ratio is roughly linear in ln(1 + t). The
// forecast median is E_hat / N_hat at the target, blended toward persistence
// by fit quality and capped at a 3-logit move so one noisy fit can never run
// away. Working in logs also avoids the trap a logit fit falls into at the
// top end: a trophy at exactly 100% has no finite logit, so clamping it to
// 99.99 invents a -7 logit "fall" to 83% that no trend should extrapolate,
// while its earner count is a smooth, ordinary series.
//
// The spread is a prediction interval, not a guess: a random-walk floor
// (0.3 logit per sqrt day -- smaller than the house baseline's 0.5, calibrated
// on the synthetic final), the two fits' prediction errors combined and
// converted to logit units, and half the trophy's refresh-to-refresh jump
// volatility -- refreshes are the shocks in this data, and a forecast that
// ignores them is the baseline's practice score (90% coverage 0). The total
// is floored at 0.5 and capped at 2.2 logits.
//
// One special case: a FLAT history (a single distinct read). The page had not
// refreshed for hours before the checkpoint, so a refresh before the target
// is likely, and a refresh adds many newly tracked players who have earned
// little yet -- every rate but the near-certain ones falls. The practice
// cases are exactly this shape, and the house's own notes say they reward a
// forecast that expects a refresh. So a flat history shifts the median down
// 1.5 logits (0.1 for a trophy already at 99.5%+, which has nowhere to fall)
// and widens the spread to 1.4, growing with the horizon. A history whose
// last change is stale (6+ hours before the checkpoint, short horizon) gets
// half that shift.
//
// Nothing here is presented as a measured fact: every number the program
// writes is a PREDICTION, labelled as such in the README and the viewer, and
// the quantiles are the honest statement of how sure it is.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];

/** Random-walk spread, logit units per square-root day. The house baseline
 * uses 0.5; this entry uses 0.3, calibrated on the synthetic final (see
 * tools/synthetic-final.mjs and METHODOLOGY.md): 0.3 beats 0.5 on both the
 * base world (loss 0.106 vs 0.156) and a stressed world with a regime break
 * after the deadline (0.305 vs 0.322), while keeping 90% coverage at 1.00 /
 * 0.98. The fit residual and refresh jumps carry the rest of the spread. */
const SIGMA_RW = 0.3;
/** Recency half-life for the trend fit, in hours. */
const HALF_LIFE_H = 24;
/** Pseudo-count for shrinking a trophy's slope toward the cross-trophy median.
 * Kept as a floor for trophies with too few points to estimate their own
 * slope precision; the main shrinkage is empirical-Bayes (see forecastCase). */
const SHRINK_K = 3;
/** Widest median move the trend is ever allowed, in logits. */
const MAX_MOVE = 3.0;
/** Median shift for a flat (never refreshed) history, in logits. The house's
 * own recorder notes say the first refresh took the tracked players from 638
 * to 3,868 -- a 6x jump, about -1.8 logits of dilution for a trophy that
 * gained no new earners -- so the expected next refresh dilutes by well over
 * a logit; -1.5 is the middle of that range. */
const FLAT_SHIFT = -1.5;
/** Median shift for a trophy already at 99.5%+ under a flat history. */
const FLAT_SHIFT_TOP = -0.1;
/** Spread for a flat history, in logits, widened by the horizon: over a long
 * horizon a flat history says almost nothing about where rates will land. */
const FLAT_SPREAD = 1.4;
/** Spread floor and cap, in logits. */
const SPREAD_MIN = 0.5;
const SPREAD_MAX = 2.2;
/** A history is "stale" when its last change is this many hours before `at`. */
const STALE_HOURS = 6;
/** Fallback median rate (percent) when a trophy was never observed. */
const PRIOR_RATE = 1.0;

interface Trophy {
  id: number;
  name: string;
  tier: string;
}

interface Read {
  at: string;
  players_tracked: number;
  rates: Array<number | null>;
}

interface Case {
  id: string;
  at: string;
  target: string;
  horizon_minutes: number;
  levels: number[];
  game: { name: string; release_date: string };
  trophies: Trophy[];
  history: Read[];
}

const clampRate = (x: number): number => Math.min(99.99, Math.max(0.01, x));
const logit = (pct: number): number => {
  const p = clampRate(pct) / 100;
  return Math.log(p / (1 - p));
};
const invLogit = (l: number): number => 100 / (1 + Math.exp(-l));
/** x rounded to 4 decimals. */
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const std = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
};

/** Hours from the release midnight (2026-11-19T00:00Z) to an ISO timestamp. */
function hoursSinceRelease(iso: string, releaseMs: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(-0.9, (t - releaseMs) / 3_600_000);
}
/** The trend coordinate: ln(1 + hours since release). */
const xOf = (hours: number): number => Math.log(1 + hours);

/** Weighted least squares of y on x. Returns slope, intercept, residual std. */
function wls(
  xs: number[],
  ys: number[],
  ws: number[],
): { slope: number; intercept: number; residStd: number; sxx: number; xBar: number } {
  const n = xs.length;
  const sw = ws.reduce((a, b) => a + b, 0);
  const xBar = xs.reduce((a, x, i) => a + ws[i] * x, 0) / sw;
  const yBar = ys.reduce((a, y, i) => a + ws[i] * y, 0) / sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += ws[i] * (xs[i] - xBar) * (xs[i] - xBar);
    sxy += ws[i] * (xs[i] - xBar) * (ys[i] - yBar);
  }
  const slope = sxx > 1e-12 ? sxy / sxx : 0;
  const intercept = yBar - slope * xBar;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (intercept + slope * xs[i]);
    sse += ws[i] * r * r;
  }
  // Residual std, with a degrees-of-freedom correction once there are enough points.
  const dof = Math.max(1, n - 2);
  const residStd = n >= 3 ? Math.sqrt(sse / (sw * (dof / n))) : Math.sqrt(sse / sw);
  return { slope, intercept, residStd, sxx, xBar };
}

function forecastCase(c: Case): Array<{ id: number; q: number[] }> {
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${c.id} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  if (c.history.length === 0) throw new Error(`${c.id} has no history`);

  const releaseMs = Date.parse(`${c.game.release_date}T00:00:00Z`);
  const release = Number.isNaN(releaseMs) ? Date.parse(c.history[0].at) : releaseMs;
  const atMs = Date.parse(c.at);
  const horizonDays = c.horizon_minutes / 1440;
  const xTarget = xOf(hoursSinceRelease(c.target, release));

  // Collapse the history to its distinct reads: a read identical to the last
  // kept one (same players tracked, same rates) is the same un-refreshed page.
  const distinct: Read[] = [];
  for (const r of c.history) {
    const prev = distinct[distinct.length - 1];
    if (
      prev !== undefined &&
      prev.players_tracked === r.players_tracked &&
      prev.rates.length === r.rates.length &&
      prev.rates.every((v, i) => v === r.rates[i])
    ) {
      continue;
    }
    distinct.push(r);
  }
  const lastRead = distinct[distinct.length - 1];
  const xLast = xOf(hoursSinceRelease(lastRead.at, release));
  const dx = xTarget - xLast;
  const lastChangeHours = Number.isNaN(atMs)
    ? 0
    : (atMs - Date.parse(lastRead.at)) / 3_600_000;
  const stale = distinct.length >= 2 && lastChangeHours >= STALE_HOURS && c.horizon_minutes <= 1440;

  // The shared fit: ln(tracked players) on x, over the distinct reads.
  // players_tracked is observed, so this fit pools the whole history.
  const nPts = distinct.map((r) => ({
    x: xOf(hoursSinceRelease(r.at, release)),
    y: Math.log(Math.max(1, r.players_tracked)),
    w: Math.pow(0.5, Math.max(0, (Date.parse(lastRead.at) - Date.parse(r.at)) / 3_600_000) / HALF_LIFE_H),
  }));
  const nFit = wls(nPts.map((p) => p.x), nPts.map((p) => p.y), nPts.map((p) => p.w));
  const lnNTarget = nFit.intercept + nFit.slope * xTarget;
  const nLev = 1 + 1 / nPts.length + (dx * dx) / Math.max(nFit.sxx, 0.25);
  const seN = nPts.length >= 3 ? Math.min(1.0, nFit.residStd * Math.sqrt(nLev)) : 0.4;

  // Per-trophy fits: ln(earners) on x. A trophy's earners are its rate times
  // the tracked players at that read; a read that lacks the trophy is skipped,
  // and a zero rate counts as half an earner (fewer than one observed).
  interface Fit {
    lastLogit: number;
    lastRate: number;
    n: number;
    slope: number;
    residStd: number;
    seFit: number;
    jumpStd: number;
    lnEAtTarget: number;
    xBar: number;
    seSlope: number;
  }
  const fits: Fit[] = [];
  for (let i = 0; i < c.trophies.length; i++) {
    const pts: Array<{ x: number; y: number; w: number }> = [];
    const lnRates: number[] = [];
    let lastRate: number | null = null;
    for (const r of distinct) {
      const v = r.rates[i];
      if (v === null || v === undefined) continue;
      lastRate = v;
      const earners = Math.max(0.5, (v / 100) * Math.max(1, r.players_tracked));
      const ageH = Math.max(0, (Date.parse(lastRead.at) - Date.parse(r.at)) / 3_600_000);
      pts.push({
        x: xOf(hoursSinceRelease(r.at, release)),
        y: Math.log(earners),
        w: Math.pow(0.5, ageH / HALF_LIFE_H),
      });
      // Refresh jumps are measured in ln(rate): a logit jump is meaningless
      // at the top end, where a rate of exactly 100% has no finite logit and
      // clamping it invents a multi-logit "fall" to the next read.
      lnRates.push(Math.log(Math.max(0.01, v)));
    }
    if (lastRate === null) {
      fits.push({ lastLogit: logit(PRIOR_RATE), lastRate: PRIOR_RATE, n: 0, slope: 0, residStd: 0.6, seFit: 0.6, jumpStd: 0.5, lnEAtTarget: Math.log(0.5), xBar: xLast, seSlope: 0.5 });
      continue;
    }
    const lastLogit = logit(lastRate);
    if (pts.length < 2) {
      fits.push({ lastLogit, lastRate, n: pts.length, slope: 0, residStd: 0.6, seFit: 0.6, jumpStd: 0.5, lnEAtTarget: pts.length === 1 ? pts[0].y : Math.log(0.5), xBar: xLast, seSlope: 0.5 });
      continue;
    }
    const f = wls(pts.map((p) => p.x), pts.map((p) => p.y), pts.map((p) => p.w));
    const jumps: number[] = [];
    for (let j = 1; j < lnRates.length; j++) jumps.push(lnRates[j] - lnRates[j - 1]);
    // Prediction-interval scale at the target: residual, widened by leverage.
    const lev = 1 + 1 / pts.length + (dx * dx) / Math.max(f.sxx, 0.25);
    const seFit = Math.min(1.6, f.residStd * Math.sqrt(lev));
    fits.push({
      lastLogit,
      lastRate,
      n: pts.length,
      slope: f.slope,
      residStd: f.residStd,
      seFit,
      jumpStd: jumps.length >= 2 ? std(jumps) : 0.5,
      lnEAtTarget: f.intercept + f.slope * xTarget,
      xBar: f.xBar,
      // Standard error of the slope: how precisely this trophy's own trend
      // is estimated. Drives the empirical-Bayes shrinkage below.
      seSlope: f.residStd / Math.sqrt(Math.max(f.sxx, 0.05)),
    });
  }
  const fitted = fits.filter((f) => f.n >= 2);
  const slopeBar = fitted.length > 0 ? median(fitted.map((f) => f.slope)) : 0;
  const residBar = fitted.length > 0 ? median(fitted.map((f) => f.residStd)) : 0.6;
  const jumpBar = fitted.length > 0 ? median(fitted.map((f) => f.jumpStd)) : 0.5;
  // Cross-trophy spread of the fitted slopes: the prior scale for the
  // empirical-Bayes shrinkage. A trophy whose own slope is estimated far
  // more precisely than this spread keeps its own slope; a noisy one is
  // pulled to the median.
  const tau = Math.max(0.15, Math.min(0.6, std(fitted.map((f) => f.slope))));

  const rows: Array<{ id: number; q: number[] }> = [];
  for (let i = 0; i < c.trophies.length; i++) {
    const f = fits[i];
    let medLogit: number;
    let spread: number;
    if (f.n < 2) {
      // Flat history: no trend can be fitted. Expect the refresh.
      const shift = f.lastRate >= 99.5 ? FLAT_SHIFT_TOP : FLAT_SHIFT;
      medLogit = f.lastLogit + shift;
      spread = Math.min(SPREAD_MAX, FLAT_SPREAD * Math.sqrt(1 + horizonDays));
    } else {
      // Shrink the earner slope toward the cross-trophy median, by how
      // precisely this trophy's own slope is estimated: w = tau^2 /
      // (tau^2 + se^2). A trophy with a tight fit keeps its slope; a noisy
      // one is pulled to the median. (With too few points for a standard
      // error, fall back to the count-based weight.)
      const w = f.n >= 3
        ? (tau * tau) / (tau * tau + f.seSlope * f.seSlope)
        : f.n / (f.n + SHRINK_K);
      const slope = w * f.slope + (1 - w) * slopeBar;
      // The shrunk line pivots around the data's centre (xBar), not x = 0.
      const lnE = f.lnEAtTarget + (slope - f.slope) * (xTarget - f.xBar);
      const rateHat = clampRate(100 * Math.exp(lnE - lnNTarget));
      let move = logit(rateHat) - f.lastLogit;
      let damp = f.n >= 4 ? 1 : 0.75;
      if (f.residStd > 1.0) damp *= 0.7;
      move *= damp;
      move = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, move));
      medLogit = f.lastLogit + move;
      // Stale last change on a short horizon: half the flat-history shift.
      if (stale) medLogit += 0.5 * FLAT_SHIFT * Math.min(1, lastChangeHours / 12);
      const se = f.n >= 3 ? f.seFit : residBar;
      const jump = f.jumpStd > 0 ? f.jumpStd : jumpBar;
      const rw = SIGMA_RW * Math.sqrt(horizonDays);
      // The log-ratio error, converted to logit units: d logit / d ln p is
      // 1 / (1 - p), about 1 for rare trophies, large near 100%. The jump
      // volatility is measured in ln(rate) and converted the same way.
      const pMed = clampRate(invLogit(medLogit)) / 100;
      const conv = 1 / Math.max(0.05, 1 - pMed);
      const ratioErr = Math.sqrt(se * se + seN * seN) * conv;
      spread = Math.sqrt(rw * rw + ratioErr * ratioErr + (0.5 * jump * conv) * (0.5 * jump * conv));
      if (stale) spread += 0.3;
      spread = Math.max(SPREAD_MIN, Math.min(SPREAD_MAX, spread));
    }
    // Quantiles, clamped to the scorer's range, rounded, non-decreasing.
    const qs: number[] = [];
    let prev = -Infinity;
    for (const z of Z) {
      let q = round4(clampRate(invLogit(medLogit + z * spread)));
      if (q < prev) q = prev;
      qs.push(q);
      prev = q;
    }
    rows.push({ id: c.trophies[i].id, q: qs });
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR)
  .filter((f) => f.endsWith('.in'))
  .sort();
if (inputs.length === 0) throw new Error(`no case files in ${INPUT_DIR}`);
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const trophies = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}
