# feature-engineering

## TAKEAWAY

*(pending)*

## STATUS

active

## STARTING POINT

[r/gradient-boosted-trees@7250242](https://github.com/Clamepending/adult-classifier/tree/r/gradient-boosted-trees)

## BRANCH

[r/feature-engineering](https://github.com/Clamepending/adult-classifier/tree/r/feature-engineering)

## AGENT

0

## Question

Do five hand-crafted derived features (`capital_net`, `has_capital_gains`, `hours_bucket`, `is_married`, `log_fnlwgt`) added on top of the rank-1 HistGBT pipeline move val ROC-AUC beyond noise (> 0.9329)?

## Hypothesis

**Prior (35% confident):** yes, but near the noise boundary. HistGBT can already split on numeric ranges, so derived numerics should be marginal; `is_married` and `capital_net` might add a small signal via simpler decision surfaces. Expected Δ AUC ∈ [−0.002, +0.005].
**Falsifier:** Δ AUC > +0.010 (would be surprising — means HistGBT defaults left obvious signal on the table) OR Δ AUC < −0.005 (would mean the engineered features hurt via redundancy or leakage).

## Experiment design

Change: add five derived features before the existing HistGBT pipeline:
- `capital_net` = capital-gain − capital-loss (numeric)
- `has_capital_gains` = (capital-gain > 0) (binary)
- `hours_bucket` = cut of hours-per-week into {≤20, 21-40, 41-50, >50} (categorical)
- `is_married` = marital-status ∈ {Married-civ-spouse, Married-AF-spouse} (binary)
- `log_fnlwgt` = log1p(fnlwgt) (numeric)

All original features retained. Measure: val ROC-AUC mean ± std across seeds 0..4 (same splits as rank 1). Whether the delta exceeds rank-1's 2×std admission threshold is the pass/fail.

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
