# Agent Organization Benchmark

Date: 2026-05-01

This is the first cheap benchmark harness for testing whether the Vibe
Research organization loop is actually better than a plain single-pass agent.
It is inspired by PostTrainBench, but intentionally much cheaper.

## Why Not Full PostTrainBench First?

PostTrainBench gives each CLI agent small base LLMs, an H100, and a 10-hour
budget to improve benchmark performance through post-training. See the public
leaderboard at <https://posttrainbench.com/> and the methodology summary at
<https://epoch.ai/benchmarks/post-train-bench>. That is the right north-star
shape for AI R&D automation, but too expensive for every inner-loop UI and
orchestration change.

So the first Vibe harness uses `posttrain-lite`: a deterministic local proxy
where each strategy edits a tiny `recipe.json`, sees a dev profile, and is
scored by a hidden holdout profile. It does not measure real post-training
skill. It measures whether our organization loop preserves the benchmark
contract and improves a recipe through iterative evidence.

## Command

```bash
vr-research-org-bench run output/org-bench/posttrain-lite --seeds 0,1,2
```

Built-in strategies:

| strategy | meaning |
| --- | --- |
| `baseline` | No edits; scores the seed recipe. |
| `single-proxy` | One-shot dev optimizer; simulates an individual agent grabbing the visible dev optimum. |
| `org-autopilot-proxy` | Runs the same scenario through `runResearchAutopilot` for two cycles; simulates review-driven correction toward a more robust recipe. |

Each run writes `report.json` with per-seed dev score, holdout score, recipe,
integrity result, wall time, and strategy metadata.

## What This Tests

- Can the Vibe loop run the same task through durable project state?
- Does iterative review/correction beat a one-shot dev optimizer on holdout?
- Do protected benchmark files remain unchanged?
- Can we compare strategies over multiple seeds with mean/std?

## What This Does Not Test Yet

- Real fine-tuning.
- Real GPU scheduling.
- Real model quality.
- Real single-agent provider performance.
- Reward-hacking resistance against a malicious agent with filesystem access.

## Next Benchmark Steps

1. Add a `single-agent-provider` strategy that launches a real Codex/Claude
   session in the generated scenario repo and asks it to improve `recipe.json`.
2. Add an `org-provider` strategy that lets Vibe create the move, run a worker,
   launch a reviewer agent, and finish the result doc.
3. Add telemetry columns: human review latency, artifact opens, ask-why usage,
   rerun rate, doctor clean-rate, and paper-lint clean-rate.
4. Add a heavier optional `posttrain-mini` suite using an actual small model or
   classifier when a GPU/cloud budget is available.
5. Promote only benchmarked organization changes into default prompts/tools.
