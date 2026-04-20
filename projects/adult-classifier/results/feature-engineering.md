# feature-engineering

## TAKEAWAY

Five hand-crafted derived features on top of the HistGBT rank-1 pipeline land at val AUC 0.9290 ± 0.00171 vs rank 1's 0.9290 ± 0.00195 — Δ = −0.00007, effectively zero. **Within noise; does not admit.** The derived features added no signal the default HistGBT wasn't already extracting from the raw columns. First within-noise non-admission in the project — admission-rule works as designed.

## STATUS

resolved

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

- `cycle 1 @ca199d2: HistGBT + 5 derived features, n=5 seeds -> val_auc=0.9290±0.00171, f1=0.710±0.0067, acc=0.873±0.00237. Δ vs rank 1 = -0.00007 (within noise). qual: fits ~0.9s per seed (same as rank 1); derived features visible in the model but not load-bearing.`

## Results

n=5 at commit [ca199d2](https://github.com/Clamepending/adult-classifier/commit/ca199d2). Per-seed metrics at `outputs/feature_engineering/seed_{0..4}.json`, summary at `outputs/feature_engineering/summary.json`.

| seed | val_auc | val_f1 | val_acc | fit_s |
|------|---------|--------|---------|-------|
| 0 | 0.9288 | 0.7082 | 0.8729 | 0.92 |
| 1 | 0.9301 | 0.7135 | 0.8739 | 0.96 |
| 2 | 0.9309 | 0.7127 | 0.8739 | 0.95 |
| 3 | 0.9266 | 0.7034 | 0.8700 | 0.93 |
| 4 | 0.9284 | 0.7121 | 0.8726 | 0.90 |
| **mean** | **0.92895** | **0.7100** | **0.8727** | — |
| **std (ddof=1)** | **0.00171** | **0.00668** | **0.00237** | — |

**vs rank 1 (gradient-boosted-trees, mean=0.92902, std=0.00195):**
- Δ AUC = −0.00007 (FE is 0.00007 *worse* on mean — statistically indistinguishable)
- rank-1 2×std margin = 0.00390
- |Δ| / margin = 0.018 — vanishingly small vs noise
- Admission threshold (Δ > +0.00390) **not met** → do not admit

## Analysis

Hypothesis landed inside the predicted band but at the low end: 35% confident of beyond-noise gain, 65% confident of within-noise or slight loss. Observed within-noise with a zero-mean delta. Falsifier conditions (>+0.010 or <−0.005) both avoided, so no surprise in either direction.

Interpretation: HistGBT's default settings are effective at extracting the signal the derived features would encode. `capital_net` can be reconstructed by a depth-2 split on `capital-gain` and `capital-loss`; `hours_bucket` is a pre-binned version of what trees learn to do automatically; `is_married` is a single-split hypothesis the tree discovers in the first few levels on `marital-status`. The only candidate that *could* have helped, `log_fnlwgt`, is moot because `fnlwgt` (census sample weight) carries near-zero signal for the income target. F1 and accuracy also flat. Fit time unchanged.

This is the genuine information-rich outcome — knowing a set of clean human-intuitive features doesn't help tells us the tree model is already near the information ceiling of these raw features. Future gains will come from either (a) tuning HistGBT (capacity / regularization), (b) a different model family with different inductive biases (say, stacking + logistic calibration), or (c) features that encode signal the raw columns don't contain (geography interactions, occupation × education crosses at higher cardinality — though these also tend to be tree-recoverable).

**Protocol observation:** this is the first within-noise non-admission in the project. The admission rule fired cleanly at the design margin: rank-1 std is 0.00195, 2× margin is 0.00390, observed Δ magnitude is 0.00007 — three orders of magnitude under margin, unambiguous reject. Without the noise estimate this move would've looked like "ties rank 1" — with it, we can say "within noise, no evidence of improvement." The value of the n=5 baseline pays off here.

Prior update: HistGBT defaults are strong enough on Adult's raw features that hand-crafted derived numerics/binaries live at or below the noise floor. Tuning and model-family diversification are the only remaining move types likely to yield real gains.

## Reproducibility

Commit: [ca199d2](https://github.com/Clamepending/adult-classifier/commit/ca199d2)
Command: `./run_variant.sh feature_engineering 5`
Artifacts: `outputs/feature_engineering/seed_{0..4}.json`, `outputs/feature_engineering/summary.json` on branch `r/feature-engineering`
Config: sklearn 1.6.1, HistGradientBoostingClassifier defaults, 19 numeric + 9 categorical features (6 original num + 4 new num + 8 original cat + 1 new cat), seeds 0..4

## Leaderboard verdict

- vs rank 1 (gradient-boosted-trees): **within noise** on val_auc (Δ = −0.00007 vs 2×std margin 0.00390; |Δ|/margin = 0.018). No case to admit above rank 1.
- vs rank 2 (baseline): better on val_auc (0.9290 vs 0.9072; Δ = +0.0218; far beyond noise). Would rank #1 against baseline alone, but does not beat rank 1.

Decision: do not admit. Per admission rule, "first row you beat is your rank" walked top-down — we do not beat rank 1, so we do not insert. Log as resolved with within-noise verdict; branch stays pushed as the record.

## Queue updates

ADD: gbt-fe-ablation | starting-point [r/feature-engineering@ca199d2](https://github.com/Clamepending/adult-classifier/tree/r/feature-engineering) | why confirm the five derived features don't help via one-feature-at-a-time drop test (orthogonality / ablation analog of horror's V5).
ADD: model-diversification | starting-point [r/gradient-boosted-trees@7250242](https://github.com/Clamepending/adult-classifier/tree/r/gradient-boosted-trees) | why try a second tree family (RandomForest or ExtraTrees) to see if gains come from ensembling across different inductive biases rather than within HistGBT.
