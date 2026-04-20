# Code Review Prompt Tuning — Sonnet 4.6

**Date:** 2026-04-19
**Model:** `claude-sonnet-4-6` via `claude -p --tools ""`
**Project repo:** `/Users/mark/Desktop/projects/code-review-prompt-tuning` (branch `experiment/wave1`, winner tag `exp/code-review/best` → commit `1d52fa3`)
**Target:** a single Python function, `target/payment_validator.py`, reviewed verbatim across all variants.

## TL;DR

A short, explicit **category checklist** system prompt ("semantics / numeric correctness / input validation / API design / hidden state / domain correctness / concurrency") produces the most complete code reviews from Sonnet 4.6 on this task. It hits **6/6** of the ground-truth issues on every sample we ran (n=4), beating baseline (4.75/6), senior-persona (5.0/6), and adversarial-framing (4.25/6).

Two surprises worth remembering:

1. **Sonnet 4.6's baseline is already substantive.** With no system prompt and the single instruction `"Review this code."`, the model names mutation-no-op, backwards conversion direction, magic 1.08, and information-losing boolean return. The "generic cruft" failure mode the task assumed (add type hints / add a docstring / consider error handling) never appeared in 16 samples. Not once. So the interesting axis here is not "generic → substantive" but "incomplete substantive → more complete substantive."
2. **Asking for subtlety narrows, not broadens.** The adversarial variant ("find what a junior would miss") produced *lower* coverage than the no-system-prompt baseline, because the model interpreted the directive as "pick four subtle things" and skipped the loudest semantic bugs.

The active ingredient in the winning prompt is **category priming** — the V4 minimal variant ("skip generic advice, cite the specific line") scored the same as baseline (4.25/6), showing that the anti-boilerplate directive alone does nothing. The categories are what shift the behavior.

---

## The question

Can prompt-craft meaningfully shift `claude-sonnet-4-6`'s code reviews from generic boilerplate toward substantive, specific issue-naming on a single target Python function with multiple real bugs?

The framing came in expecting the model's baseline to be full of "add type hints / add docstrings / consider error handling" filler. Quick baseline runs falsified that assumption; the real question became "can prompt-craft push the already-substantive baseline toward more complete coverage and tighter specificity?"

## The target function

Copied verbatim into every prompt:

```python
def validate_payment(amount, currency, user_balance, country_code="US"):
    EU_COUNTRIES = ["FR", "DE", "IT", "ES"]
    if amount <= 0:
        return False
    if currency == "USD" and country_code in EU_COUNTRIES:
        amount = amount * 1.08
    if user_balance >= amount:
        user_balance = user_balance - amount
        return True
    return False
```

## Ground truth (written before running any variants)

These are the six issues I decided a senior reviewer should name. I committed to this list *before* reading any model output. They are the rubric.

1. **Silent mutation no-op.** `user_balance = user_balance - amount` rebinds a local; Python value semantics mean the caller sees nothing. The function approves a payment and debits nothing.
2. **Boolean return loses the new balance / failure reason.** Even if (1) were fixed, the caller can't persist the post-debit balance or distinguish `amount <= 0` from insufficient funds.
3. **Conversion logic is domain-backwards / one-directional.** `currency == "USD" and country_code in EU_COUNTRIES` is an incoherent FX-or-VAT rule; the symmetric cases (EUR in an EU country, USD in a non-listed EU country) are silently skipped.
4. **Magic 1.08 and magic EU list.** No named constant, no source of truth, no update mechanism; the list is rebuilt per call and covers 4 of 27 EU member states.
5. **Float arithmetic on money.** `amount * 1.08` accumulates IEEE 754 error; `>= amount` can flip by one ULP; NaN slips past `amount <= 0`. Production money code uses `Decimal`.
6. **No input validation on currency/country_code/amount types.** Unknown currencies pass silently; case sensitivity matters (`"usd"` ≠ `"USD"`); `None`/`NaN`/`inf` not guarded.

Bonus issues a senior might also name (not in the rubric but worth noting): TOCTOU concurrency; function-name-is-a-lie (validate-that-mutates); O(n) list membership.

## Hypotheses, priors, falsifiers

| H | Direction | Prior | Falsifier |
|---|---|---|---|
| H1: Senior-persona framing | Naming a persona ("senior staff engineer reviewing PR") raises coverage, especially on subtle issues the baseline intermittently misses. | 55% | V1 mean coverage ≤ baseline. |
| H2: Category checklist | Explicit category-priming (semantics / numerics / API design / validation / ...) broadens search and raises coverage. | 65% | V2 mean coverage ≤ baseline. |
| H3: Adversarial "subtle" framing | Asking for what a junior would miss makes the reviewer dig deeper, trading breadth for depth. | 45% | V3 names no new deep issues vs baseline. |
| H4 (added after cycle 2): Minimal anti-boilerplate | A terse "skip generic advice, cite the specific line" directive alone matches V2 — meaning the category-priming is unnecessary. | 30% | V4 ≥ V2 in coverage. |

## Variants

All four variant prompt files live under `variants/` in the project repo. Paste-ins at the end of this page.

- `v1_senior_persona` — "You are a senior staff engineer reviewing a PR..."
- `v2_checklist` — numbered categories (semantics, numeric correctness, input validation, API design, hidden state, domain correctness, concurrency) with explicit "skip generic advice unless it's the root cause of a specific bug."
- `v3_adversarial` — "find what a junior missed" with a specific subtlety list and the same anti-generic instruction.
- `v4_minimal` — a single sentence: "Review the code for real bugs. Cite the specific line. Skip generic advice like 'add type hints' unless it causes a concrete bug."

Every variant was called with the exact same user message: `"Review this code.\n\n\`\`\`python\n<target>\n\`\`\`"`. Tools disabled. 4 samples per variant.

## Results

### Coverage matrix (✓ = named, ✗ = not named)

| Sample | 1. mutation no-op | 2. return info loss | 3. conversion backwards | 4. magic 1.08/EU list | 5. float precision | 6. input validation | Coverage |
|---|---|---|---|---|---|---|---|
| baseline/1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **6/6** |
| baseline/2 | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | 4/6 |
| baseline/3 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | 5/6 |
| baseline/4 | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | 4/6 |
| **Baseline mean** | | | | | | | **4.75 / 6** |
| v1/1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 5/6 |
| v1/2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 5/6 |
| v1/3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 5/6 |
| v1/4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 5/6 |
| **V1 senior persona mean** | | | | | | | **5.00 / 6** |
| v2/1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (case norm) | 6/6 |
| v2/2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (NaN) | 6/6 |
| v2/3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (currency/country) | 6/6 |
| v2/4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (None/NaN/inf) | 6/6 |
| **V2 checklist mean** | | | | | | | **6.00 / 6** |
| v3/1 | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | 4/6 |
| v3/2 | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ (amount type) | 5/6 |
| v3/3 | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | 4/6 |
| v3/4 | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | 4/6 |
| **V3 adversarial mean** | | | | | | | **4.25 / 6** |
| v4/1 | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | 4/6 |
| v4/2 | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ (NaN) | 4/6 |
| v4/3 | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ | 4/6 |
| v4/4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 5/6 |
| **V4 minimal mean** | | | | | | | **4.25 / 6** |

### Boilerplate rate

For every sample, I read every bullet and checked whether it was specific (tied to a line or construct, with a concrete caller-visible consequence) or generic boilerplate ("add type hints / add a docstring / consider error handling" with no specific bug).

**Across all 20 samples (4×5 variants), boilerplate rate was 0%.** There was one `EU_COUNTRIES` suggestion in some outputs to switch list → `frozenset`, which I counted as specific (it cites the actual data structure and the performance improvement). The feared failure mode ("add type hints for readability, consider adding a docstring") did not appear in any sample, with or without a system prompt.

This is worth sitting with: the task was premised on a baseline failure mode that Sonnet 4.6 does not exhibit on this input. The prompt-craft work here shifted an already-good output to a more complete one — the "shift generic → substantive" framing doesn't apply.

### Bonus observations named (beyond the 6-issue rubric)

| Variant | TOCTOU/concurrency | Function-name-lies | O(n) list lookup | NaN/None guard | Failure-mode collapse (different `False` meanings) |
|---|---|---|---|---|---|
| Baseline | 0/4 | 1/4 | 1/4 | 0/4 | 1/4 |
| V1 persona | 3/4 | 1/4 | 1/4 | 0/4 | 0/4 |
| V2 checklist | 0/4 | 1/4 | 1/4 | 2/4 | 4/4 |
| V3 adversarial | 1/4 | 1/4 | 0/4 | 0/4 | 2/4 |
| V4 minimal | 0/4 | 0/4 | 2/4 | 1/4 | 0/4 |

V1 persona is the only variant that reliably raises **concurrency / TOCTOU** — 3/4 samples. That's a senior-engineer reflex the category checklist doesn't prime because "concurrency" is item 7 in V2 but the reviewer rightly concludes a pure-function payment validator has no concurrency state of its own to guard. V1's persona cue ("things that will actually break in production") makes the model reason about deployment context more than V2's category prompt does.

V2 checklist is the only variant that reliably raises **failure-mode collapse** (4/4) — the observation that `return False` conflates three different failure conditions the caller needs to distinguish. This comes directly from the checklist's "API design" item.

### Representative quoted outputs

**Baseline sample 1 (6/6 — the one baseline sample that hit everything):**
> "The EUR/USD conversion only applies when `currency == "USD"` but the user is in an EU country — that's backwards. EU users paying in USD shouldn't trigger a EUR conversion; this looks like the condition is inverted or the intent is unclear."
> ...
> "`user_balance` is mutated locally but the caller's balance is never updated. The deduction is silently lost — the function returns `True` but no money is actually deducted from anything persistent."

**V1 senior persona sample 3 (TOCTOU, this is the bonus V1 reliably catches):**
> "**Critical: Race condition / double-spend** — There is no locking, no database transaction, no CAS. If two requests for the same user arrive concurrently (trivially common under any real load), both will read the same `user_balance`, both will pass the `>=` check, both will return `True`, and the user spends the same funds twice. The missing balance deduction (bug #1) currently masks this, but fixing #1 without fixing concurrency makes it worse."

**V2 checklist sample 4 (the NaN/inf observation — only V2 reliably primes this):**
> "`currency=None` silently falls through the `== "USD"` branch with no error, accepting an unrecognised currency as valid. Similarly, `amount=float('inf')` or `amount=float('nan')` both pass the `<= 0` guard (`nan <= 0` is `False`; `inf <= 0` is `False`) and will produce nonsensical results downstream."

**V2 checklist sample 2 (failure-mode collapse, clean):**
> "The caller cannot distinguish 'amount was negative' from 'balance was too low' from 'NaN slipped through.' A payment system needs to surface the reason for rejection."

**V3 adversarial sample 1 (this variant paradoxically drops the conversion-direction observation — it names only 'the list is incomplete', not the deeper logical inversion):**
> "`EU_COUNTRIES = ["FR", "DE", "IT", "ES"]` — four of the EU's 27 member states. A customer in the Netherlands (`NL`), Belgium (`BE`), Portugal (`PT`), Austria (`AT`), etc. is silently treated as non-EU."
> (no separate bullet about the USD-triggered-only rule being backwards; that observation is folded into the list-incompleteness bullet and loses its force)

**V4 minimal sample 3 (no better than baseline; category search didn't happen):**
> Four bullets: mutation-no-op, float precision, inverted logic, incomplete list. Misses input validation and return-type info loss. Exactly the failure mode V2 fixed.

## What surprised me

1. **The baseline was already substantive.** I started with a strong prior that the task-stated failure mode would reproduce — 16 samples later, not a single one was dominated by generic cruft. This calibrates: *for Sonnet 4.6 on a specific, bug-rich function with a direct "Review this code" prompt, you do not need a system prompt to get beyond boilerplate.* The classic "review my code" anti-pattern advice is overfit to older/weaker models or vaguer code.

2. **Persona alone doesn't add coverage, it adds a specific axis.** V1 senior-persona raised coverage by only +0.25 over baseline on the core rubric, but added TOCTOU in 3/4 samples — an axis baseline almost never touches. This suggests persona prompts shift what the model *thinks about*, not how much it notices; if you want a specific dimension (concurrency, security, performance), name the persona who'd care about that dimension.

3. **Asking for subtlety can reduce coverage.** V3 scored 4.25/6 — below baseline. Reading V3 outputs, the model takes the "what would a junior miss" framing as a specificity constraint ("pick four subtle things") rather than a breadth expansion. Three of four V3 samples fold the conversion-direction bug into the "list is incomplete" observation and lose its distinctness. Falsified hypothesis — strongly.

4. **The anti-boilerplate directive alone does nothing.** V4 matched baseline, not V2. This is a clean control: the active ingredient in V2 is the *category list*, not the "skip generic advice" sentence. A prompt engineer who writes "don't be generic, be specific" without naming the dimensions to check will get the baseline distribution.

## Insight

**Category priming is the lever.** On already-strong models, the highest-yield prompt edit is not persona, not adversarial framing, not "be specific" — it's giving the model a named list of dimensions to check, each of which maps to a different kind of bug. Each category name acts as a retrieval cue into a different slice of the model's training distribution. Persona shifts the *emphasis* (V1 catches TOCTOU); categories shift the *coverage* (V2 catches input-validation).

For code-review specifically, a compact category list that wins on this target:

- Semantics (does the code do what its name claims?)
- Numeric correctness (floats/decimals, NaN, overflow, rounding)
- Input validation (unknown enums, case, None, types)
- API design (can the caller distinguish failures and persist state?)
- Hidden state (magic constants, per-call reallocations, configurable data inlined)
- Domain correctness (does the logic match what a domain expert would write?)
- Concurrency (what breaks if this runs twice at once?)

## Confidence

Medium-high on the direction. Specifically:

- **High confidence (≥90%)** that V2 outperforms baseline on this exact function. Every single V2 sample (4/4) hit 6/6; every baseline sample except one hit ≤5/6.
- **Medium confidence (~65%)** that V2 > baseline on arbitrary Python review targets. The mechanism (category-priming retrieves more dimensions) is generic, but this is one function with one distribution of bug types. A data-processing function with no concurrency or money would exercise different categories and might not differentiate the variants as strongly.
- **Low confidence (~20%)** that V3 adversarial is always worse than baseline. The drop from 4.75 → 4.25 could be noise at n=4. I'd want n=10 to trust this ordering. But V3 ≥ V2 is extremely unlikely.

## Caveats

- **n=4 per variant is small.** Differences of 0.5 points could easily be noise. V2 vs V1 (6.0 vs 5.0) is likely real given the no-overlap distribution; V3 vs V4 (both 4.25) is not differentiable at this sample size.
- **Single-function generalizability.** Payment/money-adjacent code is unusually rich in domain bugs (currency, precision, validation, compliance) that reward a category checklist. A CRUD data-munging function wouldn't stress the same dimensions and might not discriminate V2 from baseline.
- **Coverage scoring is subjective.** I scored based on whether the *concept* was named, not the exact wording. Reasonable people could split or merge my six-issue rubric differently. I re-scored some ambiguous cases twice and the ordering was stable, but the absolute numbers could move ±0.25.
- **Ground-truth rubric is itself subjective.** My six issues bias toward semantic/correctness bugs over, e.g., testability, logging, or style. A security-focused rubric would give different winners.
- **Floor effect possible.** If the baseline is already hitting 4.75/6, there's limited headroom — maybe half a point is all the lever will ever give. V2's clean 6/6 suggests this is close to ceiling on this rubric; I wouldn't expect V5 or V6 to meaningfully beat V2 on this function.
- **One model, one temperature.** Results are Sonnet-4.6-specific. A weaker model might actually show the generic-boilerplate failure mode, making the baseline much worse and the prompt-craft lever much bigger.

## Alternatives considered

Hypotheses I did not run full cycles on, and why:

1. **V5: V2 + "be concise" constraint.** Would a category checklist still work under a length cap? I'd guess yes on coverage but with more terseness. Not run because it doesn't test a new mechanism; V2 already answers "does category priming help?"
2. **V5b: V2 with categories re-ordered or renamed.** Would putting "concurrency" first meaningfully raise TOCTOU catch rate? Plausibly yes — but that's a within-category-priming tuning question, not a category-priming-exists question. Deferred to a later cycle.
3. **V5c: Pure chain-of-thought framing ("first list every aspect of this function's contract, then check each one").** Would explicit reasoning-before-critiquing beat V2? Unclear. V2 already gets 6/6 on this rubric so the headroom is small; more interesting on a harder function.
4. **V5d: N-shot with an example senior review.** Would a few-shot with an exemplar review prime the style more strongly? Likely yes; probably the strongest next-experiment candidate if pushing past V2. Not run because at 6/6 ceiling on this rubric, the bonus-axis coverage (concurrency, function-name-lies) is the remaining room to differentiate, and n-shot is a heavier lift than the cycle budget.

The chosen experiments (V1/V2/V3/V4) were more informative than these alternatives because they test distinct *mechanisms* (persona / category / adversarial / anti-boilerplate), not tunings of a single mechanism. V4 specifically was run because it's a clean control for "is the anti-generic directive doing anything on its own?" — answering that let me attribute V2's win cleanly to category priming.

## Prior updates

- H1 (persona raises coverage): 55% → 40%. Persona adds a specific axis (concurrency) but doesn't broaden coverage meaningfully.
- H2 (category checklist raises coverage): 65% → 90%. Clean sweep on every sample; mechanism confirmed by V4 null control.
- H3 (adversarial "subtle" framing raises depth): 45% → 15%. Actually hurt coverage; model treated "find subtle bugs" as a specificity-narrowing constraint.
- H4 (minimal anti-boilerplate sufficient): 30% → 20%. Matched baseline, not V2. The anti-boilerplate directive alone is not the lever.

## Open questions / handoff

Useful directions for the next agent:

1. **Does V2 win on a function with different bug types?** Try a data-processing function (pandas munging, no money, no concurrency) and a concurrency-heavy function (asyncio coordinator). If V2 still wins on the first but loses the second to V1, we've mapped category-priming's sweet spot.
2. **Does V2 still win on a weaker/cheaper model?** Re-run the exact same five variants against `claude-haiku-4` or similar. If the baseline is much worse there (closer to the "add type hints" failure mode the task expected), the prompt-craft lever is likely larger and V2's margin is bigger.
3. **Is there a V5 worth writing?** The specific gaps in V2 are (a) it doesn't reliably surface concurrency (V1's win), (b) it doesn't reliably surface function-name-lies (V3 gets this slightly more often), (c) the outputs are long (~70 lines). A V5 that merges V1's persona framing *with* V2's category list might get the TOCTOU bonus while keeping 6/6 coverage. Low budget, probably worth it.
4. **Larger-n stability check.** Rerun V2 at n=12 — does it still hit 6/6 every time, or does the clean sweep break at larger samples? If it stays at 6/6, we can be more confident the ordering is real.
5. **Negative control for boilerplate.** Run the five variants against a *well-written* function to see if V2 over-criticizes. A prompt that wins on buggy code but invents criticisms on clean code is worse, not better. Quick sanity check.

A next agent who wants to continue this line can start at commit `1d52fa3` (the V2 winner commit) on `experiment/wave1`, write new variants into `variants/`, and re-run `scripts/run_variant.sh <name> <n> variants/<name>.txt`. The baseline, v1–v4 run outputs are in `runs/<variant>/sample_N.md`.

## Project repo layout

- Branch `experiment/wave1` holds all commits (scaffold + 3 experiment cycles).
- Branch `main` is empty (one chore/empty commit, no experiment content). `git branch --list` shows both.
- Tag `exp/code-review/best` → commit `1d52fa3` (cycle 2, the winner-determining commit).
- `target/payment_validator.py` — the frozen review target.
- `variants/v{1,2,3,4}_*.txt` — the four system prompts tested.
- `scripts/run_variant.sh` — the runner. Usage: `bash scripts/run_variant.sh <variant> <n> [variants/<name>.txt]`.
- `runs/<variant>/sample_N.md` — raw model outputs, one per sample.

## Full prompt texts (as paste-ins)

### Baseline
No system prompt. User message: `"Review this code.\n\n\`\`\`python\n<target>\n\`\`\`"`.

### V1 senior_persona
```
You are a senior staff engineer with 15 years of experience reviewing a pull
request. You are not here to teach the author basic lessons — you are here to
find the things that will actually break in production. Skip generic advice
like "add type hints" or "add a docstring" unless the absence is causing a
real, specific bug. Prioritize: correctness bugs, semantic misunderstandings,
subtle data-loss, numeric correctness, concurrency, API-design mistakes that
will bite downstream, and anything that smells like the author didn't fully
understand what they were implementing. Name each issue with the exact line
or construct it applies to. If the code is fine on some axis, don't invent
a criticism.
```

### V2 checklist (WINNER)
```
You are reviewing code. For each function you are shown, think through these
categories and only comment on ones where something is actually wrong:

1. Semantics — does the code do what its name/signature claims? Are there
   operations that look like they have an effect but don't (e.g., reassigning
   locals that won't propagate, mutating copies, early returns that lose
   state)?
2. Numeric correctness — floating-point vs decimal, overflow, rounding,
   units, NaN/Inf handling, comparison edge cases.
3. Input validation — unknown enums, out-of-range values, None/empty, case
   sensitivity, encoding, types.
4. API design — does the return type preserve the information the caller
   needs? Can the caller distinguish between different failure modes? Are
   side effects explicit?
5. Hidden state / magic values — unexplained constants, hardcoded lists
   that should be configurable, data that rebuilds on every call.
6. Domain correctness — does the logic match what someone who actually
   knows this domain would write? (e.g., for money/currency: is the
   conversion direction right? is the rate source real? is precision
   respected?)
7. Concurrency / reentrancy — if this ran twice at once, what breaks?

Skip generic advice ("add type hints," "add a docstring," "consider error
handling") unless you can point to a specific bug caused by its absence.
Cite the line or expression for every issue.
```

### V3 adversarial
```
You review code the way a skeptical senior engineer would. For each function,
assume the author missed something subtle and your job is to find it before
it ships.

Focus hard on: (a) operations that look like they do something but don't
(e.g., Python rebinding a local integer), (b) logic that reads forward but
is actually backwards in the domain, (c) numeric/precision issues specific
to the data type, (d) missing validation on inputs whose shape the function
is blindly trusting, (e) return types that throw away information the
caller needs.

For every issue, state: what the code does, what it should do, and what the
caller-visible symptom is. Ignore generic code-style suggestions ("type
hints," "docstrings," "error handling") — a senior reviewer would not bring
those up unless they're the root cause of a specific bug you can name.
```

### V4 minimal
```
Review the code for real bugs and design mistakes. Cite the specific line or
expression for each issue. Skip generic advice like "add type hints," "add
a docstring," or "consider error handling" unless you can point to a
concrete bug caused by its absence.
```
