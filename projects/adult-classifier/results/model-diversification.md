# model-diversification

## TAKEAWAY

*(pending)*

## STATUS

active

## STARTING POINT

[r/gradient-boosted-trees@7250242](https://github.com/Clamepending/adult-classifier/tree/r/gradient-boosted-trees)

## BRANCH

[r/model-diversification](https://github.com/Clamepending/adult-classifier/tree/r/model-diversification)

## AGENT

0

## Question

Does a RandomForestClassifier (bagged trees, bootstrap + feature sub-sampling, no boosting) reach or beat the HistGBT rank-1 pipeline on val AUC? Gains of different origin (bagging vs boosting) would imply stacking headroom.

## Hypothesis

**Prior (30% confident):** RandomForest matches HistGBT within noise on Adult. Adult is a tabular dataset with mostly-independent features and moderate sample size; both methods should land in a similar neighborhood. **Weaker prior (10% confident):** RF beats HistGBT beyond noise. Boosting usually wins on tabular at this size, so an RF win would be a genuine surprise.
**Falsifier:** RF beats HistGBT beyond noise (Δ > +0.004) — would reopen the tuning question and motivate stacking as a plausible next move. OR RF trails HistGBT by > 0.015 — would say bagging is genuinely worse here and not worth considering as an ensemble component.

## Experiment design

Change: swap HistGradientBoostingClassifier for RandomForestClassifier(n_estimators=500, max_features="sqrt", min_samples_leaf=5). Preprocessing unchanged except RF does not have native categorical handling — use the same ordinal-encoded categoricals as rank 1. n_jobs=-1 for parallel tree training.
Measure: val ROC-AUC mean ± std across seeds 0..4.

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
