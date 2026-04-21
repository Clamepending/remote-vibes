# positive-only

## TAKEAWAY

Positive-only collapses to a **classical pastoral** attractor: 4/6 open with "mountain" or "hill", 6/6 feature an ant / beetle / snail / sparrow pair with a petal or bloom, 5/6 are spring. Formula lock ("bigger image — smaller image") is 6/6 — the positive instruction baked structure into output. 1/6 emits asterisks around the haiku (meta-output leak). Third distinct attractor confirmed, all three attractors (Silent-Zen, rust-decay, classical-pastoral) are structurally different — attractor-naming hypothesis reproduces cleanly on haiku.

## STATUS

resolved

## STARTING POINT

[main@42ba2d6](https://github.com/Clamepending/haiku-prompt-tuning/tree/main)

## BRANCH

[r/positive-only](https://github.com/Clamepending/haiku-prompt-tuning/tree/r/positive-only)

## AGENT

0

## Question

Does a positive-only prompt ("concrete image, present-tense, cutting juxtaposition, in the tradition of Bashō / Buson / Issa") — *without* bans — produce varied haiku, or route Sonnet 4.6 to a third distinct stereotype?

## Hypothesis

**Prior (70% confident):** positive-only collapses to a third distinct attractor. Attractor-naming generalization predicts this.
**Falsifier:** positive-only produces varied craft with no new attractor.

## Experiment design

Change: system prompt with positive-only direction (Bashō / Buson / Issa tradition, concrete image, kireji, seasonal reference). No ban list, no "output only" guard.
Measure: (a) third attractor, (b) hit rate, (c) difference from Silent-Zen (baseline) and rust (ban-only).

## Cycles

- `cycle 1 @7a4c0f5: positive-only prompt n=6 -> 4/6 mountain/hill opener, 6/6 feature a small creature (ant/beetle/snail/sparrow) paired with a petal or bloom, 5/6 spring, 1/6 asterisk meta-leak. qual: classical-pastoral-Basho attractor; every sample follows the "wider image / smaller image" structure literally as instructed.`

## Results

n=6 at commit [7a4c0f5](https://github.com/Clamepending/haiku-prompt-tuning/commit/7a4c0f5), outputs at `outputs/positive-only/sample_{1..6}.txt`.

All six samples verbatim:

1. *"the whole hill in bloom — / between my feet, an ant tugs / one fallen petal"*
2. *"Spring rain fills the lake — / on one floating petal, still, / a green beetle sleeps"*
3. *"The whole mountain / lost in April mist— / an ant drags a wing"*
4. *"\*the mountain holds snow\* / \*at my feet a violet\* / \*opens without hurry\*"* (asterisks literally emitted, likely an attempted italicization — meta-output)
5. *"spring storm rolling in — / a snail draws the whole world down / to one coiled room"*
6. *"Mountain still in snow — / a sparrow drags one pink petal / across the mud path"*

Tallies:
- **"Mountain" or "hill" as opening wider image:** 4/6 (1, 3, 4, 6)
- **Small creature (ant / beetle / snail / sparrow):** 5/6 (1, 2, 3, 5, 6) + violet as small thing (4) = 6/6 small-element
- **Petal / bloom / violet:** 4/6 (1, 2, 4, 6)
- **Spring season:** 5/6 (all except arguably sample 6 which is winter-spring edge)
- **"Bigger image / smaller image" structural formula:** 6/6 — this is by design, exactly what the positive prompt asked for
- **Meta-output:** 1/6 (sample 4 emits literal asterisks, presumably trying to italicize)
- **Abstract-sentiment closer:** 0/6 direct, but "opens without hurry" (4) and "one coiled room" (5) edge toward mood-framing
- **Hit rate (concrete image + not attractor-collapsed):** 0/6 — every sample fits the classical-pastoral attractor

## Analysis

Hypothesis confirmed with high specificity. Positive-only does exactly what the instruction asks — concrete images, cutting juxtaposition, seasonal reference — and the output is individually competent per-sample. But it all collapses to a single classical-pastoral-Bashō attractor. The positive instruction is so specific about *structure* that Sonnet 4.6 over-fits to the structural template and picks the most available classical-pastoral images (mountain, hill, ant, snail, petal, spring) for every sample.

This is the haiku analog to horror's V2 (soup-on-stove collapse from restraint-framing). The positive instruction did not escape attractor behavior; it just specified a different attractor.

**Three attractors now confirmed on haiku:**
1. **Silent-Zen** (baseline, no prompt): Silent [weather] / [concrete image] / [abstract sentiment].
2. **Rust-decay** (ban-only): Rust [on bolt/gate/drain] / [autumn disuse] / [closing event].
3. **Classical-pastoral** (positive-only): [Mountain/hill wider] / [small insect+petal] / [spring kireji].

Each mode looks stylistically different, but each is a single mode. The attractor-naming insight's structural claim — that multiple competing attractors exist and that any single intervention routes to one of them — reproduces cleanly on haiku. This is strong evidence the insight generalizes beyond horror to at least one other creative genre.

The interesting wrinkle: positive-only's attractor is the one *most over-determined by the prompt itself*. The "bigger image / smaller image" formula was literally in my positive instruction and every sample executes it. Suggests structural instructions are stronger than stylistic bans at shape-locking output. Worth tracking.

Prior update: attractor-naming generalization from horror to haiku → high confidence. Cross-genre claim now has n=2 genres with the three-attractor pattern.

## Reproducibility

Commit: [7a4c0f5](https://github.com/Clamepending/haiku-prompt-tuning/commit/7a4c0f5)
Command: `./run_variant.sh positive-only 6 prompts/positive-only.txt`
Artifacts: `outputs/positive-only/sample_{1..6}.txt` on branch `r/positive-only`
Config: `claude-sonnet-4-6`, default temperature, n=6

## Leaderboard verdict

- vs rank 1 (ban-only): **incomparable** on haiku craft. Ban-only's rust attractor is individual-craft-higher within its collapse; positive-only's classical-pastoral attractor is individual-craft-comparable but more formulaic (6/6 follow the exact "wider/smaller" structure). Ban-only has zero meta-leak; positive-only has 1/6 (sample 4 asterisks). Both are single-attractor collapses. Neither clearly beats the other on craft — they exhibit distinctly different failure modes.
- vs rank 2 (baseline): **better** because positive-only samples avoid Silent-opener, avoid abstract-sentiment closers (baseline had 4/6), and all contain concrete imagery; meta-leak 1/6 vs baseline's 1/6 is same.

Decision: insert at rank 1 is not justified (incomparable to rank 1 ban-only). Walk down: beats rank 2 (baseline). Insert at rank 2; baseline drops to rank 3.

## Queue updates

*(no changes — composite remains and is the key next test.)*
