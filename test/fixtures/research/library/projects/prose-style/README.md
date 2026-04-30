# prose-style

## GOAL

Find the prompt scaffold that produces the most readable short-form answers.

## CODE REPO

`https://github.com/example/prose-style`

## SUCCESS CRITERIA

- Readability score ≥ 4.0 mean across the 20-prompt golden set, judged against the v1 rubric.
- Two independent judge passes agree at Cohen's κ ≥ 0.6.

## RANKING CRITERION

`qualitative: readability (1-5 rubric, higher is better)`

## LEADERBOARD

| rank | result | branch | commit | score / verdict |
|------|--------|--------|--------|-----------------|
| 1 | [v2-scaffold](results/v2-scaffold.md) | [r/v2-scaffold](https://github.com/example/prose-style/tree/r/v2-scaffold) | [bbbbbbb](https://github.com/example/prose-style/commit/bbbbbbb) | 4.1 mean across 20 prompts (rubric v1) |
| 2 | [v1-baseline](results/v1-baseline.md) | [r/v1-baseline](https://github.com/example/prose-style/tree/r/v1-baseline) | [aaaaaaa](https://github.com/example/prose-style/commit/aaaaaaa) | 3.4 mean across 20 prompts (rubric v1) |

## INSIGHTS

| (none yet) |

## ACTIVE

| move | result doc | branch | agent | started |
|------|-----------|--------|-------|---------|

## QUEUE

| move | starting-point | why |
|------|----------------|-----|
| v3-fewshot | [r/v2-scaffold@bbbbbbb](https://github.com/example/prose-style/tree/r/v2-scaffold) | Add 2-shot exemplars to the scaffold and re-judge. |

## LOG

See [LOG.md](./LOG.md) — append-only event history.
