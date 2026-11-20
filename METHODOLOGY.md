# GTA VI trophy rarity forecast — method

Entry for make.fun's **“Forecast how many GTA VI players earn each trophy in
week one”** (`gta6-trophy-rarity-forecast-01`). The graded program is
`main.ts`: it reads one case file (`/input/<id>.in`) and writes one forecast
(`/output/<id>.out`) — five quantiles (5%, 25%, 50%, 75%, 95%) of each
trophy's Exophase earn rate at the case's target. Everything below is about
that program. **Every number it writes is a prediction, not a measurement:**
nobody knows the week-one rates until the house's recorder reads them at
2026-11-26T00:00:00Z.

## 1. What is being forecast, and how it is scored

- The rate is the percent of the players Exophase tracks for Grand Theft Auto
  VI on PlayStation 5 who have earned a trophy, as printed on
  https://www.exophase.com/game/grand-theft-auto-vi-psn/trophies/ (2 decimals).
- The final case (f00) is cut at the deadline 2026-11-21T11:30:00Z with every
  read the house made before it; its target is 2026-11-26T00:00:00Z.
- Score: mean pinball loss on the logit scale over every trophy and level,
  rates clamped to [0.01, 99.99] before the logit. A forecast whose five
  quantiles are equal scores exactly its mean absolute logit error. Lower is
  better; a prize needs a loss strictly below the best house entry (the
  persistence baseline, the curve baseline, the house model forecast).
- The house persistence baseline scores **1.51** on the practice cases
  (typical miss 0.68 pp, 90% coverage 0).

## 2. Data sources

| Source | What it gave this entry |
|---|---|
| The kit's practice cases (`input/p00.in`, `p01.in`) | 55 trophies, launch-night reads (7–8 reads, all identical: 638 players tracked, rates unchanged from 2026-11-18T23:50Z through 2026-11-19T04:00Z) |
| The kit's `competition.yaml` / `RULES.txt` (the house's recorder notes) | The first refresh: between 04:00Z and 04:30Z on 19 Nov the page refreshed to **3,868 players tracked, 4,276 trophies earned**, every rate but the 100% one lower; the refresh cadence (every 30 min early, every 10 min later); the scorer's exact formula |
| Exophase's live trophy page, read 2026-11-20 ~03:41 UTC | All 55 rates ~28 h after release (e.g. platinum 0.63% → 0.03%, Chapter 1 1.25% → 0.73%, “Beat Cal in a fishing challenge” 0.78% → 1.89%). Used only to calibrate the model family and the simulator — the program itself never sees it |
| GTA V / Red Dead Redemption 2 on Exophase (background) | The shape of trophy curves in Rockstar open worlds: early/easy trophies are earned by most new players within hours; story trophies climb over days as the launch cohort progresses; grind/collection trophies barely move in week one. This is why the model fits earners and tracked players separately instead of fitting the rate directly |

No other data is used. The program runs offline on the case file alone.

## 3. The model

### 3.1 Distinct reads

Exophase refreshes a game's counts on its own schedule, hours apart, not
continuously: between refreshes the page is byte-identical. The history is
first collapsed to its **distinct reads** — a read whose players-tracked
count and rates match the previous kept read carries no new information and
must not count as a second observation. The practice histories collapse to a
single distinct read; a final history of ~120 reads collapses to ~13.

### 3.2 Earners over tracked players, in log space

A rate is a ratio, and its two sides move for different reasons: the tracked
base grows as new players sync profiles (diluting every rate), while each
trophy's earners grow as players reach it (lifting that trophy). So the
forecast is built from the two sides separately:

- `ln N(t)` — tracked players, **one fit shared by all trophies** (it is
  observed directly in every read, so it is the best-estimated series in the
  case);
- `ln E_i(t)` — trophy *i*'s earners (`rate × N`, a zero rate counting as
  half an earner), one fit per trophy.

Each is a straight line on `x = ln(1 + hours since release, 2026-11-19T00:00Z)`,
fitted by weighted least squares with a 24-hour recency half-life. Both sides
grow roughly like powers of `(1 + t)` in a launch week, so their log ratio is
roughly linear in `ln(1 + t)`. The forecast median is `Ê / N̂` at the target.

Fitting in logs also avoids the trap a logit fit falls into at the top end:
a trophy at exactly 100% has no finite logit, so clamping it to 99.99
invents a −7 logit “fall” to 83% that no trend should extrapolate, while its
earner count is a smooth, ordinary series. (This exact bug was found and
fixed during testing: the first logit-based version forecast the near-100%
trophy at 58% where the log version forecasts 79.4% against a simulated
actual of 79.6%.)

### 3.3 Shrinkage, blending, caps

- Each trophy's earner slope is shrunk toward the cross-trophy median slope
  by **empirical Bayes**: `w = τ² / (τ² + se²)`, where `se` is the standard
  error of that trophy's own slope and `τ` the cross-trophy spread of slopes
  (floored at 0.15, capped at 0.6). A trophy whose slope is measured
  precisely keeps it; a noisy one is pulled to the pack. With too few points
  for a standard error, the weight falls back to `n / (n + 3)`. The shrunk
  line pivots around the data's centre, not around `x = 0`.
- The median is blended toward persistence by fit quality (×0.75 with fewer
  than 4 distinct reads; ×0.7 more when the fit residual exceeds 1.0 in log
  units) and the move is capped at **3.0 logits** in either direction.
- A trophy never observed in any read falls back to a 1% prior rate.

### 3.4 The spread (prediction interval)

`spread = √(rw² + ratioErr² + (0.5·jump)²)`, floored at 0.5 and capped at
2.2 logits, where:

- `rw = 0.3·√(horizon in days)` — the random-walk floor. The house baseline
  uses 0.5; 0.3 was calibrated on the synthetic final (§5): it beats 0.5 in
  both the base world and the stressed world while keeping 90% coverage at
  1.00 / 0.98.
- `ratioErr` — the two fits' prediction errors (residual × leverage at the
  target) combined, converted from log-rate to logit units by `1 / (1 − p)`
  (≈1 for rare trophies, large near 100%).
- `jump` — the standard deviation of the trophy's refresh-to-refresh jumps,
  measured in `ln(rate)` (not logit, for the same top-end reason as §3.2)
  and converted the same way. Refreshes are the shocks in this data.

Quantiles are `inv_logit(logit(median) + z_τ · spread)` with
`z = (−1.645, −0.674, 0, 0.674, 1.645)`, clamped to [0.01, 99.99], rounded to
4 decimals, forced non-decreasing.

### 3.5 Flat history: expect the refresh

A history with a single distinct read cannot support a trend. The page had
not refreshed for hours before the checkpoint, so a refresh before the target
is likely, and a refresh adds many newly tracked players who have earned
little yet — every rate but the near-certain ones falls. The practice cases
are exactly this shape, and the house's notes say they reward a forecast
that expects a refresh. So a flat history shifts the median down **1.5
logits** (0.1 for a trophy already at 99.5%+, which has nowhere to fall) and
widens the spread to 1.4, growing with the horizon. The 1.5 comes from the
documented first refresh: tracked players 638 → 3,868, a 6× jump, about
−1.8 logits of dilution for a trophy that gained no new earners.

A history whose last change is stale (6+ hours before the checkpoint, horizon
≤ 24 h) gets half that shift and +0.3 spread. A flat history over a long
horizon keeps the −1.5 shift but the spread grows (capped at 2.2): with no
trend, later refreshes are unpredictable in direction.

## 4. What the program does not do

- No network, no model call, no randomness, no clock: the same case always
  writes the same bytes (verified: two runs, byte-identical).
- No data beyond the case file. The Nov-20 live-page snapshot and the
  GTA V / RDR2 background above informed the *design* (which the checks can
  see in this file); they are not read at run time and are not in the program.
- Nothing is presented as a measured fact. The README, the viewer and this
  file all label the outputs as predictions.

## 5. Verification (all local, all reproducible)

| Test | Result |
|---|---|
| Practice cases p00/p01 (`MAKEFUN_INPUT_DIR=…/kit/input node main.ts`) | Valid output: 55 rows, one key, monotone quantiles in [0, 100], 2,802 bytes per file; two runs byte-identical; ~0.5 s a case |
| Synthetic final, base world (`node tools/synthetic-final.mjs`) | **Loss 0.106**, typical miss 0.00 pp, coverage 1.000 — vs house persistence baseline **0.381** on the same case |
| Synthetic final, stressed world (`STRESS=1 …`) — N growth saturates (exponent 0.95 → 0.5) and mid-story earners accelerate (+0.3) after the deadline | **Loss 0.305**, coverage 0.982 — vs baseline **0.418** |
| Random-walk floor sweep (same two worlds) | RW 0.2 / 0.3 / 0.4 / 0.5 → base 0.085 / 0.106 / 0.131 / 0.156; stress 0.303 / 0.305 / 0.312 / 0.322. 0.3 chosen: near-best in both, with more insurance than 0.2 |
| Offline | `main.ts` imports only `node:fs` and `node:path`; `viewer.html` has no external reference (checked: no `src="http`, no `@import`); the repo has no CDN link anywhere |

The simulator (`tools/synthetic-final.mjs`) is honest about its limits: it
is a world built from the two real snapshots we have (launch night and the
Nov-20 page) with power-law growth `N(t) = 638·(1+t)^0.95` and per-trophy
earner exponents fitted from the launch → Nov-20 pair, reads every 30 minutes
with refreshes every ~4 h, rates rounded to 2 decimals like the page. It
shares the model's log-power-law family, so it tests the machinery and the
ordering against the baselines — not the truth. The true Nov-26 rates are
unknown to everyone until the recorder reads them.

## 6. Files

- `main.ts` — the entry. Node 22, stdlib only.
- `viewer.html` — offline demo page: the practice forecast as a table and a
  log-scale chart, with scenario sliders (tracked-player growth, engagement)
  that rescale the displayed medians exactly as the model's `rate = earners /
  tracked players` structure says. Built by `tools/build-viewer.mjs` from
  the forecast `main.ts` wrote.
- `data/practice-p00.in` / `data/practice-p00.out` — the practice case and
  this entry's forecast on it.
- `tools/score.mjs` — a local replica of the sealed scorer (pinball loss on
  the logit scale, per the rules).
- `tools/synthetic-final.mjs` — the synthetic final case + the two baselines,
  for the tests in §5. `STRESS=1` runs the regime-break world.
- `tools/build-viewer.mjs` — builds `viewer.html` from the practice forecast.
