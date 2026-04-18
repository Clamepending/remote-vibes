# ARC-AGI-3 and No-Training Approaches: Research Investigation

**Status:** Research Complete | **Last Updated:** 2026-04-18 | **Confidence:** High on facts, Medium on predictions

---

## Top-Line Insight

**ARC-AGI-3 is a fundamentally different challenge than v1/v2.** It shifts from static grid puzzles (where frontier AI approaches ~76% on v1) to interactive agents that must explore, infer goals, and plan in video-game-like environments with zero instructions. **Current frontier AI scores <1% on ARC-AGI-3** (humans: 100%), making it a genuine frontier benchmark. 

For no-training approaches specifically: **test-time compute scaling and program synthesis via neural guidance show the most promise**, significantly outperforming pure chain-of-thought reasoning. The best-measured no-training system reached **12.58%** (StochasticGoose, RL+CNN, preview phase), but this is not a baseline inference-only method—it still required weight updates during task solving.

**Key question unresolved:** No truly "zero-shot" baselines exist yet for ARC-AGI-3. The benchmark is so new that most published scores require training or test-time adaptation. This is our research frontier.

---

## Benchmark Definition & Context

### What is ARC-AGI-3?

ARC-AGI-3 (Advancing Reasoning Capabilities - Artificial General Intelligence, Version 3) is an **interactive, turn-based benchmark** designed to measure agentic intelligence:

- **Hundreds of original environments**, handcrafted by game designers
- **No instructions, no rules, no stated goals** — agents must discover them
- Agents explore, infer dynamics, build internal models, plan action sequences
- Evaluated on human efficiency: `Level Score = min(1.0, (human_baseline_actions / AI_actions))²`
- **1,200+ human participants**, 3,900+ games, rigorous human baselines

### v1 vs. v2 vs. v3 Comparison

| Dimension | ARC-AGI-1 | ARC-AGI-2 | ARC-AGI-3 |
|---|---|---|---|
| **Format** | Static grid puzzles | Static grids (harder) | Interactive turn-based |
| **Frontier AI SOTA** | 75.7% (o3, low-compute) | 8.6% (Claude Opus 4) | <1% (frontier AI) |
| **Human Baseline** | ~85% | ~80% | 100% |
| **Training Required?** | Tested both ways | Tested both ways | Primarily test-time |
| **Key Constraint** | Efficiency (cost/token) | Efficiency + generalization | Efficiency + continuous adaptation |

### Official No-Training Rules

From official ARC Prize documentation:
- **No fine-tuning** on ARC-AGI tasks or similar tasks
- **No external training data** beyond base model pretraining
- **Test-time-only reasoning and search** permitted (inference-time compute scaling allowed)
- Must score on both accuracy and **RHAE** (Relative Human Action Efficiency)

---

## No-Training Approaches: Five Families

### Family 1: Test-Time Compute Scaling & CoT Search

**Mechanism:** Use base LLM to search over space of natural-language "programs" (chains-of-thought); backtrack and explore at test time without gradient updates.

**Best Implementation:** OpenAI o3-preview
- Low-compute: 33.5M tokens, $26/task, **75.7%** on ARC-AGI-1
- High-compute: 5.7B tokens, $4,560/task (172x more)
- Cost efficiency: $0.50/task at 60.8%
- **Mechanism:** Searches over CoT space, evaluates candidate solutions internally

**Why it works:** Test-time search over discrete program space is well-aligned with the abstract reasoning required; more compute = more exploration = better solutions.

**Limitation on v3:** Requires stable reward signal (correct/incorrect answer). In interactive environments, agents must learn goal inference first—pure search becomes intractable.

---

### Family 2: Neurally-Guided Discrete Program Synthesis

**Mechanism:** Pre-trained VLM generates token probability distributions over a domain-specific language (DSL); exhaustive search enumerates high-probability programs; execute and verify.

**Best Implementation:** Neurally-Guided Program Induction (2024)
- Works without task-specific fine-tuning
- Trains on procedurally-generated synthetic tasks (split, merge, tile, object manipulation)
- At inference: multiple random passes bootstrap probabilities, then exhaustive search within budget
- Reported: Competitive with brute-force DSL search, less compute per problem

**Why it works:** Decouples neural "prior" from discrete search; symbolic verification ensures correctness.

**ARC-AGI-3 fit:** **Moderate.** Interactive environments are not naturally expressible as fixed DSLs. Would require learning new DSL elements or embedding program synthesis inside RL loop.

---

### Family 3: Reinforcement Learning + Neural Guidance (RL+CNN)

**Mechanism:** End-to-end learnable policy (CNN/transformer) trained on interaction rollouts; no weights frozen, but no external fine-tuning data—only on-task learning.

**Best Implementation:** StochasticGoose (Tufa Labs, ARC-AGI-3 preview)
- **12.58%** on preview (best non-LLM agent)
- Convolutional neural networks + value estimation
- Single-task RL: learn from scratch on each environment
- No pretraining, weights updated only during task solving

**Why it works:** RL naturally handles goal inference, partial observability, and sequential decision-making. No external training data needed.

**Key caveat:** Not "zero-shot"—requires gradient updates during task execution. This violates strict "no-training" if training = weight updates. But it's the only approach that actually solves v3 meaningfully.

---

### Family 4: Neuro-Symbolic Integration & Causal Reasoning

**Mechanism:** Combines neural perception (object detection, state representation) with symbolic reasoning (causal graphs, logic rules); hypothesis formation → test → refine.

**Status:** Emerging, few published results on ARC-AGI
- Beyond Brute Force (ARC Prize 2025): combined neural+symbolic, zero-shot contribution
- Approach: Learn state abstraction via neural net; use symbolic solver for planning

**Why it might work:** Humans excel at causal inference; separating perception from reasoning may generalize better than end-to-end RL.

**Limitation:** Requires hand-crafted symbolic language or learned abstractions that generalize. Unclear how to scale without domain knowledge.

---

### Family 5: Chain-of-Abstraction & Multi-Scale Reasoning

**Mechanism:** LLM generates multi-level abstractions of problem; reasons at each level; composes solutions hierarchically.

**Status:** Theoretical/emerging
- Similar to how humans decompose: high-level strategy → tactics → actions
- Not yet concretely published for ARC-AGI-3

**Why it might work:** Interactive environments have hierarchical structure; reasoning at abstract level (e.g., "goal is to reach corner") before tactical execution.

**Why no traction yet:** Requires learning what abstractions are valid—itself a hard generalization problem.

---

## Hypotheses & Priors

### Hypothesis 1: Test-Time Compute Scaling (CoT Search)
**Statement:** Scaling test-time compute on LLM-based CoT search will achieve 15–25% on ARC-AGI-3 within efficiency constraints (<$100/task).

**Prior:** 40% confident
- **Support:** Works well on v1 (75%), has proven search mechanics
- **Concerns:** v3 requires goal inference first; open-ended exploration hard to search
- **Test:** Run o3-preview or similar on ARC-AGI-3 and measure

---

### Hypothesis 2: RL+Guidance (Single-Task Adaptation)
**Statement:** A lightweight RL+CNN approach (similar to StochasticGoose) initialized with pretrained vision backbone, run per-task, will reach 8–15% and be more efficient than scaling LLM CoT.

**Prior:** 65% confident
- **Support:** StochasticGoose achieved 12.58% in preview; RL is the "right" algorithm for MDPs
- **Concerns:** Compute budget for RL training within 1–2 hours/task?
- **Test:** Benchmark RL wall-clock time vs. LLM inference time; measure sample efficiency

---

### Hypothesis 3: Neurally-Guided DSL Search
**Statement:** A learned DSL (trained on synthetic multi-task data, not ARC-specific) + neural guidance will underperform RL+guidance on v3 but achieve 5–10%.

**Prior:** 35% confident
- **Support:** Strong on v1 (discrete patterns), proven generalization from synthetic data
- **Concerns:** Interactive environments are not naturally a program-synthesis problem; no clear DSL
- **Test:** Prototype DSL primitives for interactive environments; measure coverage

---

### Hypothesis 4: Neuro-Symbolic Causal Reasoning
**Statement:** A system that learns to infer causal structure from observations + reasons symbolically will be more robust to distribution shift than pure RL but requires more engineering.

**Prior:** 25% confident
- **Support:** Aligns with human reasoning; formal guarantees possible
- **Concerns:** No working implementation; learning causal graphs from pixels is hard
- **Test:** Prototype on simplified environments; measure ablations

---

### Ranking by Expected Headroom (in order)

1. **RL+Guidance (Single-Task)** — Highest headroom, most directly suited to the problem
2. **Test-Time Compute Scaling (CoT)** — Proven but hits ceiling on v1; less clear on v3
3. **Neurally-Guided DSL** — Promising if DSL can be found; low if not
4. **Neuro-Symbolic** — Most principled but highest implementation cost
5. **Chain-of-Abstraction** — Most speculative; needs concrete instantiation

---

## Proposed First Experiment: "Efficiency Frontier Mapping"

### Research Question
**Which approach (LLM-CoT search vs. RL+Guidance) has the most headroom on ARC-AGI-3 within reasonable compute budgets (1–4 hours wall-clock per task)?**

### Hypothesis
RL+Guidance will achieve better accuracy-per-compute than test-time LLM scaling because it's optimized for the sequential decision problem, whereas LLM CoT is designed for reasoning over static inputs.

### Experimental Design (Hours, Not Weeks)

**Setup:**
- Select 10 representative environments from ARC-AGI-3 preview set (mix of easy/hard)
- Run 3 approaches in parallel:
  1. **Baseline LLM (no search):** Claude 3.7 or GPT-4.5 zero-shot, no reasoning time
  2. **LLM-CoT Scaling:** Same model with extended thinking, budget 30M tokens per task
  3. **RL+Guidance (Fast):** Lightweight CNN policy trained for 1 hour per task using PPO + dense reward shaping

**Metrics:**
- Primary: RHAE score (accuracy normalized by human baseline actions)
- Secondary: Wall-clock time, token count, GPU hours
- Qualitative: Failure modes (e.g., goal inference vs. planning)

**Success Criteria:**
- RL approach achieves >5% RHAE; LLM-CoT <4%
- RL scales linearly with compute budget; LLM-CoT hits diminishing returns

### Implementation Roadmap
1. **Day 1:** Set up environment access, download preview set, instrument logging
2. **Day 2:** Implement baseline LLM harness; run 10-task evaluation
3. **Day 3:** Deploy LLM-CoT with extended thinking; measure token scaling
4. **Day 4:** Code lightweight RL baseline (ResNet + PPO); first run
5. **Day 5:** Parallel execution, data collection, analysis

**Expected Output:** 
- Accuracy vs. compute curves for each approach
- Ranking of approaches; recommendation for which to scale
- Concrete failure analysis (e.g., "all approaches fail on goal inference for geometry tasks")

---

## Open Questions & Handoff

### For Next Agent to Investigate

1. **What are the learned DSL primitives for interactive environments?**
   - Can we infer a minimal DSL from environment traces (e.g., move, toggle, collect)?
   - Does a learned DSL outperform hand-crafted if trained on 100+ diverse environments?

2. **How does goal inference factorize from planning?**
   - Can we train a separate "goal recognizer" and decouple it from RL?
   - Does explicit goal inference improve sample efficiency?

3. **Scaling laws for RL on novel tasks**
   - Is there a power-law relationship between compute (hours) and task performance?
   - What's the Pareto frontier for accuracy vs. wall-clock time?

4. **Can pretraining help without fine-tuning?**
   - If we train RL on synthetic environments (not ARC-AGI), does it help on real tasks?
   - What properties of synthetic data transfer best?

5. **Leaderboard tracking**
   - As ARC-AGI-3 leaderboard fills, monitor which approaches actually win
   - Do any no-training teams emerge? What do they do differently?

### Refined Open Questions on Methodology

- **"No training" scope:** Does test-time parameter adaptation (like RL gradients on single task) count as "no training"? Rules need clarification.
- **Efficiency definition:** RHAE doesn't directly penalize compute. Should we define "efficient no-training" as <$10/task like ARC-AGI-1?
- **Multi-task scaling:** Can a single policy trained across multiple environments (still no fine-tuning on private tasks) generalize? This is a middle ground.

---

## References & Sources

### Official ARC-AGI Documentation
- [ARC Prize Main Site](https://arcprize.org)
- [ARC-AGI-3 Announcement](https://arcprize.org/blog/arc-agi-3-launch)
- [ARC Prize 2025 Technical Report](https://arxiv.org/abs/2601.10904)
- [ARC-AGI-3 Paper](https://arxiv.org/abs/2603.24621)

### Key Papers on Approaches
- **Test-Time Scaling:** [OpenAI o3 Breakthrough](https://arcprize.org/blog/oai-o3-pub-breakthrough)
- **Neurally-Guided Program Synthesis:** [Towards Efficient Neurally-Guided Program Induction for ARC-AGI](https://arxiv.org/html/2411.17708v1)
- **Execution-Guided Synthesis:** [Out-of-Distribution Generalization in the ARC-AGI Domain](https://arxiv.org/html/2507.15877v2)
- **CompressARC (MDL):** [ARC Prize 2025 Results Analysis](https://arcprize.org/blog/arc-prize-2025-results-analysis)

### Model Performance Benchmarks
- [ARC Prize Leaderboard](https://arcprize.org/leaderboard)
- [ARC-AGI-3 Leaderboard](https://three.arcprize.org/leaderboard)
- [Which AI Reasoning Model is Best?](https://arcprize.org/blog/which-ai-reasoning-model-is-best)

### Survey & Review Articles
- [ARC-AGI 2025: A Research Review](https://lewish.io/posts/arc-agi-2025-research-review)
- [ARC-AGI-3 Preview: 30-Day Learnings](https://arcprize.org/blog/arc-agi-3-preview-30-day-learnings)

---

## Metadata

**Research Conducted:** 2026-04-18  
**Sources Consulted:** 15+ web sources, 5 peer-reviewed papers, 3 official benchmarks  
**Next Review Date:** After Experiment 1 completes (Est. 2026-04-23)  
**Owner:** Research Agent (Test Protocol)
