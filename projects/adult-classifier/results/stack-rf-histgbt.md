# stack-rf-histgbt

## TAKEAWAY

*(filled last.)*

## STATUS

active

## STARTING POINT

[r/model-diversification@b264e2e](https://github.com/Clamepending/adult-classifier/tree/r/model-diversification)

## BRANCH

[r/stack-rf-histgbt](https://github.com/Clamepending/adult-classifier/tree/r/stack-rf-histgbt)

## AGENT

0

## Question

Does a stacking ensemble (RandomForest + HistGBT base learners, LogisticRegression meta-learner over 5-fold out-of-fold predict_proba) beat rank-1 HistGBT on val AUC beyond noise? If not, does it at least beat rank-2 RF?

## Hypothesis

**Prior (35% confident):** stacking yields Δ ∈ [+0.001, +0.003] vs rank 1 on mean AUC — at or just below the 2×std noise margin (0.00390). The two base learners have genuinely different inductive biases (bagging-with-column-sampling vs sequential-boosting), so some complementary signal should exist. But Adult's signal is mostly additive and HistGBT already captures it well; the meta-learner has little room to combine beyond what HistGBT does alone.
**Weaker prior (15% confident):** stacking beats rank 1 beyond noise (Δ > +0.004). Would imply RF is carrying a meaningful slice of signal HistGBT misses — surprising given the −0.0105 RF gap.
**Weaker prior (10% confident):** stacking trails rank 1 beyond noise (Δ < −0.004) due to RF diluting HistGBT's predictions at the meta-layer. LogisticRegression meta on probabilities should weight RF down automatically, so this would be a surprise.
**Falsifier for "stacking helps":** Δ vs rank 1 < +0.001 on mean AUC (within-noise, meta can't leverage the diversification). Would settle that the RF/HistGBT axis is orthogonal-but-not-complementary for this task.

## Experiment design

Change: `variants/stack_rf_histgbt.py` wraps sklearn's `StackingClassifier(cv=5, stack_method="predict_proba")` with HistGBT + RF base learners and LogisticRegression(max_iter=1000) meta. Base learner configs match rank 1 and rank 2 exactly — HistGBT with native categorical_features, RF with n_estimators=500/max_features="sqrt"/min_samples_leaf=5. Preprocessing shared: ordinal-encoded categoricals + median-imputed numerics.

Measure: val ROC-AUC mean ± std across seeds 0..4. Fit time per seed will be notable (HistGBT + RF + 5 CV folds each ≈ ~10× the single-model time); not a protocol concern, just a log note.

## Cycles

*(filled during run.)*

## Results

*(filled during run.)*

## Analysis

*(filled during run.)*

## Reproducibility

*(filled during run.)*

## Leaderboard verdict

*(filled during run.)*

## Queue updates

*(filled during run.)*
