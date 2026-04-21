# bc-baseline

## TAKEAWAY

_pending_

## STATUS

active

## STARTING POINT

https://github.com/Clamepending/ogbench-cube-simple/tree/main at commit `4d1191d00e083c03c6a3eee728243c487169270c`.

## BRANCH

https://github.com/Clamepending/ogbench-cube-simple/tree/r/bc-baseline

## AGENT

0

## Question

Does plain behavior cloning on the `cube-single-play-singletask-v0` offline dataset yield a non-trivial policy, and what is its `eval_return_mean` floor? This anchors the leaderboard so every later offline-RL variant has a reference point with known noise.

## Hypothesis

Prior: 60% confident BC hits a non-trivial but still mediocre number (roughly `eval_return_mean` in `[-200, -120]`, success rate 0–0.3). The dataset is `play`-collected (diverse, not expert), so imitating the mixture should partially solve the task but should not approach the oracle. **Falsifier**: if BC's 3-seed `eval_return_mean > -40` OR if it is a perfect `-200` across all 3 seeds (pure failure), the prior is wrong in opposite directions and the problem's tractability must be reassessed before deciding next moves.

## Experiment design

- **Change**: none — run the scaffold BC trainer as-is.
- **Variant module**: `variants/bc.py`. Deterministic tanh-squashed MLP actor `(256, 256, 256)`, MSE on `(obs, act)`, Adam lr `3e-4`, batch 256, 200k steps, MPS.
- **Seeds**: 3 (0, 1, 2).
- **Evaluation**: every 20k steps and at end; `eval_episodes=50`, `seed_start=10_000 + seed*1000`; report `eval_return_mean ± std` at final step.
- **Cycles**:
  - cycle 1: 3 seeds, default config → record `eval_return_mean`/`eval_success_rate`/`eval_episode_len_mean` mean±std.
  - cycle 2 (only if cycle-1 numbers look broken): diagnose (learning rate, clip, eval bug).

## Cycles

_pending_

## Results

_pending_

## Analysis

_pending_

## Reproducibility

_pending_

## Leaderboard verdict

_pending_

## Queue updates

_pending_
