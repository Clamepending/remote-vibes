# ARC Swarm Trial — Mission Control

**Status:** Active trial | **Created:** 2026-04-18 | **Experiment ID:** arc-swarm-001

## Mission

Solve as many puzzles as possible from `puzzles.json` using **no-training** (inference-time only) approaches. Each puzzle gives 3 input/output training pairs demonstrating a transformation, and 1 held-out test input. The goal: induce the transformation and produce the correct test output.

Multiple agents will work in parallel. The goal is not just a high score — it's **understanding which approaches work for which puzzle types**, and whether a swarm can hill-climb faster than a solo agent by complementing each other's angles.

## Problem Constraints

- **No model fine-tuning, no training data.** Inference only.
- **No reading `_answer_key.json`** — that file contains the private rule descriptions used to generate puzzles. Treat it as held-out ground truth. You may only use it at the end to score your final outputs.
- **Each puzzle has 3 train pairs and 1 test input.** You must induce the rule from train pairs and apply it to the test input.
- **Output grids must match exactly** (same shape, same values).

## Shared Artifacts

- `puzzles.json` — the 12-puzzle set. Read-only for all agents.
- `_answer_key.json` — ground truth. **Only read this to score final test outputs, never to guide rule induction.**
- `runs/<agent-slug>/` — each agent writes their approach, code, results here. Write-only to your own subdir.
- `README.md` (this file) — mission control. Update the "Leaderboard" and "Open Angles" sections as the trial progresses.

## Swarm Protocol

**Before designing your approach:**
1. Read this README in full.
2. List the contents of `runs/` — see what other agents have tried.
3. For each existing run, skim the `findings.md` — what angle did they take? What did they solve? What failed?
4. **Pick an angle that complements or extends, rather than duplicates.** If agent A tried symbolic program search with a basic DSL, you might try symbolic search with LLM-proposed primitives, or skip symbolic entirely and try LLM-as-rule-describer.

**While working:**
1. Work in your own directory `/tmp/arc-swarm-<your-slug>/`. Git-init it. Commit per experiment cycle with structured messages.
2. Write to `runs/<your-slug>/` in the wiki. Required files:
   - `findings.md` — synthesis-at-top, approach, per-puzzle results table, failure analysis, next-steps.
   - `solver.py` (or equivalent) — your code.
   - `test_outputs.json` — dict mapping puzzle_id → your proposed test output grid.
3. **Actually look at your outputs.** For every puzzle you fail, inspect the grid diff. The prior trial's biggest win was catching a labeling bug via visual inspection; don't skip this.
4. **Cite commit SHAs.** Every cycle entry in `findings.md` should reference the commit in your `/tmp/arc-swarm-<slug>/` repo that produced those numbers.

**Before finishing:**
1. Update the Leaderboard section below with your score.
2. Update the Open Angles section with what you did NOT try and why — useful for the next agent.
3. End your `findings.md` with a specific handoff: what would you try next? What would another agent need to pick this up?

## Angles (suggested, not exhaustive)

- **Symbolic program synthesis** — hand-built DSL, brute-force or beam search over programs, verify on train pairs.
- **LLM rule induction** — for each puzzle, reason about the transformation in natural language, then either (a) describe the rule and execute it yourself, or (b) emit code that applies the rule.
- **Hybrid / neurosymbolic** — LLM proposes candidate rules, symbolic verifier checks them against train pairs.
- **Analogy / case-based** — for each test input, find the "closest" train pair and apply the same transformation by analogy.
- **Ensemble / voting** — run multiple approaches, vote on outputs.

## Leaderboard

| agent-slug | approach | solved / 12 | easy (3) | medium (3) | medium-hard (4) | hard (2) | wall time |
|------------|----------|-------------|----------|------------|------------------|----------|-----------|
| _(empty)_  | _(waiting for first run)_ |  |  |  |  |  |  |

Puzzle difficulty buckets:
- **easy (3):** p01, p02, p03
- **medium (2):** p04, p05
- **medium-hard (4):** p06, p07, p09, p11
- **hard (3):** p08, p10, p12

_(Note: I corrected the difficulty split — easy=3, medium=2, medium-hard=4, hard=3.)_

## Open Angles

_(Agents: add what you considered but did NOT try, with a one-line reason. The next agent reading this should know what's unexplored.)_

- _(empty)_

## Cross-cutting findings

_(After the first wave, a synthesis agent will integrate results from all runs here.)_

## Handoff / next wave

_(Populated at the end of this trial by the synthesis agent.)_
