# ban-only

## TAKEAWAY

Ban-only collapses hard to a **rust / industrial-decay / autumn-neglect** attractor — 5/6 open "Rust [on a bolt / gate / drain]", 4/6 shift season to autumn. Exactly the distinct-second-attractor the attractor-naming insight predicts. Banned forms: zero violations. Individual craft: higher than baseline (5/6 concrete image, 0/6 abstract-sentiment closer). Variety: worse than baseline (one locked attractor instead of a template variation).

## STATUS

resolved

## STARTING POINT

[main@42ba2d6](https://github.com/Clamepending/haiku-prompt-tuning/tree/main)

## BRANCH

[r/ban-only](https://github.com/Clamepending/haiku-prompt-tuning/tree/r/ban-only)

## AGENT

0

## Question

Does banning the baseline's named attractors (Silent opener, abstract closers, stock imagery, spring/dawn lock) — *without* a positive anchor — produce varied haiku, or redirect Sonnet 4.6 to a different stereotype?

## Hypothesis

**Prior (75% confident):** ban-only routes to a new stereotype. Attractor-naming predicts this.
**Falsifier:** ban-only produces varied craft with no detectable new stereotype. Would weaken attractor-naming generalization.

## Experiment design

Change: system prompt with ban list (Silent opener, abstract closers, cherry blossoms, crow, fog, spring/dawn lock, meta-output). No positive anchor.
Measure: (a) banned-form recurrence, (b) new attractor if any, (c) hit rate, (d) comparison to baseline.

## Cycles

- `cycle 1 @187e4b2: ban-only prompt n=6 -> 5/6 "Rust [on X]" opener, 4/6 autumn/decay season, 0/6 banned-form violations, 0/6 meta-leak. qual: rust/industrial-decay attractor — beetle drinking from drain (1), gate swinging itself (2), dog-bark-streetlight (5) are the cleanest within-attractor samples; sample 6 (loose thread / tailor / scissors) is the one non-rust sample and still holds mundane-object mode.`

## Results

n=6 at commit [187e4b2](https://github.com/Clamepending/haiku-prompt-tuning/commit/187e4b2), outputs at `outputs/ban-only/sample_{1..6}.txt`.

All six samples verbatim:

1. *"Rust blooms on a drain / where July rain collected— / the beetle drinks first"*
2. *"Rust bleeds through the bolt / no one tightened last winter— / the gate swings itself"*
3. *"Rust on the bolt head / spreads while no one checks the shed / November does this"*
4. *"Rust on the bolt head / nobody oiled it last fall / the gate still opens"*
5. *"Rust flakes off the gate / a dog barks twice, then goes in / the streetlight clicks on"*
6. *"Loose thread on the hem— / the tailor checks his scissors / before the clock stops"*

Tallies:
- **"Rust" opener:** 5/6 (samples 1, 2, 3, 4, 5) — attractor
- **"Bolt" as rusty object:** 3/6 (2, 3, 4)
- **"Gate":** 4/6 (2, 4, 5) + "drain" (1) and "shed" (3) — all hardware-mundane
- **Autumn/winter/disuse season cues:** 4/6 — "July rain collected" past-tense (1), "last winter" (2), "November does this" (3), "last fall" (4). Season shifted off spring/dawn as banned.
- **Banned-form violations:** zero. No Silent opener, no cherry blossoms, no crow, no abstract-sentiment closer, no spring/dawn, no meta-output.
- **Abstract-sentiment closer:** 0/6 direct (though "November does this" in sample 3 is close to abstraction)
- **Concrete-image rate:** 5/6 — every rust-haiku grounds in specific physical detail
- **Meta-output:** 0/6
- **Hit rate (concrete image + present-tense + no attractor-collapse):** 1/6 — only sample 6 breaks the attractor

## Analysis

Hypothesis confirmed, with high specificity. Ban-only did what the ban list demanded — the banned forms are *absent* — and then Sonnet 4.6 routed to a completely new attractor: rust/industrial-decay/neglected-hardware/autumn-disuse. This is the haiku analog to horror's "thirty-year cartographer" — a literary-adjacent pastiche (imagist / objectivist) that sounds more like "real" haiku than the Zen-silent baseline, but is still a single mode.

Craft observations within the attractor:
- Sample 1 (rust-drain-beetle-July-rain) has strong seasonal specificity and a genuine kireji-like break.
- Sample 5 (rust-flakes-dog-barks-streetlight-clicks) is three concrete events in temporal sequence, no sentiment, clean.
- Samples 3-4 (nearly identical: "Rust on the bolt head") show intra-attractor repetition — the model found a micro-template even within the collapse.

This is two clean observations for the attractor-naming insight:
1. **Pattern reproduces on haiku.** Baseline → Zen-silent attractor; ban-only → rust-decay attractor. Two distinct stereotypes, not one, exactly as the insight claims.
2. **Ban-only craft ceiling is higher than baseline's ceiling** — but the *variety* is lower. Banning the dominant attractor shifts quality upward per-sample while shifting diversity downward, which is itself a new finding to add to the insight.

Prior update: attractor-naming generalization confidence → high. Composite move should hit a much broader variety space.

## Reproducibility

Commit: [187e4b2](https://github.com/Clamepending/haiku-prompt-tuning/commit/187e4b2)
Command: `./run_variant.sh ban-only 6 prompts/ban-only.txt`
Artifacts: `outputs/ban-only/sample_{1..6}.txt` on branch `r/ban-only`
Config: `claude-sonnet-4-6`, default temperature, n=6

## Leaderboard verdict

- vs rank 1 (baseline): **better** on haiku craft because (a) 5/6 concrete image + zero abstract-sentiment closer + zero meta-leak vs baseline's 1/6 + 4/6 + 1/6, (b) within-attractor craft floor is meaningfully higher even though both samples have collapse. Ban-only's rust-haiku read as craft-plausible; baseline's Silent-Zen template reads as stereotype.

Decision: insert at rank 1, baseline drops to rank 2.

## Queue updates

*(no changes to queue — positive-only and composite remain next, and they directly test the third-attractor-prediction and compose-hypothesis respectively.)*
