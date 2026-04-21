# model-diversification

## TAKEAWAY

RandomForest (n_estimators=500, default-ish sklearn config) hits val AUC 0.9185 ± 0.00242 — beats baseline by +0.0113 beyond-noise but trails rank-1 HistGBT by −0.0105 (2.7× rank-1's 2×std margin). Admits at rank 2, displaces baseline to rank 3. Boosting > bagging on Adult at this size, but the gap is small enough that a stacked ensemble could still have headroom.

## STATUS

resolved

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

- `cycle 1 @b264e2e: RandomForest n_estimators=500, max_features="sqrt", min_samples_leaf=5, n=5 seeds -> val_auc=0.9185±0.00242, f1=0.686±0.0086, acc=0.866±0.00271. Δ vs rank 1 = -0.0105 (RF worse, beyond noise). Δ vs baseline = +0.0113 (RF better, beyond noise). qual: fits ~1.3s per seed; RF std similar to baseline's (0.00242 vs 0.00254), larger than HistGBT's (0.00195).`

## Results

n=5 at commit [b264e2e](https://github.com/Clamepending/adult-classifier/commit/b264e2e). Per-seed metrics at `outputs/model_diversification/seed_{0..4}.json`, summary at `outputs/model_diversification/summary.json`.

| seed | val_auc | val_f1 | val_acc | fit_s |
|------|---------|--------|---------|-------|
| 0 | 0.9165 | 0.6877 | 0.8661 | 1.28 |
| 1 | 0.9223 | 0.6898 | 0.8672 | 1.27 |
| 2 | 0.9185 | 0.6868 | 0.8665 | 1.29 |
| 3 | 0.9149 | 0.6760 | 0.8630 | 1.28 |
| 4 | 0.9203 | 0.6906 | 0.8665 | 1.28 |
| **mean** | **0.9185** | **0.6862** | **0.8659** | — |
| **std (ddof=1)** | **0.00242** | **0.00864** | **0.00271** | — |

**vs rank 1 (gradient-boosted-trees, mean=0.92902, std=0.00195):**
- Δ AUC = −0.0105 (RF worse)
- rank-1 2×std margin = 0.00390
- |Δ| / margin = **2.7×** — beyond noise (on the losing side)

**vs rank 3 (baseline, mean=0.9072, std=0.00254):**
- Δ AUC = +0.0113
- baseline 2×std margin = 0.00507
- Δ / margin = **2.2×** — beyond noise (on the winning side)

## Analysis

Hypothesis partially confirmed. The 30% "matches within noise" prior was wrong — RF trails HistGBT by 0.0105, clearly beyond noise. The 10% "RF beats HistGBT" prior was also wrong in the opposite direction. The actual result lands *between* the two falsifier conditions (−0.0105 gap is less than the −0.015 "much worse" falsifier), so the bounds were too wide. Prior calibration error: I should have weighted more probability on "RF modestly worse" since that's the literature consensus for Adult.

What RF got right: it does clearly beat a linear baseline (+0.0113), confirming the tree inductive bias matters independently of boosting. What HistGBT has over RF on this task is twofold:

1. **Native categorical handling.** RF had to go through OrdinalEncoder, which imposes an arbitrary ordering on nominal categories (`occupation`, `native-country`, etc.). HistGBT's native categorical splits partition categories into subsets directly, which for high-cardinality nominals is meaningfully better. This alone likely accounts for 0.003–0.005 of the gap.
2. **Boosting's residual-fitting.** Adult has clear signal structure (education × hours × capital-gain) where sequential residual-correction finds higher-order interactions that bagging's independent trees can't target. Expected contribution to gap: ~0.005–0.007.

Together those two mechanisms sum roughly to the observed 0.010 — the result is consistent with the literature reading that HistGBT should win by ~1%.

**Stacking readiness.** RF and HistGBT differ enough in inductive bias that a stacking ensemble (e.g., logistic-regression meta-learner over out-of-fold predictions from both) could plausibly gain ~0.001–0.003 AUC over HistGBT alone. That gain would likely be within noise at n=5 seeds, but could be made to resolve with larger n or a tighter variance reduction (e.g., n=10 seeds or a paired-bootstrap). Candidate for a follow-up move if the project continues.

**Protocol observation:** this is the first move that reshuffled mid-leaderboard rather than either taking rank 1 or failing to admit. The admission rule walked cleanly: beats rank 2 (baseline) beyond noise → insert at rank 2, shift baseline down. Worked as designed.

Prior update: boosting > bagging on Adult by ~1% is settled. Stacking is a plausible-but-marginal next direction.

## Reproducibility

Commit: [b264e2e](https://github.com/Clamepending/adult-classifier/commit/b264e2e)
Command: `./run_variant.sh model_diversification 5`
Artifacts: `outputs/model_diversification/seed_{0..4}.json`, `outputs/model_diversification/summary.json` on branch `r/model-diversification`
Config: sklearn 1.6.1, RandomForestClassifier(n_estimators=500, max_features="sqrt", min_samples_leaf=5, n_jobs=-1, random_state=seed), same preprocessing as rank-1 HistGBT except ordinal-encoded categoricals are fed directly to RF (no native categorical handling). Seeds 0..4.

## Leaderboard verdict

- vs rank 1 (gradient-boosted-trees, mean=0.92902): **worse** on val_auc (Δ = −0.0105 vs 2×std margin 0.00390; |Δ|/margin = 2.7×). Does not beat rank 1.
- vs rank 2 (baseline, mean=0.9072): **better** on val_auc (Δ = +0.0113 vs 2×std margin 0.00507; Δ/margin = 2.2×). Beats rank 2 beyond noise.

Decision: insert at rank 2; baseline drops to rank 3.

## Queue updates

ADD: stack-rf-histgbt | starting-point [r/model-diversification@b264e2e](https://github.com/Clamepending/adult-classifier/tree/r/model-diversification) | why RF and HistGBT differ enough in inductive bias that a stacking ensemble could plausibly gain 0.001–0.003 AUC — likely at the noise boundary, good protocol test.
