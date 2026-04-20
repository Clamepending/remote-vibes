# gbt-hparam-tune

## TAKEAWAY

*(pending)*

## STATUS

active

## STARTING POINT

[r/gradient-boosted-trees@7250242](https://github.com/Clamepending/adult-classifier/tree/r/gradient-boosted-trees)

## BRANCH

[r/gbt-hparam-tune](https://github.com/Clamepending/adult-classifier/tree/r/gbt-hparam-tune)

## AGENT

0

## Question

Does a 12-config RandomizedSearchCV over HistGBT's main hyperparameters (learning_rate, max_leaf_nodes, min_samples_leaf, l2_regularization, max_iter) beat the untuned rank-1 pipeline (AUC 0.9290 ± 0.00195) beyond noise?

## Hypothesis

**Prior (45% confident):** yes, but narrowly — expected Δ ∈ [+0.001, +0.005] mean, probably *within* rank-1's 2×std margin of 0.0039. HistGBT defaults are well-chosen but slightly under-regularised on Adult; the search should find a config with more trees + smaller learning rate.
**Falsifier:** Δ < 0 (tuning search over-fit the inner CV) OR Δ > +0.010 (defaults were much farther from optimum than expected).

## Experiment design

Change: wrap HistGBT in a RandomizedSearchCV with inner 3-fold CV on train, n_iter=12 over param distribution covering learning_rate ∈ {0.03, 0.05, 0.1, 0.2}, max_leaf_nodes ∈ {15, 31, 63, 127}, min_samples_leaf ∈ {10, 20, 50, 100}, l2_regularization ∈ {0.0, 0.1, 1.0}, max_iter ∈ {100, 200, 300}. Same outer val split as rank 1 for each seed.
Measure: val ROC-AUC mean ± std across seeds 0..4; record per-seed best_params_ for qualitative reading.

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
