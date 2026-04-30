# adult-classifier — LOG

Append-only event log. Newest first. See [README.md](./README.md) for project state (LEADERBOARD, ACTIVE, QUEUE).

| date | event | slug or ref | one-line summary | link |
|------|-------|-------------|-------------------|------|
| 2026-04-20 | review | terminal | QUEUE empty after 6 resolved moves; all 4 success criteria met; tree-ensemble ceiling on Adult confirmed saturated (4 approaches within-noise of rank 1); recommend termination or pivot to different error source (neural net / calibrated LR with interactions) | [README](./README.md) |
| 2026-04-20 | falsified | stack-rf-histgbt | StackingClassifier(RF+HistGBT, LR meta): val_auc=0.9284±0.00203, Δ vs rank 1 = -0.00063 (within-noise, stacking-helps falsified); but +0.0099 vs rank 2 RF beyond-noise — admits rank 2, RF drops to rank 3, baseline to rank 4 | [stack-rf-histgbt.md](results/stack-rf-histgbt.md) |
| 2026-04-20 | resolved | model-diversification | RandomForest n_estimators=500: val_auc=0.9185±0.00242, -0.0105 vs rank 1, +0.0113 vs baseline — admits rank 2, baseline evicted to rank 3 | [model-diversification.md](results/model-diversification.md) |
| 2026-04-20 | resolved | gbt-fe-ablation | drop-one ablation 5 feats × 5 seeds: 3/5 drops bit-identical (tree ignored them); max |Δ|=0.00012; confirms FE null | [gbt-fe-ablation.md](results/gbt-fe-ablation.md) |
| 2026-04-20 | resolved | gbt-hparam-tune | RandomizedSearchCV n_iter=12: val_auc=0.9293±0.00166, Δ vs rank 1 = +0.00023 — within-noise, does not admit | [gbt-hparam-tune.md](results/gbt-hparam-tune.md) |
| 2026-04-20 | resolved | feature-engineering | 5 hand-crafted features on HistGBT: val_auc=0.9290±0.00171, Δ vs rank 1 = -0.00007 — within-noise, first non-admission | [feature-engineering.md](results/feature-engineering.md) |
| 2026-04-20 | resolved | gradient-boosted-trees | HistGBT + native cats: val_auc=0.9290±0.00195 (+0.0218, 4.3× margin); admits rank 1 beyond noise | [gradient-boosted-trees.md](results/gradient-boosted-trees.md) |
| 2026-04-20 | resolved | baseline | logreg + onehot + scaled numerics: val_auc=0.9072±0.00254 (n=5); noise floor set, admission threshold 0.9123 | [baseline.md](results/baseline.md) |
| 2026-04-20 | review | seed | project seeded as quantitative protocol pressure-test (Adult binary classification, val_auc ranking, 4 moves queued) | [README](./README.md) |
