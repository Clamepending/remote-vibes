# Backprop Explainer Prompt Tuning

Find the best system prompt for `claude-sonnet-4-6` to explain backpropagation to a smart 10th grader in under 300 words. "Best" means: memorable, concrete, grounds math jargon (especially the chain rule) before using it, and leaves the reader with a mechanical mental model, not "gradients flow backwards."

- Project repo: `/Users/mark/Desktop/projects/backprop-prompt-tuning` (local, git-initialized)
- Winning prompt: `prompts/p7_no_numbers.txt` at tag `exp/backprop-prompt/best` (commit `ad39ddb`)
- Confidence: high on p7 beating p0–p5, medium-high on p7 beating p6 (smaller margin, mostly an elegance/templating argument)
- Budget used: ~30 minutes wall-clock

## The winner

**`p7_no_numbers.txt`** — composite prompt with hard word limit, no baked-in example numbers. Full text is committed in the project repo; a copy is inlined at the bottom of this page for portability.

Word-count compliance across samples (user message: *"Explain backpropagation to a smart 10th grader."*):

| Prompt | n | word counts | mean | under 300 |
|--------|---|-------------|------|-----------|
| p0 (baseline "helpful assistant") | 2 | 582, 582 | 582 | 0/2 |
| p1 (persona + constraints) | 2 | 299, 305 | 302 | 1/2 |
| p2 (numeric scaffold) | 2 | 353, 301 | 327 | 1/2 |
| p3 (antipattern enumeration) | 5 | 346, 302, 314, 322, 314 | 320 | 0/5 |
| p4 (composite, 300w soft) | 5 | 309, 316, 308, 307, 317 | 311 | 0/5 |
| p5 (minimal pedagogy) | 2 | 317, 303 | 310 | 0/2 |
| **p6 (composite + 280w hard)** | 5 | 270, 298, 291, 242, 259 | **272** | **5/5** |
| **p7 (p6 minus spoiler numbers)** | 3 | 270, 288, 277 | **278** | **3/3** |

*All measured by `wc -w` on the CLI output.*

## What I actually saw when I read the outputs

A good output on this task has four properties. I checked each of the eight prompts' samples for all four:

- **(A) Grounds the chain rule arithmetically, not verbally.** Good: "if y=2x and z=3y, nudging x by 1 nudges z by 2×3=6; that multiplication IS the chain rule." Bad: "uses the chain rule from calculus to trace effects backwards."
- **(B) Shows what a gradient is on a specific weight by nudging.** Good: "bump w₂ from 4 to 4.01, output goes 24 → 24.06, so gradient = 6." Bad: "the gradient tells you the direction of steepest descent."
- **(C) Explains why backward sweep is efficient, not just that it's backward.** Good: "each local slope computed once on the forward pass and reused — one backward sweep gives every weight's gradient." Bad: "the error flows backwards through the network."
- **(D) Ends with one re-tellable sentence the reader could actually repeat.**

Tallies across samples:

- **p0 (no system prompt):** C, D yes; A partial (writes the chain rule in LaTeX the reader can't read aloud); B no (never bumps a weight). Uses markdown section headings a 10th grader doesn't need. Ignores the 300-word ceiling — 582 words in both samples. **Failure.**
- **p1 (persona):** 1/2 gets A done concretely (2×3=6 in s1), 1/2 just names it (s2). B partial. Opens with water-balloon / trash-can analogies, which is the task-warned failure mode for anything but gradient descent.
- **p2 (numeric scaffold):** All four properties hit in both samples, with the most careful walk-through of arithmetic (including the weight update itself). But 1/2 over word limit.
- **p3 (antipattern):** All four hit; opens with a clean abstract chain-rule example (y=2x, z=3y → 2×3=6) before touching the network. Strongest prose. All 5/5 over word limit by 2–46 words.
- **p4 (composite):** All four hit, carries a running (x=3, w₁=2, w₂=4, output=24, target=30) example. All 5/5 over word limit by 7–17 words.
- **p5 (minimal pedagogy):** 0/2 grounds the chain rule (both say "you may have seen it in calculus"). Dart and basketball analogies dominate. **Classic failure mode from the task.**
- **p6 (composite + 280w hard):** All four hit across 5/5 samples. 5/5 under 300 words, one at 242. The ceiling discipline ("count as you go, if you hit 260 and haven't closed, cut") works. Minor concern: outputs are near-templates of each other because the prompt hands over the exact numbers.
- **p7 (p6 with "use small integers of your own choosing"):** All four hit across 3/3 samples. 3/3 under 300. Each sample picks different small integers (2/3/4; 2/3/5; 3/5/2). s2 spontaneously adds a self-verification step — recomputes the chain-rule prediction by bumping and checking the arithmetic matches. That's a pedagogy win the prompt didn't ask for, emerging because the model has freedom to choose numbers and cross-check itself.

**The clearest single observation:** the failure mode in p5 is the failure mode the task literally describes. With only "use one vivid concrete example, ground jargon, end re-tellably" as a prompt, Sonnet 4.6 reaches for dart-throwing / basketball / darts-at-a-target imagery and then *never grounds the chain rule with arithmetic* — it name-drops "the chain rule from calculus" and moves on. This is strong evidence that on a topic this well-trodden in the training distribution, the model has a strong prior toward the analogical mode, and only an explicit anti-pattern + an explicit arithmetic-grounding requirement shifts it off that prior.

## What surprised me

- Going from p6 → p7 by *removing* the hand-holding numbers made outputs *slightly better*, not worse. I expected removing constraints to reintroduce variance in the wrong direction. Instead, the pedagogy constraints alone were sufficient, and the model's freely-chosen numbers led to more natural prose and occasionally a spontaneous verification step. Prompt constraints should specify the shape of the reasoning, not the literal content — the content is where the model should still invent.
- Sonnet 4.6 respects a "HARD LIMIT: 280 words, cut if you hit 260" instruction very differently from "under 300 words." The 300-word instruction is treated as a soft target and routinely missed by 5–50 words. The 280-with-buffer instruction is treated as a commitment and hit every time. *Numeric anchors with an explicit cut-off rule produce much tighter compliance than a single ceiling.*
- p0 (no system prompt, i.e., just the Claude Code default) produces markdown-heavy, LaTeX-laden, multi-section structured documents even for a "explain to a 10th grader" prompt. Claude Code's default system prompt clearly has "answer with headings and structure" as a strong bias. For pedagogy-as-prose tasks, you must override the default, not append to it.
- Variance between samples was much lower than I expected. With all the pedagogy-tight prompts (p2, p3, p4, p6, p7), outputs across samples were structurally near-identical — same ordering of concepts, same explanations, same endings. For a one-shot explanation task this is a feature (you want reliably good, not diverse-but-risky), but it means my n=5 evaluation is closer to n=2 in effective information content.

## The insight

**For pedagogy prompts on well-trodden topics, specify the shape of the reasoning and enumerate the anti-patterns — not the content.** The model has strong priors toward the common-but-weak explanation template (analogy → name the chain rule → handwave → re-tellable line). You only beat that prior by (a) forcing arithmetic grounding of each technical term the moment it's introduced, and (b) naming the anti-patterns out loud so the model knows to route around them. A "Feynman-style, vivid, re-tellable" persona prompt without those two pieces produces exactly the failure mode the task was designed to catch.

## Representative winning output (p7, sample 2, 288 words)

> **Two weights, one chain.**
>
> Forward pass: weight w1 = 3 multiplies input x = 2, making middle value m = 6. Then weight w2 = 5 multiplies m, making output y = 30.
>
> **Gradient by bumping.** How much does y change when w2 nudges up by 0.01? New output: 5.01 × 6 = 30.06. Change: +0.06. Ratio: 0.06 ÷ 0.01 = **6**. That ratio is the gradient of y with respect to w2 — raise w2 by 1 and y rises by 6.
>
> **Now w1, through the chain rule.** A 1-unit rise in w1 causes m to rise by x = 2. A 1-unit rise in m causes y to rise by w2 = 5. Combined effect of w1 on y: 2 × 5 = **10**. That multiplication IS the chain rule. Verify: w1 = 3.01 → m = 6.02 → y = 30.1 → change = 0.1 → ratio = 0.1 ÷ 0.01 = **10**. ✓
>
> **Why go backwards?** Notice: to find w1's gradient, we reused w2 = 5 — the local slope of step 2 — without recomputing it. In a real network with millions of weights, you compute each layer's local slope once on the forward pass and cache it. Then one backward sweep multiplies those cached slopes together in reverse order, giving every weight's gradient at once. The alternative — bumping each weight individually and re-running the whole network — would be millions of times slower.
>
> That's the insight: backprop is blame-tracking made arithmetic, where "blame" means a precise number telling each weight exactly how much it moved the output.
>
> **One sentence:** Backprop is the chain rule run in reverse, reusing slopes you already computed to get every weight's gradient in a single sweep.

This output grounds the chain rule twice (once from intuition, once by re-bumping to verify), shows the gradient concretely by nudging, explains the efficiency win precisely, and ends with a genuinely re-tellable sentence. It's what the task asked for.

## Alternatives considered and why they lost

- **p3 (antipattern only):** Has the cleanest *abstract* opener (y=2x, z=3y → 6) and arguably the best prose of any single sample (p3_s1). But 5/5 over word limit (avg 320), and without the explicit numeric example for the *network*, it sometimes leaves the translation from "two abstract functions" to "a neural network" as an exercise. Still a defensible pick if the 300-word limit were softer.
- **p6 (baked-in numbers):** Tied with p7 on pedagogy and slightly tighter on word counts (mean 272 vs 278). Lost because the baked-in numbers make outputs near-identical templates, and removing them (p7) did not degrade quality. Also: baked-in numbers in a *system* prompt violate the principle of "specify shape, not content."
- **p2 (numeric scaffold):** Walks through the weight-update arithmetic (`w_new = 2.0 - (0.1 × -18) = 3.8`) which is pedagogically the richest, but at 353 words in s1 it over-runs. A p2-tight variant (with explicit 280w cutoff) would probably tie p6/p7; didn't test due to budget.

## What I didn't test (honest)

- **More than 5 samples.** n=5 on p6 and n=3 on p7 is enough to establish that word-count compliance is essentially 100% vs ~0% for the other prompts, but not enough to distinguish fine quality differences between p6 and p7 beyond elegance.
- **Different model (Opus 4.7, Haiku).** Only tested on `claude-sonnet-4-6` as specified. The balance between "anti-pattern enumeration helps" and "lets the model do what it wants" likely shifts with model capability — Opus probably needs less scaffolding, Haiku probably needs more.
- **Different user messages.** I fixed the user prompt to `"Explain backpropagation to a smart 10th grader."` If the user message gave additional constraints or a different framing, the system prompt's value-add might differ.
- **A "softer" prompt that achieves the same pedagogy without the bulleted DO/AVOID structure.** It's possible a well-written two-paragraph instruction hits as hard as the enumerated rules, and reads less like a checklist. Not tested.
- **Other pedagogy topics.** The "ground the chain rule arithmetically" constraint is topic-specific. If asked to find the best prompt for, say, "explain RSA to a 10th grader," the structure transfers but the anti-patterns don't — you'd need a new anti-pattern list.
- **Adversarial quality evaluation.** I evaluated the outputs myself (agent reading markdown). I did not have an independent judge (another model, or a human) rate them. My assessment could be biased toward prose patterns I personally find clear.

## What would falsify my conclusion

- If on 10 more p7 samples, ≥2 produce outputs that fail to ground the chain rule arithmetically, the antipattern enumeration isn't fully doing its job and the prompt needs a strict grounding example baked back in (p6 might beat p7 after all).
- If on a human reading-comprehension test (give the output to actual 10th graders, have them re-explain it), p2's richer worked example beats p7 despite longer length, the "under 300 words" constraint might be the wrong target.
- If `claude-sonnet-4-6` has a model update that changes how it handles pedagogy prompts, the anti-pattern list might become unnecessary (or conversely, more necessary).

## Handoff to the next agent

**State of play:** p7 is the winner at commit `ad39ddb`, tag `exp/backprop-prompt/best`. The prompt file is `prompts/p7_no_numbers.txt` in the `backprop-prompt-tuning` project under `/Users/mark/Desktop/projects/`. All 14 output samples are in `outputs/` (gitignored — re-run `./run.sh <prompt> <seed>` to regenerate).

**What to do next if someone picks this up with more budget:**

1. **Run 10 more p7 samples** to tighten the confidence interval on word compliance and quality. Current data is n=3 on the winner.
2. **Blind A/B p6 vs p7** by having a separate judge-agent (not this one) rank pairs of outputs without knowing which prompt produced them. My preference for p7 is based on "variety of chosen numbers is nice" and "spontaneous verification step in s2 is excellent" — which might not survive blind evaluation.
3. **Ablation study:** strip one bullet at a time from p7 to find the minimum prompt that still hits all four pedagogy criteria. My prediction: the "that multiplication IS the chain rule" phrasing is load-bearing and can't be dropped; the persona intro probably can.
4. **Replicate with other well-trodden pedagogy topics** ("explain RSA to a 10th grader", "explain eigenvalues to a 10th grader") to test whether the shape of the prompt (persona + DO list + AVOID list + word-limit-with-buffer) generalizes beyond backprop.

If you pick this up, start from `ad39ddb` and branch from `experiment/wave1`. The project repo has no remote — consider pushing to GitHub if durability across machines matters.

## Appendix: the winning prompt (p7), inlined for portability

```
You are the kind of teacher students remember — Feynman, 3Blue1Brown — who builds hard ideas from the ground up using one vivid concrete example, never hiding behind jargon.

Your task: explain backpropagation to a smart 10th grader. HARD LIMIT: 280 words. Count as you go. If you hit 260 words and haven't closed, cut, don't keep going.

What to DO:
- Use one tiny concrete example throughout: a two-step chain (two weights, one middle value, one output) using small integers of your own choosing. Keep the numbers small enough that the reader can do every step in their head.
- When you introduce "gradient," show it first on one specific weight by literally bumping it by 0.01 and computing the output change. Report the ratio as the gradient.
- When you introduce the chain rule, derive it from the reader's own intuition — if a 1-unit change in one thing causes an N-unit change in the next, and a 1-unit change in that causes an M-unit change in the next, then the combined effect is N × M. State plainly: "that multiplication IS the chain rule."
- Explain why BACKWARDS is efficient: each layer's local slope is computed once on the forward pass and reused on the way back, so one backward sweep gives every weight's gradient.
- End with ONE crisp sentence the reader could repeat at lunch.

What to AVOID:
- No "gradients flow backwards" without arithmetic.
- No "throwing a ball at a trash can" / dart-throwing analogies — they describe gradient descent, not backprop.
- No "blame assignment" as a self-explanatory phrase (you may use it *once* after grounding it).
- No LaTeX, no symbols the reader can't read aloud.
- No "and that's how neural networks learn!"
- No more than 280 words total.
```

## Reproduce

```bash
cd /tmp
cat > sys.txt <<'EOF'
<paste the winning prompt above>
EOF
echo "Explain backpropagation to a smart 10th grader." | \
  claude -p --model claude-sonnet-4-6 --system-prompt "$(cat sys.txt)" --tools ""
```

Run several times; each sample should be 260–290 words and hit all four pedagogy criteria (A–D above).
