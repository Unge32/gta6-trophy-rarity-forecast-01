// Build viewer.html: a self-contained, offline demo page for the forecast.
// Reads the practice-case forecast this entry's main.ts wrote (out/p00.out)
// and the case's trophy list (the kit's input/p00.in), and writes viewer.html
// with the data inlined -- no network, no CDN, no external file. The page
// shows the predicted week-one earn rate per trophy (median + 90% band), a
// log-scale bar chart, the method in plain words, and two scenario sliders
// (tracked-player growth, player engagement) that rescale the displayed
// medians exactly the way the model's own structure says they move:
// rate = earners / tracked players, so a growth multiplier g divides the
// rate by g and an engagement multiplier e multiplies it by e, in logit
// space. The sliders are a DEMO of sensitivity only: the graded program
// (main.ts) fits both quantities from the case file and takes no sliders.
//   node tools/build-viewer.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const kitInput = JSON.parse(readFileSync(new URL('../../gta6-trophy-rarity-forecast-01-kit/input/p00.in', import.meta.url), 'utf8'));
const fc = JSON.parse(readFileSync(new URL('../out/p00.out', import.meta.url), 'utf8'));
const last = kitInput.history[kitInput.history.length - 1].rates;
const rows = kitInput.trophies.map((t, i) => ({
  id: t.id,
  name: t.name,
  tier: t.tier,
  last: last[i],
  q: fc.trophies[i].q,
}));
const data = JSON.stringify(rows);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GTA VI trophy rarity forecast — week one (PREDICTIONS, not measurements)</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0 auto; max-width: 960px; padding: 24px 16px; color: #1a1a1a; background: #fff; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin-bottom: 0.2rem; }
  .warn { background: #fff3cd; border: 1px solid #e0a800; padding: 10px 12px; border-radius: 6px; margin: 12px 0; }
  .controls { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0; }
  .controls label { display: block; font-size: 0.9rem; }
  .controls input { width: 220px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border-bottom: 1px solid #ddd; padding: 5px 8px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  th:nth-child(2), td:nth-child(2) { text-align: left; }
  .bar { height: 10px; background: #2f6fed; display: inline-block; vertical-align: middle; }
  svg text { font-size: 11px; fill: #333; }
  footer { margin-top: 24px; font-size: 0.85rem; color: #555; }
  code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body>
<h1>GTA VI trophy rarity forecast — week one</h1>
<p>Predicted share of Exophase-tracked PS5 players who will hold each trophy at <b>2026-11-26T00:00:00Z</b> (one week after launch), from the house's recording of Exophase's trophy page up to the practice checkpoint 2026-11-19T03:00:00Z.</p>
<div class="warn"><b>These are PREDICTIONS, not measurements.</b> Nobody knows the week-one rates yet — the recorder reads them on 26 November. Each row shows the forecast median and the 90% band (5%–95% quantiles): the band is how unsure the model is, not an error bar on a measured number.</div>

<div class="controls">
  <div><label>Tracked-player growth × <b id="gv">1.00</b> <span style="color:#555">(more players tracked → rates diluted)</span></label>
  <input type="range" id="growth" min="0.5" max="2" step="0.05" value="1"></div>
  <div><label>Player engagement × <b id="ev">1.00</b> <span style="color:#555">(players earn more → rates lifted)</span></label>
  <input type="range" id="engage" min="0.5" max="2" step="0.05" value="1"></div>
  <div><button id="reset">Reset scenario</button></div>
</div>
<p style="font-size:0.9rem">Scenario demo: the model says rate = earners / tracked players, so the sliders rescale each median in logit space by ln(engagement) − ln(growth). The graded program (<code>main.ts</code>) fits both quantities from the case file — it takes no sliders.</p>

<h2>Highest predicted week-one rates</h2>
<svg id="chart" width="920" height="340" role="img" aria-label="Bar chart of the highest predicted week-one trophy rates"></svg>

<h2>All 55 trophies</h2>
<table>
<thead><tr><th>#</th><th>Trophy</th><th>Tier</th><th>Last rate %</th><th>Predicted median %</th><th>90% band %</th></tr></thead>
<tbody id="tbody"></tbody>
</table>

<h2>Method (short version)</h2>
<ul>
<li>Exophase only refreshes a game's counts every few hours, so the history is first collapsed to its <b>distinct reads</b> — identical consecutive reads carry no information.</li>
<li>Each trophy's rate is earners / tracked players. Both sides are fitted in log space against ln(1 + hours since release): <b>ln(tracked players)</b> once, shared by all trophies, and <b>ln(earners)</b> per trophy, its slope shrunk toward the cross-trophy median by empirical Bayes (a precisely measured slope keeps its own value; a noisy one is pulled to the pack).</li>
<li>The median is earners ÷ tracked players at the target, blended toward persistence and capped at a 3-logit move. The spread is a prediction interval: a random-walk floor, the fits' prediction errors, and half the trophy's refresh-to-refresh jump volatility.</li>
<li>A <b>flat history</b> (no refresh seen yet — the practice cases) shifts the median down 1.5 logits: the next refresh adds many newly tracked players who have earned little yet, so most rates fall. The house's own recorder notes record the first refresh taking tracked players from 638 to 3,868.</li>
<li>Full write-up: <code>METHODOLOGY.md</code>. Local verification: <code>node tools/score.mjs</code> (pinball loss) and <code>node tools/synthetic-final.mjs</code> (synthetic final case).</li>
</ul>
<footer>Data: Exophase's Grand Theft Auto VI PS5 trophy page, as recorded by the house (practice case p00). Forecast by <code>main.ts</code> in this repository. Entry for make.fun's “Forecast how many GTA VI players earn each trophy in week one” bounty. No live data: this page works offline.</footer>

<script>
const DATA = ${data};
const clamp = (x) => Math.min(99.99, Math.max(0.01, x));
const logit = (p) => { const q = clamp(p) / 100; return Math.log(q / (1 - q)); };
const invLogit = (l) => 100 / (1 + Math.exp(-l));
const fmt = (x) => x >= 10 ? x.toFixed(2) : x >= 1 ? x.toFixed(2) : x.toFixed(2);
// spread recovered from the stored 5%/95% quantiles
const spreadOf = (q) => (logit(q[4]) - logit(q[0])) / (2 * 1.645);
function render() {
  const g = parseFloat(document.getElementById('growth').value);
  const e = parseFloat(document.getElementById('engage').value);
  document.getElementById('gv').textContent = g.toFixed(2);
  document.getElementById('ev').textContent = e.toFixed(2);
  const shift = Math.log(e) - Math.log(g);
  const tb = document.getElementById('tbody');
  tb.innerHTML = '';
  const view = DATA.map((r) => {
    const s = spreadOf(r.q);
    const med = clamp(invLogit(logit(r.q[2]) + shift));
    const lo = clamp(invLogit(logit(r.q[2]) + shift - 1.645 * s));
    const hi = clamp(invLogit(logit(r.q[2]) + shift + 1.645 * s));
    return { ...r, med, lo, hi };
  });
  for (const r of view) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.id + '</td><td>' + r.name.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</td><td>' + r.tier + '</td><td>' + r.last.toFixed(2) + '</td><td><b>' + fmt(r.med) + '</b></td><td>' + fmt(r.lo) + ' – ' + fmt(r.hi) + '</td>';
    tb.appendChild(tr);
  }
  // Chart: top 12 by predicted median, log scale.
  const top = [...view].sort((a, b) => b.med - a.med).slice(0, 12);
  const svg = document.getElementById('chart');
  const W = 920, rowH = 26, maxLog = Math.log10(100);
  let s = '';
  top.forEach((r, i) => {
    const y = 8 + i * rowH;
    const w = Math.max(2, (Math.log10(Math.max(0.01, r.med)) + 2) / (maxLog + 2) * 560);
    s += '<text x="0" y="' + (y + 11) + '">' + r.id + '. ' + r.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 34) + '</text>';
    s += '<rect x="330" y="' + y + '" width="' + w.toFixed(1) + '" height="14" fill="#2f6fed"></rect>';
    s += '<text x="' + (340 + w) + '" y="' + (y + 11) + '">' + fmt(r.med) + '%</text>';
  });
  svg.innerHTML = s;
  svg.setAttribute('height', String(8 + top.length * rowH + 8));
}
document.getElementById('growth').addEventListener('input', render);
document.getElementById('engage').addEventListener('input', render);
document.getElementById('reset').addEventListener('click', () => {
  document.getElementById('growth').value = '1';
  document.getElementById('engage').value = '1';
  render();
});
render();
</script>
</body>
</html>
`;
writeFileSync(new URL('../viewer.html', import.meta.url), html);
console.log(`viewer.html written (${html.length} bytes, ${rows.length} trophies)`);
