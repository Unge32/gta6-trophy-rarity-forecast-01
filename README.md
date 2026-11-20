# gta6-trophy-rarity-forecast-01

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Unge32/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/Unge32/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

Forecast, for every trophy of Grand Theft Auto VI on PlayStation 5, the percent of the players Exophase tracks for the game who will have earned it one week after launch (2026-11-26T00:00:00Z), as five quantiles a trophy — from the house's recording of Exophase's trophy page up to the case's checkpoint.

**These are predictions, not measurements.** Nobody knows the week-one rates yet; the quantiles are the honest statement of how sure the model is. See `METHODOLOGY.md` for the full method, the data sources, and the local verification.

## How it works (short version)

Exophase refreshes a game's counts every few hours, so the history is first collapsed to its *distinct reads*. Then each trophy's rate — earners over tracked players — is forecast from its two sides separately, in log space: one shared fit for `ln(tracked players)`, one fit per trophy for `ln(earners)`, each a straight line on `ln(1 + hours since release)`, the earner slopes shrunk toward the cross-trophy median by empirical Bayes. The median is earners ÷ tracked players at the target; the spread is a prediction interval (random-walk floor + fit errors + refresh-jump volatility). A flat history — no refresh seen yet, as in the practice cases — expects the next refresh to dilute most rates and shifts the median down 1.5 logits.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is Node 22, standard library only, no network, fully deterministic: the same case always writes the same bytes. It reads every `*.in` file in the input directory (`$MAKEFUN_INPUT_DIR`, else `/input`) and writes one `<id>.out` per case to the output directory (`$MAKEFUN_OUTPUT_DIR`, else `/output`). Each output is `{"trophies": [{"id": n, "q": [q05, q25, q50, q75, q95]}, ...]}`, one row per trophy, quantiles in percent, non-decreasing.

## See the forecast

Open `viewer.html` in a browser (no server needed, no network): the practice-case forecast as a table and a log-scale chart, with scenario sliders for tracked-player growth and player engagement. The sliders are a demo of sensitivity only — `main.ts` fits both quantities from the case file.

## Verify it locally

```sh
node tools/score.mjs <forecast.out> <answer.json>   # pinball loss on the logit scale, per the rules
node tools/synthetic-final.mjs                     # synthetic final case: loss 0.106 vs house baseline 0.381
STRESS=1 node tools/synthetic-final.mjs            # regime break after the deadline: loss 0.305 vs baseline 0.418
node tools/build-viewer.mjs                        # rebuild viewer.html from the practice forecast
```

## Files

- `main.ts` — the entry.
- `METHODOLOGY.md` — the full method, data sources, calibration, and limits.
- `viewer.html` — offline demo page for the practice forecast.
- `data/` — the practice case and this entry's forecast on it.
- `tools/` — the local scorer replica, the synthetic-final tester, and the viewer builder.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wrck3kk7&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
