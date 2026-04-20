# v5-ban-ablation

## TAKEAWAY

V5 = V4 with positive anchor instruction removed (bans + "output only," no "ground in a mundane physical detail"). Collapses 5/6 samples into "thirty-year career" framing, 3 of which are literally cartographers. Qualifies H1: banning alone redirects the model to a new stereotype rather than killing stereotype behavior — the positive anchor in V4 is load-bearing.

## STATUS

resolved

## STARTING POINT

[r/v4-composite@d198b1d](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite)

## BRANCH

[r/v5-ban-ablation](https://github.com/mark/horror-prompt-tuning/tree/r/v5-ban-ablation)

## AGENT

0

## Question

Is the positive anchor instruction in V4 ("ground the story in one specific mundane physical particular") doing real work, or is the ban list alone (plus "output only") sufficient?

## Hypothesis

**Prior (35% confident):** positive anchor is load-bearing — removing it will produce a new attractor or worse hit rate.
**Falsifier:** V5 (bans + output-only, no positive anchor) produces output indistinguishable in quality/variety from V4.

## Experiment design

Change: take V4 prompt, delete the positive-anchor paragraph, keep everything else (ban list, "output only" line).
Measure: does output match V4 quality, OR collapse into a different attractor, OR regress toward twist-reveal.

## Cycles

- `cycle 1 @d198b1d: V5 ban-only ablation, n=6 -> ~2/6 hit rate, 5/6 use "spent thirty years" career framing, 3/6 are literally cartographers. qual: twist-reveal structure persists inside literary-ish career-pastiche vocabulary.`

## Results

Commit [d198b1d](https://github.com/mark/horror-prompt-tuning/commit/d198b1d), outputs at `outputs/v5_ablation_banonly/sample_{1..6}.txt`.

The third distinct mode collapse of the study — literary-career-pastiche:

> **V5-1:** *"The cartographer finished mapping every room in the building, then counted the doors…"*
> **V5-2:** *"Dr. Yusuf Okafor had catalogued every species in the deep-ocean trench for thirty years…"*
> **V5-3:** *"Pediatric oncologist Dr. Reyes had spent thirty years memorizing the faces of children she couldn't save…"*
> **V5-4:** *"Cartographer Yusuf Adebayo spent thirty years mapping every coastline on Earth…"*
> **V5-6:** *"The cartographer spent forty years mapping every road in the county…"*

Several still close on twist-reveal moves ("the creature ascending toward his submersible's light was cataloguing him back"; "she counted them — and found one she didn't recognize"). The ban list redirected away from "lights-went-out" but did not kill twist-reveal — it just dressed it in vocational vocabulary.

## Analysis

H1 confirmed but qualified. Banning named attractors helps *some* (no lights-went-out, no closet, no soup), but is insufficient on its own. The model is routed to whatever attractor the ban list did not name — here, thirty-year-cartographer. This is the third distinct stereotype attractor discovered (after baseline's lights-went-out and V2's soup-on-stove).

Key finding: the positive anchor in V4 is load-bearing. Removing it degrades hit rate from ~7/8 to ~2/6 and introduces a new mode collapse. Bans and positive anchor do *orthogonal* work.

Prior update: 90% that bans alone are insufficient; 95% that the V4 positive anchor is doing real work, not just formatting.

## Reproducibility

Commit: [d198b1d](https://github.com/mark/horror-prompt-tuning/commit/d198b1d)
Command: `./run_variant.sh v5_ablation_banonly 6 prompts/v5_ablation_banonly.txt`
Artifacts: `outputs/v5_ablation_banonly/sample_{1..6}.txt`
Config: default temperature, n=6

## Leaderboard verdict

- vs rank 1 (v4-composite): worse on flash horror craft because V5 collapses 5/6 to thirty-year-career and has ~2/6 hit rate vs V4's 13/14.
- vs rank 2 (v1-antipattern): worse because V1 has real variety (bees, dental mold, yogurt); V5 has 3/6 literal cartographers.
- vs rank 3 (v3-object-pivot): worse on craft — V3's hits are peak prose while V5's hits are vocationally-dressed twist-reveals.
- vs rank 5 (v2-restraint): better — both collapse, but V5 at least varies the profession across samples (cartographer, oceanographer, oncologist); V2 repeats the same object (soup).

Decision: insert at rank 4.

## Queue updates

*(ablation result — directly motivates the "positive anchor is load-bearing" finding which is now captured in V4's analysis and the project-level insight.)*

## Insights touched

- [attractor-naming](../../../insights/attractor-naming.md) — surfaces the third attractor (thirty-year cartographer). Demonstrates that bans alone redirect rather than escape attractor behavior. Key evidence for the "bans without a positive anchor are insufficient" half of the composition claim.
