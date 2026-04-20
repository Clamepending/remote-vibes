# gradient-boosted-trees

## TAKEAWAY

*(pending)*

## STATUS

active

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

*(in progress)*

## Results

*(in progress)*

## Analysis

*(in progress)*

## Reproducibility

*(in progress)*

## Leaderboard verdict

*(in progress)*

## Queue updates

*(in progress)*
