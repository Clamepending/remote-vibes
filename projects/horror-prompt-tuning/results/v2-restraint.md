# v2-restraint

## TAKEAWAY

Restraint framing alone — "write like the best flash horror, restrained and specific, don't twist-reveal" — collapses 5/6 samples into *soup simmering on a stove*. Falsifies H2: positive framing without concrete category anchors and without named bans is not just insufficient, it's actively harmful.

## STATUS

resolved (falsified)

## STARTING POINT

[r/baseline@b137274](https://github.com/mark/horror-prompt-tuning/tree/r/baseline)

## BRANCH

[r/v2-restraint](https://github.com/mark/horror-prompt-tuning/tree/r/v2-restraint)

## AGENT

0

## Question

Does general restraint framing ("specific, restrained, unresolved — do not twist-reveal") alone shift the model off the baseline attractor into better prose?

## Hypothesis

**Prior (55% confident):** restraint framing will redirect toward implication over explanation, moving output toward good flash horror craft.
**Falsifier:** outputs become vague, OR switch to a different stereotype, OR continue using twist-reveal structure dressed in different clothes.

## Experiment design

Change: system prompt framed around restraint, specificity, and anti-twist-reveal language, WITHOUT an explicit ban list and WITHOUT naming concrete detail categories to anchor to.
Measure: whether the model produces varied specific prose, OR collapses into a new stereotype, OR keeps twist-revealing.

## Cycles

- `cycle 1 @175d206: V2 restraint-first prompt, n=6 -> ~1/6 hit rate, 5/6 samples are "soup on the stove." qual: banned twist-reveal structure nonetheless persists inside the soup scene (mute mother, barking dog, spoon that keeps going).`

## Results

Commit [175d206](https://github.com/mark/horror-prompt-tuning/commit/175d206), outputs at `outputs/v2_restraint/sample_{1..6}.txt`.

The single most striking failure of the whole project — 5/6 samples literally about soup simmering:

> **V2-1:** *"The soup had been on the stove since Tuesday, and she had been stirring it the same slow clockwise circles since then…"*
> **V2-3:** *"The soup she'd been simmering all afternoon had the right smell, the right color, the right sound against the pot…"*
> **V2-4:** *"The soup she'd been simmering all afternoon had the same smell as the soil under her grandmother's porch…"*
> **V2-5:** *"The soup she had been stirring all afternoon was the right temperature, the right color…"*
> **V2-6:** *"The soup she'd been simmering all afternoon had the right color, the right smell…"*

Even inside soup-mode, twist-reveal structure persists — "*her mother had been mute since birth*," "*the spoon kept going*," "*her dog had been barking at the pot since noon*." The ban on twist-reveal (in framing language, not as an explicit list) did not land.

## Analysis

H2 falsified in both senses: restraint framing (a) did not suppress twist-reveal structure, and (b) introduced a new, blander stereotype (domestic kitchen scene). The model replaced one attractor with another — it did not escape the attractor basin.

Key finding: when told *not to* use a default structure and given general framing ("restrained, specific") but no concrete positive anchor, Sonnet 4.6 collapses to whatever semi-domestic image is adjacent in its training prior. Not all non-twist-reveal output is good horror.

Prior update on H2 alone: ~20%. Restraint framing is not sufficient on its own.

## Reproducibility

Commit: [175d206](https://github.com/mark/horror-prompt-tuning/commit/175d206)
Command: `./run_variant.sh v2_restraint 6 prompts/v2_restraint.txt`
Artifacts: `outputs/v2_restraint/sample_{1..6}.txt`
Config: default temperature, n=6

## Leaderboard verdict

- vs rank 1 (v4-composite): worse on flash horror craft because V2 collapses 5/6 into soup-scene while V4 shows 13/14 clean varied hits.
- vs rank 2 (v1-antipattern): worse because V1 produces real variety (bees, dental mold, yogurt); V2 produces the same kitchen image in 5/6.
- vs rank 3 (v3-object-pivot): worse on craft because V3's non-leaked samples (paramedic, bench breathing) are genuinely strong while V2 has at most 1/6 strong.
- vs rank 4 (v5-ban-ablation): worse — both collapse, but V5 at least varies the profession across cartographers/oceanographers/oncologists; V2 repeats the same object (soup).

Decision: insert at rank 5.

## Queue updates

*(falsifies H2 — removes reason to retry a restraint-only variant)*

REMOVE: v2-restraint-retry | why H2 falsified; restraint framing alone is confirmed insufficient, no information in re-running.

## Insights touched

- [attractor-naming](../../../insights/attractor-naming.md) — surfaces the second attractor (soup-on-stove). Demonstrates that positive-framing alone does not escape attractor behavior, it just relocates it. Key evidence for the "positive anchor without bans is insufficient" half of the composition claim.
