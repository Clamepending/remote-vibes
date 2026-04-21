# adult-classifier — protocol notes

Running notes on what the v2 research-agent protocol does well and where it rubs on this quantitative project. Updated as moves run. Not a result doc — this is meta-observation about the *protocol itself*, to be reviewed after the project terminates.

## Things that worked

- **Step-0 GitHub remote mandate**: caught the same SSH/HTTPS gotcha as haiku, but once switched to HTTPS, push-per-cycle is cheap and the code repo URLs in the wiki actually resolve. Material improvement over the horror retrofit.
- **One branch per move + one commit per cycle**: `git log --all --oneline --graph` on the code repo is a readable history of the project. For move 3 (FE) the commit message alone tells you the outcome ("Δ = -0.00007, within-noise, do not admit").
- **Admission rule on quantitative with noise estimate**: fired cleanly on move 3 FE. Δ = -0.00007 vs 2×std margin 0.00390 → unambiguous reject. Without the noise estimate this would've read as "ties rank 1"; with it, we can say "no evidence of improvement."
- **Hypothesis + falsifier per move**: kept me honest. Move 3 FE prior was 35% — when it came in flat, that matched the *low-confidence* hypothesis, not a surprise. If I'd written "confident FE will help," a null result would have read as an upset; because I wrote a probability, the null just updates the posterior on "default HistGBT is already near the feature-ceiling."

## Things to fix in the protocol

### 1. Noise estimate must be required for quantitative, not conditional

Current prompt says: `"beats" = strictly better on the named metric (beyond noise, if you have a noise estimate).`

The *if* is a bug. For quantitative projects, without a noise estimate the admission rule is meaningless — you can't distinguish a real gain from seed luck. Every admission rides on it.

**Fix:** schema for quantitative result docs should require `<metric>_mean` and `<metric>_std` (or an equivalent noise estimate) and the leaderboard score column should carry both. The admission rule should be stated as:

> **quantitative** — "beats" = `variant_mean − rank_k_mean > 2 × rank_k_std` (or stricter if the project defines its own threshold). Result docs MUST report mean + std across ≥3 seeds.

### 2. Seed-queue starting-point placeholders are ambiguous

I seeded three queue rows with `starting-point: *(rank 1 at time of move)*`. That's a readable shorthand but it's not a SHA — and the protocol elsewhere says "every wiki reference to code is a GitHub URL pinned to a SHA." At claim time I resolved it to the current rank 1 (GBT@7250242). A strict reader could call this ambiguous or claim it allows retroactive re-interpretation.

**Fix options** (pick one):
- (a) require all starting-points to be real SHAs at seed time; re-seed if they need to move.
- (b) explicitly legitimize `"rank N at claim"` as a placeholder with the rule "resolved to the SHA of the leaderboard row at time of claim, recorded in the result doc's STARTING POINT field."

Option (b) is lighter and matches how I actually used it. Either way, document it.

### 3. Ablation / orthogonality moves don't fit "cycles chain linearly"

Horror's V5 and haiku's ban-only were single ablations: one config, one measurement, one cycle. Fine. But when I went to run `gbt-fe-ablation` for Adult — drop each of 5 FE features in turn — the natural shape is **N parallel sub-variants**, not a linear chain.

The protocol's strict reading is: "If you find yourself wanting to branch cycles (run two variants in parallel and compare), close this move and open two new moves instead." → 5 ablations would mean 5 new moves. Queue cap 5 would choke, and the result is 5 result docs carrying the same header/context repeated 5×.

**Fix:** explicitly allow an "ablation table" shape: one move, one result doc, one cycle that runs N parallel sub-configs and reports a comparison table. Add to the protocol:

> **Ablation moves** are an exception to "cycles chain linearly." One ablation move may run N parallel sub-variants in a single cycle, reporting a table. Each sub-variant gets its own output dir (`outputs/<slug>/<sub>/`). The move's result doc treats the table as the headline result; no need for N separate moves.

### 4. "Analysis-only cycles get `git commit --allow-empty`" is a fine rule but needs an example

Came up implicitly when I wrote per-move "Analysis" sections that were narrative-only after the numbers were in. I used one full commit for "cycle + analysis" rather than separating them. Cleaner might be: cycle commit = numbers, analysis-only commit = interpretation. But the protocol doesn't say that's wrong, and at 1s per cycle the extra commit feels like noise.

Not a blocker, but the protocol would be clearer with one example run showing the intended separation (or explicitly saying "analysis can ride on the cycle commit when short").

### 5. `score / verdict` column is awkward for quantitative with noise

Current leaderboard:

```
| 1 | gradient-boosted-trees | val_auc = 0.9290 ± 0.00195 (n=5); +0.0218 over baseline (4.3× margin); admission threshold for challengers: AUC > 0.9329 |
```

That's three facts stuffed into one cell: the score, the delta-from-predecessor, and the derived admission threshold. Works but hard to scan.

**Fix:** for quantitative, split into columns:
```
| rank | result | branch | commit | mean | std (n) | vs rank-1 | admits if > |
```

Keep `score / verdict` as-is for qualitative. Per-project flavor.

### 6. The `<N>. <one-line>` verbs in Queue updates are good; the conditional "rank 1 at time of move" starting-point breaks on them

When I added `gbt-fe-ablation` during FE resolve with starting-point `r/feature-engineering@ca199d2`, I pinned a SHA. Good. But when I seeded `gbt-hparam-tune` originally with `*(rank 1 at time of move)*`, I couldn't pin — rank 1 didn't exist yet. Two different styles living in the same QUEUE table is confusing.

**Fix:** same as (2). Pick one.

## Things I'd also flag from the run

- **Commit-message format** `r/<slug> cycle N: <change> -> <metric>. qual: <one line>.` worked but is long. The convention of putting quantitative metrics in the subject line means you can read `git log` as a protocol summary, which is nice — preserve this.
- **`Insights touched` optional section** — not used in this quantitative project because no cross-move insight crystallized yet. That's fine; the section is still worth having because the horror + haiku projects demonstrated it does carry weight when insights exist.

### 7. `falsified` vs `resolved` needs a tie-breaker when the two decisions diverge (from stack-rf-histgbt)

Stacking was the first move where the *hypothesis* and the *leaderboard decision* pointed in different directions:

- Hypothesis: "stacking yields Δ > +0.001 vs rank 1." → Actual Δ = −0.00063. **Falsified.**
- Leaderboard: "beats rank 2 RF by +0.00989 beyond-noise." → **Admits at rank 2.**

So the LOG event is simultaneously "falsified" (hypothesis) and "resolved → admitted" (leaderboard). The protocol says the event column is one of `{resolved, abandoned, falsified, evicted, pivot, …}` — singular. I tagged it `falsified` because that's the honest science-question tag, but that hides the leaderboard action. A reader scanning the LOG would miss that the leaderboard updated.

**Fix options:**
- (a) allow a compound event like `falsified+admitted` when both apply.
- (b) add a rule: "admission always dominates — if the move admits to the leaderboard, tag it `resolved`; mention `falsified` in the one-line summary." Simpler but loses signal.
- (c) separate the LOG into two columns: `hypothesis_outcome` and `leaderboard_action`. Most informative but adds width.

I'd pick (a): compound events are rare but clean when needed. The one-liner summary remains the final word.

### 8. Review mode on a single-agent run: the "converse with the human" step is a synchronization point, not a turn

The protocol says review mode writes a 4-part message and then "converses" with the human, with QUEUE edits / GOAL revisions gated on "explicit human approval." In an autonomous or overnight run, there's no human in the loop at that moment. Two options:

- (a) treat review mode as a hard stop: write the message, commit, wait for a human turn.
- (b) let the agent continue in a "self-review" mode where it edits QUEUE / seeds new moves without human approval, as long as it explicitly logs the decision as `self-review` rather than `review`.

I used (a) for this run — stopped at review, did not add new QUEUE rows unilaterally. But that means a nightly run will always stall at the first review mode until someone shows up. For truly unattended operation, (b) needs to be legitimized with guardrails (e.g., "self-review cannot change GOAL, SUCCESS CRITERIA, or RANKING CRITERION without a human; it can add QUEUE rows from pre-declared follow-up candidates in the most recent result doc").

### 9. Success-criteria satisfaction as an implicit termination signal

All four of this project's SUCCESS CRITERIA were met by move 4 (stack-rf-histgbt resolve):

- ✓ pipeline beats baseline by ≥ 2× baseline noise — rank 1 beats baseline by 4.3× (~0.0218 vs 0.00507 margin)
- ✓ orthogonality/ablation move — gbt-fe-ablation
- ✓ admission hinging on "beats beyond noise" — multiple boundary cases (FE within-noise rejected; stack-rf-histgbt within-noise of rank 1 but beyond-noise vs rank 2)
- ✓ no data leakage — `fnlwgt` is logged-but-ignored; the train/val split is stratified and seeded identically

The protocol doesn't currently have an "all success criteria met" termination rule. It should. Without one, review mode's default disposition is "here are three more candidate moves" — biased toward continuing. A criterion-satisfaction check would let review mode say "project terminates" as a first-class outcome.

**Fix:** add to the protocol's review-mode template:

> **0. Success-criteria check** — for each item in SUCCESS CRITERIA, mark met / not-met with one-line evidence. If all are met, the default recommendation is to terminate (with human approval); otherwise the default is to continue with more moves.

## Post-run summary (written after Review mode)

**What the protocol got right on a quantitative project:**

1. **Branch-per-move + per-cycle commits on GitHub** made the project self-auditable. Any claim in the wiki resolves to a SHA-pinned commit URL; the code repo's `git log --all --graph` is a parallel project history.
2. **The noise-estimate-based admission rule** fired cleanly five times and produced two canonical behaviors: rejecting a within-noise challenger (FE Δ=−0.00007, hparam-tune Δ=+0.00023, stack-vs-rank-1 Δ=−0.00063) and admitting via mid-leaderboard displacement (RF beats baseline but not rank 1; stack-rf-histgbt beats RF but not rank 1).
3. **Per-move numeric priors + falsifiers** kept hypothesis calibration honest. The stack move was a clean falsification — the prior was wrong in direction, and the doc says so.
4. **QUEUE cap 5** never bound on this project (the natural width was 1–2 at any time). But it did force me to think "is this a new move or a sub-variant of an existing move?" — e.g., FE-ablation was correctly shaped as one move with parallel sub-configs, not 5 separate moves.

**Where the protocol rubbed:**

- `score / verdict` cell cramped 3 facts into one cell (see #5).
- Ablation moves don't fit "cycles chain linearly" — bent the rule, documented as #3.
- Starting-point placeholders pre-SHA were ambiguous (see #2, #6).
- `falsified` vs `resolved` compound outcomes have no clean tag (see #7).
- Review mode assumes human-in-the-loop; unattended runs stall (see #8).
- No termination rule for "all success criteria met" (see #9).

**Net:** the protocol is ~90% ready for quantitative projects. Fixes #1 and #9 are load-bearing (without them, quantitative admissions are on shaky ground and the project never formally ends). The rest are quality-of-life.

- **Review mode** is what I just entered when the queue emptied. The 4-part message structure was the right shape; the "converse with the human" step is the pinch point for autonomous operation (see #8).
