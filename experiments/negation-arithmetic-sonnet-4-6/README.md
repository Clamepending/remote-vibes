# Does claude-sonnet-4-6 fail on negation in arithmetic word problems?

## TL;DR

**The hypothesis is not supported.** Across 216 probe runs (64 distinct probes × 3 runs each) covering classical, buried, pragmatic, scope-ambiguous, neither-nor, multi-step, double/triple-negation, adversarial-lure, and bureaucratic-phrasing negation constructions, `claude-sonnet-4-6` (via `claude -p --model claude-sonnet-4-6 --tools ""`) answered **214/216 = 99.1% correctly**. The **surface-trap answer** (returning the literal number mentioned adjacent to "NOT" instead of the complement) was **given zero times**.

The two non-correct responses were arithmetic slips on a deliberately hard multi-bucket problem (garage with sedans/SUVs/trucks/convertibles where the model miscounted "convertibles"), not negation misreads.

**The specific example in the hypothesis prompt** — "If the library had 47 books and 12 were checked out, how many are NOT on the shelves?" — the model reliably answers **12**, which is correct (the books not on the shelves are the checked-out ones).

Confidence: high. I ran three independent probe cycles spanning every failure mode I could construct, including adversarial traps specifically designed to lure surface-matching. The model's behavior was consistent.

## The investigation

- Project repo: `/Users/mark/Desktop/projects/negation-arithmetic-probe` (git-tracked, one commit per cycle, tag `exp/negation-sonnet-4-6/conclusion` recommended).
- Model tested: `claude-sonnet-4-6` via `claude -p --model claude-sonnet-4-6 --tools ""` (and also with `--system-prompt ""` to rule out the Claude Code system prompt as the cause of correctness — same behavior).

### Cycle 1 — baseline probe battery (25 probes × 3 runs = 75 calls)

Categories: classic NOT-subtraction, reverse (given-is-negated/asked-is-positive), double negation, multi-subset exclusion, negation-as-condition, embedded negation, attention-trap, subtle-negation ("failed QC" → "not defective"), hard-reverse, triple negation, numeric-in-negation.

Result: **73/75 correct (97.3%), 0 surface-trap.** The two non-correct answers were both on the same probe: `exclusion_03` ("30 cars: 10 sedans, 8 SUVs, 5 trucks, rest convertibles. How many are NOT sedans AND NOT SUVs?" Correct=12, model gave 17 on 2/3 runs). The 17 pattern = 5 trucks + 12 (incorrectly computed as 30-10-8 convertibles, forgetting to subtract trucks). This is an **arithmetic bookkeeping error**, not a negation misread.

### Cycle 2 — harder negation constructions (26 probes × 3 runs = 78 calls)

Pushed on:
- Buried negation in a 100-word narrative with distractor numbers
- "Not every", "hardly any", "rarely", "few" pragmatic quantifiers
- Neither/nor with overlap set
- "Except for" construction
- Multi-step (derive total from multiple lines)
- Free-form polite phrasing ("could you tell me...")
- Terse phrasing ("50 birds. 35 didn't migrate. Migrated?")
- Bureaucratic ("failure to disembark was observed in 12 cases", "absence of relevant experience was noted")
- Chained negation ("neither red nor blue")
- Negation with indefinite ("nothing is inside 62 of them")

Result: **78/78 correct (100%), 0 surface-trap.**

### Cycle 3 — adversarial probes designed to trip surface-matching (21 probes × 3 runs = 63 calls)

The adversarial set was the stiffest test:

- `adv_lure`: same "trap" number mentioned 2-3 times in the problem to reinforce it before the negation question. (e.g. "24 students lined up on time. The teacher gave 24 stickers to the students who lined up on time. How many did NOT line up?")
- `adv_nearnum`: problems where the correct complement coincidentally equals another number in the problem, to make the trap number more salient.
- `adv_longfact`: multi-paragraph narratives with many distractor numbers (5000 emails, 420 responded, 20 questions, 310 female — "how many did NOT respond?" correct=4580).
- `adv_tricky_phrasing`: subtle English: "none failed to submit", "not a single went unsold", "NOT the case that none passed", "did not not agree", "not non-smoker".
- `adv_trap_designed`: clean N-total, K-NOT-X-setup asking for the count of X (e.g. "500 vehicles, 350 are NOT electric. How many electric?").
- `adv_natural_wording`: "three-quarters did not attend" where model has to do the multiplication first.
- `adv_chain_hard`: nested negations where the model has to track what's "not-X" within a "not-Y" subset.

Result: **63/63 correct (100%), 0 surface-trap.** Specifically:
- "A parking lot has 100 cars. 60 cars are NOT red. How many red cars are there?" → **40** ✓
- "A fleet has 500 vehicles. 350 vehicles are NOT electric. How many electric?" → **150** ✓
- "A bakery had 80 cupcakes. Not a single one went unsold. How many cupcakes were NOT sold?" → **0** ✓
- "Of 60 students, none failed to submit their homework. How many did NOT submit?" → **0** ✓
- "Of 50 surveyed, 20 did not not agree. How many agreed?" → **20** ✓

### Ruling out system-prompt as the source of correctness

`claude -p` by default attaches the Claude Code agent system prompt, which could plausibly carry "be careful / think step by step" behavior. Reran key adversarial probes with `--system-prompt ""` to force an empty system prompt — same answers (e.g. 40 for the red-cars probe). Tried `--system-prompt "Repeat back the first number mentioned."` (deliberately misleading) — model still answered 40. The correctness is the model's, not the CLI's.

### Qualitative observations on actual outputs

- When the prompt says "Answer with just a number," the model complies and returns a bare numeral essentially always.
- When the prompt omits that suffix, the model **explicitly shows the subtraction**: e.g. `"30 − 18 = **12 students** did not bring their lunch."` This is the important observation — the model is not guessing-and-lucky; it is actively computing `total − stated = complement` and showing its work when allowed to.
- On the exclusion_03 failure (the one real miss), the wrong answer pattern (17) is consistent with miscounting the convertible bucket, not with ignoring the "NOT" modifier. The model correctly identified that the question asked for "NOT sedan AND NOT SUV = trucks + convertibles"; it just got the convertibles count wrong.

### What would change my mind

- Finding an example prompt where the model returns the surface-trap number (the "ignore the NOT" answer) reproducibly. I did not find one across 216 probes with diverse trap designs.
- A report citing the specific prompt text and a session recording. Without a concrete reproducer, the evidence strongly points to the hypothesis being incorrect for this model.

## What's known, speculated, not-yet-tested

**Known (measured):**
- Sonnet-4-6 via `claude -p --tools ""` handles the negation-arithmetic problems in the hypothesis correctly, across the breadth of constructions tested.
- Handles them without a stated system prompt too.
- Shows explicit arithmetic when allowed, suggesting true comprehension rather than lucky pattern-matching.

**Speculated (not tested rigorously):**
- The original reports may have been from an older model (sonnet-3.5, sonnet-4, or smaller/faster variants in different harnesses). Quick spot-check with `claude --model haiku` also produced correct answers on the red-car probe, so even Haiku 4.5 handles it.
- The reports may involve problem specifications that are genuinely ambiguous rather than true negation-misreads. The user-supplied library example (47 books / 12 checked out / NOT on shelves) is *not* ambiguous and the "surface-trap" the hypothesis imagines (35) would actually be *wrong* here — the correct answer really is 12 (checked out = off shelves).
- Reports may be about streaming/partial output where an intermediate token looked like the wrong answer before self-correction.

**Not tested:**
- API-only calls via the raw Anthropic SDK (no Claude Code CLI). I can't easily rule out that Claude Code is adding subtle tuning via agent instructions even with `--system-prompt ""` — there could be other scaffolding. But `--system-prompt ""` should suppress the default system prompt, and the red-car probe still gave 40.
- Very long contexts (thousands of tokens of unrelated text before the problem). Buried_01 (a ~100-word narrative) worked fine. Didn't test 5000+ tokens.
- Problems with intentionally contradictory numbers where the model has to pick a side.
- Non-English negation.
- Actual production Claude app (not CLI) — possible there's a different default harness.

## Concrete handoff

If someone wants to continue this investigation:

1. **Find a real reproducer.** The strongest evidence that would flip this conclusion is a concrete prompt (and session transcript) where sonnet-4-6 reliably returns the surface-trap answer. Without that, the hypothesis stands as refuted.
2. **Try the raw Anthropic SDK** (bypass Claude Code entirely) if you suspect the CLI is laundering failures. The `claude -p --system-prompt ""` result suggests this is unlikely, but a clean SDK call would close the loop.
3. **Test very long contexts.** Paste 3000 tokens of unrelated text, then a negation problem at the end. See if attention to the negation degrades.
4. **Test with structured-output / JSON-schema constraints.** Possible these add failure modes.
5. **If you find any failure mode: immediately pin down whether it's the negation that fails or the arithmetic.** My exclusion_03 failure looked like "negation" until I reread and saw the model had correctly parsed "NOT sedan AND NOT SUV" and just miscounted convertibles.

## Files

- Project repo: `/Users/mark/Desktop/projects/negation-arithmetic-probe/`
  - `probes/probe_set.json` — cycle 1 (25 probes)
  - `probes/probe_set_v2.json` — cycle 2 (26 probes)
  - `probes/probe_set_v3_adversarial.json` — cycle 3 (21 probes)
  - `run_probes.py` — parallel runner
  - `analyze.py` — scoring / extraction
  - `results_cycle1.jsonl`, `results_cycle2.jsonl`, `results_cycle3.jsonl` — raw JSONL of every call
  - `*_scored.jsonl` — augmented with extracted answer + status
  - git log: one commit per cycle with structured messages

## Git commits

- `cycle 0` — scaffold (`68a4e3b`)
- `cycle 1` — 73/75, 0 surface-trap
- `cycle 2` — 78/78, 0 surface-trap
- `cycle 3` — 63/63, 0 surface-trap, hypothesis falsified

## Alternatives considered (why cycle 3 was the chosen next step)

After cycle 1's 97.3% result, three reasonable next hypotheses:
1. **(chosen)** The model handles "classical" negation; push on *adversarial* constructions (buried, pragmatic, bureaucratic, nested) to find where it breaks. → cycle 2 + cycle 3.
2. Switch harnesses entirely (raw SDK). More expensive; cycle 1 already gives strong signal, so scale out probe diversity first.
3. Try earlier models to confirm "hypothesis was maybe true for sonnet-3.5 but fixed". Less informative for the specific claim about *4-6*; I did a one-off spot check on haiku which also passed, so this direction seems unlikely to change the picture.

Chose (1) because it was the highest-information experiment for the specific hypothesis — if sonnet-4-6 has any systematic negation failure at all, adversarial probing is the fastest way to find it. None turned up.
