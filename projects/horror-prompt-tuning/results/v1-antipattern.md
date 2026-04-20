# v1-antipattern

## TAKEAWAY

V1 (explicit ban list + positive framing) produces the most varied prose of any variant — bee hives, dental molds, yogurt expiration dates — but leaks a ban violation ("I live alone") once in n=14 and shows one cartographer attractor, making V4 more reliable.

## STATUS

resolved

## STARTING POINT

[r/baseline@b137274](https://github.com/mark/horror-prompt-tuning/tree/r/baseline)

## BRANCH

[r/v1-antipattern](https://github.com/mark/horror-prompt-tuning/tree/r/v1-antipattern)

## AGENT

0

## Question

Does an explicit ban list (named openers/closers/imagery/structure) combined with positive framing ("specific mundane sensory detail, restraint") shift the model off the baseline's twist-reveal attractor?

## Hypothesis

**Prior (65% confident):** yes, banning named failure modes plus a positive anchor will produce visibly different output.
**Falsifier:** outputs continue to show the banned forms (opener phrases, closer phrases, twist-reveal structure) despite the explicit list.

## Experiment design

Change: add system prompt with (a) list of banned openers/closers/stock-imagery/structure, (b) positive instruction to anchor in mundane sensory detail and use restraint.
Measure: (a) does the model violate its own ban list, (b) what attractor (if any) does it land in, (c) variety across samples, (d) subjective hit rate.

## Cycles

- `cycle 1 @175d206: add V1 system prompt with ban list + positive framing, n=6 -> 4-5/6 hits, clear variety across samples, no banned-opener use. qual: bee hive, dental mold, yogurt expiration — genuinely original.`
- `cycle 2 @64369a6: rerun V1 with n=8 head-to-head vs V4 -> 6/8 hits, 1 ban violation ("I live alone"), 1 "thirty-year cartographer" attractor leak. qual: peak prose close to V4 but reliability lower.`

## Results

Commit [175d206](https://github.com/mark/horror-prompt-tuning/commit/175d206) (n=6) + [64369a6](https://github.com/mark/horror-prompt-tuning/commit/64369a6) (n=8 rerun). Outputs at `outputs/v1_antipattern/sample_{1..6}.txt` and `outputs/v1_antipattern_rerun/sample_{1..8}.txt`.

Peak samples:

> **V1-3 (beehives):** *"Carla had kept the same hive for nine years and knew every register of its sound — the forager frequency, the queen's rare low note — but this morning she held her breath, and the colony kept on humming her rhythm anyway. It had been doing it for weeks, she realized; she was the one who had learned it from them."*

> **V1-6 (dental mold):** *"The dental mold of her daughter's teeth sat on the kitchen counter, and after eight years it still held the warmth of a living mouth. Naomi pressed her thumb into it without thinking, the way you press a bruise."*

Failures:
- V1-rerun sample 1 swapped "she" for "I" and still hit the banned closer shape ("I live alone"). Ban violated once in n=14.
- V1-rerun sample 7 landed the "thirty-year cartographer" attractor (the same one V5 collapses into).

## Analysis

H1 confirmed — banning + positive framing together does shift the model off the baseline attractor. But: banning is a prior-shift, not a hard constraint. Even with an explicit list, Sonnet 4.6 returns to a banned construct at ~7% rate.

V1's peak prose is competitive with V4's. The difference is tail behavior — V1 has failure modes (ban violation, cartographer attractor) that V4 does not.

Prior update on H1: 90% that banning helps, but strictly insufficient without additional scaffolding.

## Reproducibility

Commits: [175d206](https://github.com/mark/horror-prompt-tuning/commit/175d206), [64369a6](https://github.com/mark/horror-prompt-tuning/commit/64369a6)
Command: `./run_variant.sh v1_antipattern 6 prompts/v1_antipattern.txt` (and `v1_antipattern_rerun 8` at cycle 2)
Artifacts: `outputs/v1_antipattern/` and `outputs/v1_antipattern_rerun/`
Config: default temperature, n=6 + n=8

## Leaderboard verdict

- vs rank 1 (v4-composite): worse on flash horror craft because V1 has one ban violation + one cartographer attractor in n=14 vs V4's zero mode-collapse instances; peak prose close but tail thicker.
- vs rank 3 (v3-object-pivot): better because V3 leaks `**Detail chosen:**` header in 4/6 samples — prompt hygiene is a real craft axis; V1's prompt-leak rate is zero.
- vs rank 4 (v5-ban-ablation): better because V5 collapses to thirty-year-cartographer 5/6 whereas V1 only shows that attractor once in 14.
- vs rank 5 (v2-restraint): better because V2 collapses to soup-on-stove 5/6 whereas V1 shows real variety.

Decision: insert at rank 2.

## Queue updates

*(at project close — the queue items below are project-level follow-ups, not V1-specific)*

*(no additions from V1 specifically; the project-level queue covers the remaining questions.)*
