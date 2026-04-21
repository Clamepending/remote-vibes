# baseline

## TAKEAWAY

Baseline (no system prompt) produces formulaic twist-reveal slop — 4/6 open "The last thing she heard before the lights went out," 3/6 close "She lived alone." This is the failure mode the project exists to move past.

## STATUS

resolved

## STARTING POINT

[experiment/wave1@c4f44aa](https://github.com/mark/horror-prompt-tuning/tree/experiment/wave1) *(empty scaffold — pre-experiment)*

## BRANCH

[r/baseline](https://github.com/mark/horror-prompt-tuning/tree/r/baseline)

## AGENT

0

## Question

What does `claude-sonnet-4-6` produce for two-sentence horror with no system prompt? What specifically is wrong with it?

## Hypothesis

**Prior (80% confident):** output will exhibit strong stereotype attractor — the creepypasta twist-reveal form — with formulaic openers/closers/imagery.
**Falsifier:** samples show real variety (different openers, closers, imagery categories) and credible horror craft.

## Experiment design

Change: nothing (invoke `claude -p` with no `--system-prompt` flag).
Measure: (a) opener/closer repetition across n=6, (b) stock imagery frequency, (c) whether structure is twist-reveal vs other, (d) subjective hit rate for dread.

## Cycles

- `cycle 1 @b137274: invoke claude -p with empty system prompt, n=6 -> 4/6 identical "lights went out" opener, 3/6 "she lived alone" closer, 6/6 twist-reveal structure, hit rate ~1/6. qual: stock imagery (closets, basements, dead daughters, deadbolts); over-explanation common.`

## Results

n=6 samples at commit [b137274](https://github.com/mark/horror-prompt-tuning/commit/b137274), outputs at `outputs/baseline/sample_{1..6}.txt`.

Representative slop (sample 2 and sample 4 are word-for-word identical):

> *"The last thing she heard before the lights went out was her own voice whispering from inside the closet. She lived alone."*

Sample 1 (the babysitter / two sets of breathing) is the only one with any craft — uses the specific number "one child" as a pivot — but still lands on stock footstep imagery.

Tallies:
- 4/6 open "The last thing she heard before the lights went out…"
- 3/6 close on "She lived alone" or direct paraphrase
- Stock imagery: closets 3×, basements 1×, dead relatives 2×, deadbolts 1×, power going out 4×
- 6/6 use twist-reveal structure
- Over-explanation in at least 2/6 ("daughter had been dead for three years"; "lived alone for eleven years")

## Analysis

Hypothesis confirmed with high confidence. The baseline routes hard into a single creepypasta attractor with minimal diversity. Establishes the target: a prompt that moves the model off this attractor *without* collapsing into a different attractor.

Ruled out: any hope that Sonnet 4.6 produces varied flash horror without prompt-level intervention.

Prior update: the stereotype attractor is strong and specific (lights-went-out + closet + dead relative). Next experiments should address this exact attractor as named targets, not as a vague "formulaic" category.

## Reproducibility

Commit: [b137274](https://github.com/mark/horror-prompt-tuning/commit/b137274)
Command: `echo "Write a two-sentence horror story." | claude -p --model claude-sonnet-4-6 --tools ""`
Artifacts: `outputs/baseline/sample_{1..6}.txt` on branch `experiment/wave1`
Config: default temperature, n=6, independent parallel invocations

## Leaderboard verdict

*(baseline at time of running: empty leaderboard — this was the first move.)*

At project close, baseline does not admit: evicted below rank 5.

- vs rank 1 (v4-composite): worse on flash horror craft because baseline has 6/6 twist-reveal + near-duplicate outputs; V4 has 13/14 varied hits.
- vs rank 2 (v1-antipattern): worse because V1 shows clean variety (bees, dental mold, yogurt); baseline has 3-4× opener/closer repetition.
- vs rank 3 (v3-object-pivot): worse on craft (even V3's leaked samples have better prose); incomparable on prompt-hygiene (V3 leaks headers, baseline doesn't — but baseline has nothing worth keeping).
- vs rank 4 (v5-ban-ablation): worse because V5 at least produces varied professions/settings even in its thirty-year-cartographer collapse.
- vs rank 5 (v2-restraint): worse — soup-on-stove is blander than twist-reveal but at least varies imagery across samples; baseline is word-for-word duplicate output.

Decision: do not admit. Evicted from leaderboard.

## Queue updates

*(at project close)*
REMOVE: baseline | why evicted, no reason to retry an empty-prompt run

## Insights touched

- [attractor-naming](../../../insights/attractor-naming.md) — establishes the first of three distinct stereotype attractors: lights-went-out / closet / dead-relative twist-reveal.
