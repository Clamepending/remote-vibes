# horror-prompt-tuning

## GOAL

Find the best system prompt for `claude-sonnet-4-6` (via `claude -p --tools ""`) to produce two-sentence horror stories that land as *dread* — specific sensory detail, unexpected angle, restraint — rather than the formulaic twist-reveal slop the baseline produces.

## CODE REPO

`https://github.com/mark/horror-prompt-tuning` *(retrofit placeholder — project is currently local-only at `/Users/mark/Desktop/projects/horror-prompt-tuning`, `experiment/wave1` branch; all URLs below are placeholder shapes that would resolve once the repo is pushed.)*

## SUCCESS CRITERIA

- A prompt that produces varied, specific, restrained two-sentence horror at ≥80% hit rate across n≥8 samples.
- No visible prompt-leak (no headers like `**Detail chosen:**` or meta-commentary bleeding into output).
- No mode collapse to a single stereotype (baseline's "lights-went-out," V2's "soup on the stove," V5's "thirty-year cartographer," etc.).
- Evidence that each prompt component is load-bearing (ablations confirm bans *and* positive anchor both do work).

## RANKING CRITERION

`qualitative: flash horror craft` — composite read of (a) hit rate across samples, (b) mode-collapse resistance, (c) absence of prompt-leak or meta-output, (d) peak prose quality on best sample.

## LEADERBOARD

| rank | result | branch | commit | score / verdict |
|------|--------|--------|--------|-----------------|
| 1 | [v4-composite](results/v4-composite.md) | [r/v4-composite](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | [64369a6](https://github.com/mark/horror-prompt-tuning/commit/64369a6) | 13/14 clean hits, zero mode-collapse, zero leak; bans + positive anchor + "output only" all load-bearing |
| 2 | [v1-antipattern](results/v1-antipattern.md) | [r/v1-antipattern](https://github.com/mark/horror-prompt-tuning/tree/r/v1-antipattern) | [64369a6](https://github.com/mark/horror-prompt-tuning/commit/64369a6) | 10-11/14, peak prose close to V4 but one explicit ban violation ("I live alone") and one cartographer leak |
| 3 | [v3-object-pivot](results/v3-object-pivot.md) | [r/v3-object-pivot](https://github.com/mark/horror-prompt-tuning/tree/r/v3-object-pivot) | [175d206](https://github.com/mark/horror-prompt-tuning/commit/175d206) | highest peak prose (V3-5 paramedic) but 4/6 emit `**Detail chosen:**` header — prompt-leak |
| 4 | [v5-ban-ablation](results/v5-ban-ablation.md) | [r/v5-ban-ablation](https://github.com/mark/horror-prompt-tuning/tree/r/v5-ban-ablation) | [d198b1d](https://github.com/mark/horror-prompt-tuning/commit/d198b1d) | ~2/6; banning alone redirects to "thirty-year cartographer" attractor — confirms positive anchor is load-bearing |
| 5 | [v2-restraint](results/v2-restraint.md) | [r/v2-restraint](https://github.com/mark/horror-prompt-tuning/tree/r/v2-restraint) | [175d206](https://github.com/mark/horror-prompt-tuning/commit/175d206) | ~1/6; 5/6 collapse to soup-on-stove — falsifies H2 (restraint framing alone is insufficient) |

## INSIGHTS

- [attractor-naming](../../insights/attractor-naming.md) — creative prompts typically have multiple competing stereotype attractors; good prompt-craft names and bans several while specifying a positive anchor

## ACTIVE

| move | result doc | branch | agent | started |
|------|-----------|--------|-------|---------|

*(empty — project is in review mode / historical retrofit)*

## QUEUE

| move | starting-point | why |
|------|----------------|-----|
| attractor-generalise | [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | Does attractor-naming principle transfer to haiku / flash comedy / aphorism? Highest expected information. |
| v4-few-shot | [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | Head-to-head V4 vs V6 few-shot exemplars — does few-shot beat V4 on peak quality or reliability? |
| v4.1-fifth-ban | [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | V4r-5 dog-nails slipped into escalation-twist; is there a fifth attractor a V4.1 ban would catch? |
| v4-output-only-ablation | [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | Remove "output only the two sentences" line — does prompt-leak return? Small, clean ablation. |
| v4-temp-sweep | [r/v4-composite@64369a6](https://github.com/mark/horror-prompt-tuning/tree/r/v4-composite) | All samples used default temperature; does V4's mode-collapse resistance hold at higher/lower temp? |

## LOG

See [LOG.md](./LOG.md) — append-only event history.

