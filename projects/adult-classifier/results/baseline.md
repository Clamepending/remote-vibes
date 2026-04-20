# baseline

## TAKEAWAY

Vanilla logistic regression on one-hot + scaled numerics gives val AUC = 0.9072 ± 0.00254 (n=5 seeds) — cleanly within prior. Seed-noise std of 0.00254 sets the admission threshold: to beat baseline "beyond noise" a variant must exceed mean AUC 0.9123 (2×std margin).

## STATUS

resolved

## STARTING POINT

[main@1f69f2a](https://github.com/Clamepending/adult-classifier/tree/main)

## BRANCH

[r/baseline](https://github.com/Clamepending/adult-classifier/tree/r/baseline)

## AGENT

0

## Question

What val ROC-AUC does a vanilla logistic regression on Adult achieve with one-hot-encoded categoricals + scaled numerics, and what is the across-seed noise std at n=5 that downstream "beats beyond noise" admission checks will use?

## Hypothesis

**Prior (70% confident):** val_auc mean in [0.895, 0.910], seed std ≤ 0.003. Adult is a well-behaved dataset and logistic regression is close to optimal among linear models.
**Falsifier:** std > 0.005 (noise too high for admission rule to resolve small deltas) OR mean < 0.88 (preprocessing bug).

## Experiment design

Change: logistic regression (lbfgs, max_iter=1000) on the pipeline `[median-impute + standardize numerics] ∥ [constant-impute 'MISSING' + one-hot categoricals]`. No feature engineering, no tuning.
Measure: val ROC-AUC, F1, accuracy across seeds 0..4 (stratified 80/20 split per seed). Report mean ± std.

## Cycles

- `cycle 1 @2d355fc: logreg + onehot + scaled numerics, n=5 seeds -> val_auc=0.9072±0.00254, f1=0.662±0.0082, acc=0.852±0.00269. qual: fits <0.2s per seed; AUC cleanly inside prior band.`

## Results

n=5 at commit [2d355fc](https://github.com/Clamepending/adult-classifier/commit/2d355fc). Per-seed metrics at `outputs/baseline/seed_{0..4}.json`, summary at `outputs/baseline/summary.json`.

| seed | val_auc | val_f1 | val_acc | fit_s |
|------|---------|--------|---------|-------|
| 0 | 0.9060 | 0.6645 | 0.8536 | 0.14 |
| 1 | 0.9072 | 0.6701 | 0.8546 | 0.14 |
| 2 | 0.9093 | 0.6534 | 0.8502 | 0.16 |
| 3 | 0.9036 | 0.6522 | 0.8489 | 0.15 |
| 4 | 0.9099 | 0.6674 | 0.8547 | 0.13 |
| **mean** | **0.9072** | **0.6615** | **0.8524** | — |
| **std (ddof=1)** | **0.00254** | **0.00821** | **0.00269** | — |

- 2×std margin (admission threshold over baseline): **AUC > 0.9123**
- 1×std band: [0.9047, 0.9098]

## Analysis

Hypothesis confirmed. Mean (0.9072) lands inside the prior interval [0.895, 0.910]; std (0.00254) is under the 0.003 prior bound. The noise estimate is small enough that the admission rule can resolve gains of ~0.005 AUC or larger — which is exactly the regime we expect model-family swaps and non-trivial feature engineering to operate in. It may *not* resolve gains smaller than ~0.005, which will likely be the case for hyperparam tuning or calibration-only moves. That's the protocol test.

F1 at 0.662 is in the expected range for an uncalibrated logreg with the default 0.5 threshold on an imbalanced dataset. Not the ranking metric but worth tracking for later calibration moves.

No signs of leakage or preprocessing bugs: std is clean, mean is in the public-benchmark range.

Prior update: baseline characterization confirmed; noise floor locked.

## Reproducibility

Commit: [2d355fc](https://github.com/Clamepending/adult-classifier/commit/2d355fc)
Command: `./run_variant.sh baseline 5`
Artifacts: `outputs/baseline/seed_{0..4}.json`, `outputs/baseline/summary.json` on branch `r/baseline`
Config: sklearn 1.6.1, LogisticRegression(max_iter=1000, solver="lbfgs"), stratified 80/20 split, seeds 0..4

## Leaderboard verdict

Leaderboard was empty at time of run. Baseline defines rank 1 by default.

Decision: insert at rank 1.

## Queue updates

*(no changes — the three remaining queued moves all pivot on this baseline as their noise reference.)*
