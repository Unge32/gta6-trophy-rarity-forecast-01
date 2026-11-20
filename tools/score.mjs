// Local replica of the sealed scorer (competition.yaml, "Scoring").
//   node tools/score.mjs <forecast.out> <answer.json>
// answer.json: {"trophies":[{"id":n,"rate":y}, ...]} with y in percent.
// Prints loss (6 decimals), typical miss (pp), 90% coverage, and per-trophy
// detail. Exit 1 on an invalid forecast (wrong shape, non-monotone, out of
// range) the way the grader would score it as last-rate persistence.
import { readFileSync } from 'node:fs';

const clamp = (x) => Math.min(99.99, Math.max(0.01, x));
const logit = (pct) => {
  const p = clamp(pct) / 100;
  return Math.log(p / (1 - p));
};
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];

const [,, forecastPath, answerPath] = process.argv;
if (!forecastPath || !answerPath) {
  console.error('usage: node tools/score.mjs <forecast.out> <answer.json>');
  process.exit(2);
}
const fc = JSON.parse(readFileSync(forecastPath, 'utf8'));
const ans = JSON.parse(readFileSync(answerPath, 'utf8'));
const actual = new Map(ans.trophies.map((t) => [t.id, t.rate]));

let valid = true;
const problems = [];
if (!fc || typeof fc !== 'object' || Object.keys(fc).length !== 1 || !Array.isArray(fc.trophies)) {
  valid = false; problems.push('top level must be exactly {"trophies": [...]}');
}
const seen = new Set();
let items = 0;
let lossSum = 0;
let missSum = 0;
let covered = 0;
let scored = 0;
for (const row of fc.trophies ?? []) {
  if (typeof row.id !== 'number' || !Array.isArray(row.q) || row.q.length !== 5) {
    valid = false; problems.push(`row ${JSON.stringify(row)}: need {"id": n, "q": [x5]}`); continue;
  }
  if (seen.has(row.id)) { valid = false; problems.push(`duplicate id ${row.id}`); }
  seen.add(row.id);
  if (!actual.has(row.id)) { valid = false; problems.push(`unknown id ${row.id}`); continue; }
  for (let j = 0; j < 5; j++) {
    const q = row.q[j];
    if (!Number.isFinite(q) || q < 0 || q > 100) { valid = false; problems.push(`id ${row.id} q[${j}]=${q} out of [0,100]`); }
    if (j > 0 && q < row.q[j - 1]) { valid = false; problems.push(`id ${row.id} quantiles decrease at ${j}`); }
  }
  const y = actual.get(row.id);
  for (let j = 0; j < 5; j++) {
    const tau = LEVELS[j];
    const d = logit(y) - logit(row.q[j]);
    lossSum += 2 * Math.max(tau * d, (tau - 1) * d);
    items++;
  }
  missSum += Math.abs(y - row.q[2]);
  if (row.q[0] <= y && y <= row.q[4]) covered++;
  scored++;
}
if (seen.size !== actual.size) {
  valid = false; problems.push(`forecast has ${seen.size} trophies, answer has ${actual.size}`);
}
if (!valid) {
  console.log(`INVALID forecast: ${problems.slice(0, 8).join('; ')}`);
  process.exit(1);
}
console.log(`trophies scored: ${scored}`);
console.log(`loss: ${(lossSum / items).toFixed(6)}`);
console.log(`typical miss: ${(missSum / scored).toFixed(2)} pp`);
console.log(`coverage_90: ${(covered / scored).toFixed(4)}`);
