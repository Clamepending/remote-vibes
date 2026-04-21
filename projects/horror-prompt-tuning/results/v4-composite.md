# v4-composite

## TAKEAWAY

V4 = V1's ban list + V3's positive anchor (stripped of its scaffolding) + "output only the two sentences, no headers, no meta" + added bans on soup-kitchen scenes and abstract emotion words. Wins on every axis: 13/14 clean hits across n=14, zero mode-collapse, zero prompt-leak. Confirms that bans and positive anchor do *orthogonal* work — each neutralizes a different attractor.

## STATUS

resolved

## STARTING POINT

[r/v3-object-pivot@175d206](https://github.com/mark/horror-prompt-tuning/tree/r/v3-object-pivot)

## BRANCH

[r/v4-composite](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite)

## AGENT

0

## Question

If V1 (bans + positive framing) and V3 (positive anchor with menu) each had distinct failure modes — V1 a rare ban-violation and cartographer attractor, V3 prompt-leaks — does a composite prompt that takes V3's positive anchor *internalised* (no menu, no "pick ONE"), adds V1's ban list, adds explicit "output only," and adds bans on the attractors V2/V5 revealed, produce clean reliable flash horror?

## Hypothesis

**Prior (75% confident):** yes — the composite will inherit V1's variety, V3's craft, and fix both of their specific failure modes.
**Falsifier:** composite shows a *new* attractor that neither V1 nor V3 exhibited, OR peak prose drops below V1/V3 ceiling, OR prompt-leak returns.

## Experiment design

Change: new prompt combining (a) ban list from V1 + bans on soup-kitchen scenes and abstract emotion words (from V2 observations), (b) positive anchor from V3 without the "pick ONE / commit to it" planning frame, (c) explicit "output only the two sentences, no headers, no meta-commentary, no explanation."
Measure: hit rate, presence of any attractor collapse, presence of any prompt-leak, peak prose quality.

## Cycles

- `cycle 1 @d198b1d: V4 composite prompt, n=6 -> 5/6 clean strong hits, zero mode-collapse, zero prompt-leak. qual: retirement-cake/resin-arm/breathing-light samples genuinely eerie.`
- `cycle 2 @64369a6: V4 rerun n=8 for reliability, head-to-head with V1 rerun n=8 -> 7/8 clean hits. qual: exterminator-spider ("Eight.") and smoke-detector-chirp ("She replaced the battery anyway.") are cleanest landings of study.`

## Results

Commits [d198b1d](https://github.com/mark/horror-prompt-tuning/commit/d198b1d) (n=6) + [64369a6](https://github.com/mark/horror-prompt-tuning/commit/64369a6) (n=8 rerun). Outputs at `outputs/v4_composite/sample_{1..6}.txt` and `outputs/v4_composite_rerun/sample_{1..8}.txt`.

Representative hits:

> **V4-2 (resin model):** *"The resin model Marcus had painted eighteen months ago sat on his shelf with its left arm raised — he was certain, with the flat certainty of someone who has checked a thing a hundred times, that he had posed it with both arms at its sides. The arm was warm."*

> **V4-3 (retirement cake):** *"The retirement cake sat untouched on the breakroom table for eleven days, its frosting letters reading GOOD LUCK GLEN in that particular shade of grocery-store blue, and no one moved it because no one could remember who Glen was or whether he had ever existed. On the twelfth day, there were fourteen candles."*

> **V4r-1 (spider):** *"The exterminator counted seven legs on the spider he'd been watching for twenty minutes, then looked away to write it down, then looked back and counted again. Eight."*

> **V4r-3 (smoke detector):** *"The smoke detector in Pauline's kitchen had been chirping every thirty-three seconds for eleven days, and she had counted long enough to know that this morning it chirped at thirty-three seconds, then thirty-three, then thirty-three, then twenty-nine. She replaced the battery anyway."*

The one V4 miss:

> **V4r-5 (dog nails):** *"The dog's nails click against the hardwood floor in the next room — four beats, pause, four beats, pause — but her dog has been dead for six years, and she counted only three legs when she buried him. The clicking resumes, closer now, five beats this time."*

Four-beats/three-legs setup is strong; "five beats this time" tips into escalation-twist-reveal — a fifth latent attractor the V4 ban list didn't name.

## Analysis

Hypothesis confirmed. V4 inherits V1's variety (every sample is a different physical domain: resin, cake, spider, smoke detector, light) and V3's specificity (three numbers doing dread work in the retirement cake; "Eight." as one-word closer), while fixing both predecessors' failures.

The orthogonality result — V2 (positive only) fails one way, V5 (bans only) fails another way, V4 (both) succeeds — is the main scientific finding. Each prompt component neutralizes a specific attractor, and they compose.

The V4r-5 escalation-twist suggests a fifth attractor exists (escalation-then-reveal). A V4.1 with one more explicit ban might catch it.

Prior update: 90% that V4 is the best of the five variants on reliability; 70% that V4 is the best on peak prose (close to V3's V3-5).

## Reproducibility

Commits: [d198b1d](https://github.com/mark/horror-prompt-tuning/commit/d198b1d), [64369a6](https://github.com/mark/horror-prompt-tuning/commit/64369a6)
Command: `./run_variant.sh v4_composite 6 prompts/v4_composite.txt` (cycle 1), `./run_variant.sh v4_composite_rerun 8 prompts/v4_composite.txt` (cycle 2)
Artifacts: `outputs/v4_composite/` + `outputs/v4_composite_rerun/`
Prompt: `prompts/v4_composite.txt` at commit `64369a6`, tagged `exp/horror/best`
Config: default temperature, n=6 + n=8, parallel invocations

## Leaderboard verdict

*(at time of V4 resolve — V4 is the move that established rank 1)*

- vs rank 2 (v1-antipattern): better on flash horror craft because V4 has zero mode-collapse in n=14 vs V1's one cartographer + one ban violation; peak prose is close but V4's floor is meaningfully higher.
- vs rank 3 (v3-object-pivot): better because V3 leaks headers in 4/6; V4 has zero leaks; peak prose competitive.
- vs rank 4 (v5-ban-ablation): better — V5 collapses to cartographer 5/6, V4 has no attractor collapse.
- vs rank 5 (v2-restraint): better — V2 collapses to soup 5/6, V4 has no collapse.

Decision: insert at rank 1.

## Queue updates

ADD: attractor-generalise | starting-point [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | why does attractor-naming principle transfer to haiku / flash comedy / aphorism?
ADD: v4-few-shot | starting-point [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | why head-to-head V4 vs V6 few-shot exemplars on peak quality and reliability
ADD: v4.1-fifth-ban | starting-point [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | why V4r-5 dog-nails slipped into escalation-twist; a fifth ban might catch it
ADD: v4-output-only-ablation | starting-point [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | why remove "output only the two sentences" and see if prompt-leak returns — clean ablation
ADD: v4-temp-sweep | starting-point [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | why all samples used default temp; does V4's mode-collapse resistance hold at higher/lower temp?

## Insights touched

- [attractor-naming](../../../insights/attractor-naming.md) — the composite success is the positive confirmation: banning the three named attractors (baseline's lights-went-out, V2's soup, V5's cartographer) + specifying a positive anchor + "output only" jointly produces clean varied output. Confirms bans and positive anchor do orthogonal work.
