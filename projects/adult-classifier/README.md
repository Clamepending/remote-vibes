# adult-classifier

## GOAL

Find the best pipeline for the UCI Adult income binary-classification task on val ROC-AUC with `claude-sonnet-4-6`-equivalent sklearn tooling. Secondary goal: pressure-test the v2 research-agent protocol on a *quantitative* project — does the "beats beyond noise" admission clause fire cleanly, does the QUEUE cap at 5 bind on a hillclimb that naturally wants 8–12 moves, does the cycle-per-commit cadence feel right at 10-second train times?

## CODE REPO

https://github.com/Clamepending/adult-classifier

## SUCCESS CRITERIA

- A pipeline that beats the logistic-regression baseline by ≥ 2× the baseline's seed-noise std on val ROC-AUC.
- At least one orthogonality / ablation move so we know which components are load-bearing (analog of V5 ban-ablation in horror).
- At least one leaderboard admission decision that hinges on the "beats beyond noise" clause (either admits at the boundary or is explicitly rejected as within-noise).
- No data leakage — `fnlwgt` and the train/val split must be handled identically across variants.

## RANKING CRITERION

`quantitative: val_auc (higher is better)`

Noise estimate comes from n=5 seeds per variant; "beats beyond noise" = `variant_mean - rank_k_mean > 2 * rank_k_std` (conservative, roughly 95% one-sided at n=5).

## LEADERBOARD

| rank | result | branch | commit | score / verdict |
|------|--------|--------|--------|-----------------|
| 1 | [gradient-boosted-trees](results/gradient-boosted-trees.md) | [r/gradient-boosted-trees](https://github.com/Clamepending/adult-classifier/tree/r/gradient-boosted-trees) | [7250242](https://github.com/Clamepending/adult-classifier/commit/7250242) | val_auc = 0.9290 ± 0.00195 (n=5); +0.0218 over baseline (4.3× margin); admission threshold for challengers: AUC > 0.9329 |
| 2 | [baseline](results/baseline.md) | [r/baseline](https://github.com/Clamepending/adult-classifier/tree/r/baseline) | [2d355fc](https://github.com/Clamepending/adult-classifier/commit/2d355fc) | val_auc = 0.9072 ± 0.00254 (n=5); noise floor |

## INSIGHTS

*(none yet — quantitative project, no cross-move insights crystallized.)*

## ACTIVE

| move | result doc | branch | agent | started |
|------|-----------|--------|-------|---------|
| feature-engineering | [feature-engineering.md](results/feature-engineering.md) | [r/feature-engineering](https://github.com/Clamepending/adult-classifier/tree/r/feature-engineering) | 0 | 2026-04-20 |

## QUEUE

| move | starting-point | why |
|------|----------------|-----|
| gbt-hparam-tune | *(rank 1 at time of move)* | Small random search over GBT hyperparameters. Incremental; may be within noise. |

## LOG

| date | event | slug or ref | one-line summary | link |
|------|-------|-------------|-------------------|------|
| 2026-04-20 | resolved | gradient-boosted-trees | HistGBT + native cats: val_auc=0.9290±0.00195 (+0.0218, 4.3× margin); admits rank 1 beyond noise | [gradient-boosted-trees.md](results/gradient-boosted-trees.md) |
| 2026-04-20 | resolved | baseline | logreg + onehot + scaled numerics: val_auc=0.9072±0.00254 (n=5); noise floor set, admission threshold 0.9123 | [baseline.md](results/baseline.md) |
| 2026-04-20 | review | seed | project seeded as quantitative protocol pressure-test (Adult binary classification, val_auc ranking, 4 moves queued) | [README](./README.md) |
