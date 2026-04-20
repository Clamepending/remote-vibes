# ogbench-cube-simple

## GOAL

Maximize episodic return on OGBench `cube-single-play-singletask-v0` from the offline dataset alone (no online interaction during training). The task is a 5-D continuous-control cube-manipulation problem with a 28-D observation, 200-step episode cap, and sparse reward (−1 per step, 0 on success). Returns are bounded in `[-200, 0]`; higher is better. The starting BC baseline likely gets nowhere — the real question is which offline-RL recipe, at M3-feasible compute, moves the needle most, and how far it gets.

## CODE REPO

https://github.com/Clamepending/ogbench-cube-simple

## SUCCESS CRITERIA

- Primary: `eval_success_rate_mean ≥ 0.80` on the held-out rollout distribution (n=3 seeds, 50 episodes each), OR equivalently `eval_return_mean ≥ −40` (avg episode length ≤ 40 steps to success).
- Secondary: at least one variant must clearly beat a BC-imitation baseline by more than 2×std of the BC baseline noise.
- Stopping condition: if after 5 resolved moves no variant crosses the primary threshold AND no new direction promises another 2×std of headroom, declare the project stuck in review mode and recommend a pivot or termination.

## RANKING CRITERION

`quantitative: eval_return_mean (higher is better)`. Seeds required per result: n≥3. Noise rule for admission: a variant beats rank k only if `variant_mean − rank_k_mean > 2 × rank_k_std`.

## LEADERBOARD

| rank | result | branch | commit | score |
|------|--------|--------|--------|-------|
| —    | —      | —      | —      | —     |

## ACTIVE

| move | result doc | branch | agent | started |
|------|-----------|--------|-------|---------|

## QUEUE

| move | starting-point | why |
|------|----------------|-----|
| bc-baseline | https://github.com/Clamepending/ogbench-cube-simple/tree/main | Anchor the leaderboard. BC is the minimum-viable offline policy; its number sets the noise floor and lets every later move argue "better than imitation". |
| td3bc | https://github.com/Clamepending/ogbench-cube-simple/tree/main | Classical offline-RL baseline with BC-regularized Q-learning. Strong default on D4RL-style tasks; the obvious next move after BC. |
| iql | https://github.com/Clamepending/ogbench-cube-simple/tree/main | Implicit Q-Learning — avoids explicit actor-critic adversarial dynamics and tends to be stable on sparse-reward cube tasks. Orthogonal mechanism to TD3+BC, worth running even if TD3+BC wins. |
| bc-capacity-sweep | https://github.com/Clamepending/ogbench-cube-simple/tree/main | If BC is under-parameterized (256×3 MLP) the "BC floor" is artificially low. One cheap move that bounds how much of our gap is pure-imitation vs. true-offline-RL gain. |
| rebrac | https://github.com/Clamepending/ogbench-cube-simple/tree/main | Recent strong offline-RL recipe (regularized BC actor + dual Q). Reserved in case TD3+BC and IQL both plateau — a fresh attempt, not a duplicate. |

## LOG

| date | event | slug or ref | summary | link |
|------|-------|-------------|---------|------|
| 2026-04-20 | seeded | — | Project seeded. Scaffold + BC trainer at SHA `4d1191d`. Queue holds BC baseline, TD3+BC, IQL, BC capacity sweep, and ReBRAC as a reserve. | https://github.com/Clamepending/ogbench-cube-simple/commit/4d1191d00e083c03c6a3eee728243c487169270c |
