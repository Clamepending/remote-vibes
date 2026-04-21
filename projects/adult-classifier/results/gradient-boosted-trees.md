# gradient-boosted-trees

## TAKEAWAY

HistGradientBoosting with sklearn defaults and native categorical support hits val AUC 0.9290 ± 0.00195 (n=5), **+0.0218 over baseline** — ~8.6× the baseline noise std. Admits beyond noise with a comfortable margin. Fits ~1s per seed; still cheap.

## STATUS

resolved

## STARTING POINT

[main@1f69f2a](https://github.com/Clamepending/adult-classifier/tree/main)

## BRANCH

[r/gradient-boosted-trees](https://github.com/Clamepending/adult-classifier/tree/r/gradient-boosted-trees)

## AGENT

0

## Question

Does `HistGradientBoostingClassifier` with sklearn defaults and native categorical support beat the logistic-regression baseline (AUC 0.9072 ± 0.00254) beyond noise on val ROC-AUC?

## Hypothesis

**Prior (85% confident):** yes, by a comfortable margin. HistGBT typically hits ~0.92–0.93 AUC on Adult. Expected mean AUC in [0.92, 0.93]; expected std ≤ 0.003.
**Falsifier:** mean < 0.9123 (inside baseline's 2×std band) OR std > 0.005 (noisier than baseline, unusual for a tree ensemble on this size).

## Experiment design

Change: swap linear model for HistGradientBoostingClassifier on the same features. Preprocessing: ordinal-encode categoricals (HistGBT handles them natively via `categorical_features`), median-impute numerics. No tuning, sklearn defaults.
Measure: val ROC-AUC mean ± std across seeds 0..4 (same splits as baseline).

## Cycles

- `cycle 1 @7250242: HistGBT + ordinal-encoded categoricals (native) + median-imputed numerics, n=5 seeds -> val_auc=0.9290±0.00195, f1=0.710±0.0063, acc=0.873±0.00223. qual: fits ~1s per seed; AUC solidly inside prior band and well beyond baseline's admission threshold.`

## Results

n=5 at commit [7250242](https://github.com/Clamepending/adult-classifier/commit/7250242). Per-seed metrics at `outputs/gradient_boosted_trees/seed_{0..4}.json`, summary at `outputs/gradient_boosted_trees/summary.json`.

| seed | val_auc | val_f1 | val_acc | fit_s |
|------|---------|--------|---------|-------|
| 0 | 0.9284 | 0.7151 | 0.8735 | 0.95 |
| 1 | 0.9304 | 0.7143 | 0.8752 | 1.00 |
| 2 | 0.9308 | 0.7039 | 0.8717 | 1.00 |
| 3 | 0.9261 | 0.7060 | 0.8708 | 0.94 |
| 4 | 0.9294 | 0.7117 | 0.8726 | 1.03 |
| **mean** | **0.9290** | **0.7102** | **0.8727** | — |
| **std (ddof=1)** | **0.00195** | **0.00630** | **0.00223** | — |

**vs baseline:**
- Δ AUC = +0.0218 (baseline mean 0.9072 → GBT mean 0.9290)
- baseline 2×std margin = 0.00507
- Δ / margin = **4.3×** — comfortably beyond noise
- GBT's own std (0.00195) is ~23% smaller than baseline's (0.00254) — tree ensemble averages out seed variance

## Analysis

Hypothesis confirmed with strong margin. The jump from linear to tree-ensemble is the "big rock" gain on tabular data and Adult is no exception. HistGBT's native categorical handling likely beats one-hot + linear on the high-cardinality columns (`occupation`, `native-country`, `education`) where one-hot is sparse and regularisation costs linear models disproportionately.

F1 jumped more dramatically than AUC (0.662 → 0.710, +0.048) — the tree ensemble produces sharper probability estimates near the 0.5 threshold, not just better ranking. Accuracy also up (0.852 → 0.873). AUC is the ranking metric but the uniform improvement across all three metrics rules out "just got lucky on one metric."

Protocol observation: this is the kind of admission the quantitative rule was designed for — wide margin, small noise, unambiguous win. The more interesting admission tests are still to come (feature-engineering and gbt-hparam-tune are expected to live near the noise boundary).

Prior update: Adult has meaningful tree-linear gap, as expected. Rank 1 is now a non-trivial target.

## Reproducibility

Commit: [7250242](https://github.com/Clamepending/adult-classifier/commit/7250242)
Command: `./run_variant.sh gradient_boosted_trees 5`
Artifacts: `outputs/gradient_boosted_trees/seed_{0..4}.json`, `outputs/gradient_boosted_trees/summary.json` on branch `r/gradient-boosted-trees`
Config: sklearn 1.6.1, HistGradientBoostingClassifier defaults, categorical_features=indices of 8 categorical cols, seeds 0..4

## Leaderboard verdict

- vs rank 1 (baseline): **better** on val_auc (0.9290 vs 0.9072; Δ = +0.0218; baseline 2×std margin = 0.00507; Δ / margin = 4.3× → beyond noise).

Decision: insert at rank 1; baseline drops to rank 2.

## Queue updates

*(no adds; the two remaining queued moves now pivot on this pipeline as rank 1.)*
