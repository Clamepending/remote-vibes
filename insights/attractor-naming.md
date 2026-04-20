# attractor-naming

## CLAIM

Creative prompts where the base model has a strong stereotype prior (flash horror, haiku, aphorism, flash comedy, etc.) typically have *multiple* competing attractors, not one. Good prompt-craft is naming and banning several failure modes simultaneously *and* specifying at least one concrete positive anchor — not just banning the first failure mode you see.

## EVIDENCE

- [horror-prompt-tuning / baseline](../projects/horror-prompt-tuning/results/baseline.md) — no-prompt baseline collapses into "lights-went-out / closet / dead relative" twist-reveal attractor (6/6 twist-reveal, 4/6 identical opener).
- [horror-prompt-tuning / v2-restraint](../projects/horror-prompt-tuning/results/v2-restraint.md) — positive framing alone (no explicit bans) collapses into a *different* attractor: soup on the stove (5/6). Falsified H2.
- [horror-prompt-tuning / v5-ban-ablation](../projects/horror-prompt-tuning/results/v5-ban-ablation.md) — explicit bans alone (no positive anchor) collapse into a *third* attractor: thirty-year cartographer (5/6). Qualified H1.
- [horror-prompt-tuning / v4-composite](../projects/horror-prompt-tuning/results/v4-composite.md) — bans + positive anchor + "output only" jointly neutralize all three named attractors (13/14 clean hits). Confirms bans and positive anchor do orthogonal work.

## CONFIDENCE

**Medium.** All evidence to date comes from a single project (two-sentence horror) with Sonnet 4.6 at default temperature. The pattern was consistent across five variants within that project (baseline / V1 / V2 / V3 / V5 each exhibited distinct attractor behavior) — but we haven't tested transfer to another creative genre. Confidence rises to **high** if the same three-way pattern (baseline-attractor → positive-only-attractor → ban-only-attractor → composite-works) reproduces on a second creative task.

## SCOPE

- **Tested:** two-sentence horror stories (`claude-sonnet-4-6`, default temperature, n=6 to n=8 per variant). Five attractors identified: lights-went-out, soup-on-stove, thirty-year-cartographer, `**Detail chosen:**` leak, escalation-twist.
- **Conjectured to generalize:** any creative genre with strong stereotype priors (flash fiction, haiku, aphorism, joke form, one-line review, bio-line). Queue row `attractor-generalise` exists to test this.
- **Not conjectured to generalize:** technical/analytical prompts (code, math, summarization) — these don't have the same kind of stereotype basin that creative forms exhibit, though they may have related failure modes worth investigating separately.

## SUPERSEDES

none
