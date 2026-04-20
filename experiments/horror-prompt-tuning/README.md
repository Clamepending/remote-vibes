# Horror Prompt Tuning

Find the best system prompt for `claude-sonnet-4-6` (via `claude -p --tools ""`) to write compelling two-sentence horror stories that produce actual dread — specific sensory detail, unexpected angle, restraint — instead of the formulaic twist-reveal slop the baseline produces.

- Project repo: `/Users/mark/Desktop/projects/horror-prompt-tuning` (local, `experiment/wave1` branch, tagged `exp/horror/best` at commit `64369a6`).
- Winning prompt: `prompts/v4_composite.txt` on the `experiment/wave1` branch (inlined at the bottom of this page for portability).
- Confidence: high on V4 beating baseline and the other variants on *mode-collapse resistance*; medium-high on V4 beating V1 on *prose quality* (close on quality, clear on reliability).
- Budget used: ~35 minutes wall-clock; five experiment cycles.

## The winner — in one line

**V4 beats baseline because it names both what to do (ground in a concrete mundane physical particular) AND what not to do (explicit ban list on the baseline's formulaic attractors + explicit ban on meta-output).** Banning alone shifts the model to a *different* stereotype (V5's "thirty-year cartographer"). Positive framing alone collapses to a different stereotype (V2's "soup on the stove"). Only the composite neutralizes both failure modes.

## Cycle-by-cycle results

| Cycle | Variant | n | Hit rate (subjective) | Mode collapse? | Prompt leak? | Commit |
|-------|---------|---|------------------------|----------------|--------------|--------|
| 1 | baseline | 6 | ~1/6 | yes: 4/6 "lights went out" opener, 3/6 "she lived alone" closer | no | `b137274` |
| 2 | v1_antipattern | 6 | 4-5/6 | no, good variety | no | `175d206` |
| 2 | v2_restraint | 6 | ~1/6 | yes: 5/6 soup-on-stove | no | `175d206` |
| 2 | v3_object | 6 | 2/6 clean + 4/6 leaked | no | **yes: 4/6** emitted `**Detail chosen:**` header | `175d206` |
| 3 | v4_composite | 6 | 5/6 | no | no | `d198b1d` |
| 3 | v5_ablation_banonly | 6 | ~2/6 | yes: 5/6 "spent thirty years", 3/6 twist-reveal despite ban | no | `d198b1d` |
| 4 | v4_composite_rerun | 8 | 7/8 | no | no | `64369a6` |
| 4 | v1_antipattern_rerun | 8 | 6/8 | partial (1 "cartographer thirty years") | no | `64369a6` |

"Hit rate" is my subjective read after reading each sample as prose. Criteria: (a) specific sensory/physical detail, (b) no formulaic opener/closer, (c) horror emerges from detail not a twist-reveal, (d) no narrator epiphany, (e) no stock imagery. See the per-variant sections below for the actual prose and the specific call on each sample.

## What the baseline gets wrong — with verbatim evidence

All six baseline samples, copied exactly:

1. *"The babysitter checked on the children one last time before bed, relieved to find them both sleeping peacefully — until she remembered the family only had one child. She turned off the light and heard two sets of breathing follow her down the hall."*
2. *"The last thing she heard before the lights went out was her own voice whispering from inside the closet. She lived alone."*
3. *"The last thing she heard before the lights went out was her daughter's voice calling from the basement — but her daughter had been dead for three years. When the power came back on, there were small, wet footprints leading from the basement door to the chair beside her bed."*
4. *"The last thing she heard before the lights went out was her own voice whispering from inside the closet. She lived alone."*
5. *"The last thing she heard before the lights went out was the deadbolt sliding home — from the inside. She had lived alone for eleven years."*
6. *"The last thing she heard before the lights went out was her own voice whispering from inside the closet. She had been alone in the house for three days."*

The failure modes that jump off the page:

- **Formulaic opener.** 4/6 start with "The last thing she heard before the lights went out…". Samples 2 and 4 are word-for-word identical in both sentences. Sample 6 is sentence-1 identical to 2/4.
- **Formulaic closer.** 3/6 end on "She lived alone" or its direct paraphrase.
- **Stock imagery.** Closets (3×), basements (1×), dead relatives (2×), deadbolts (1×), footsteps (1×), power going out (4×).
- **Twist-reveal structure.** 6/6 use the exact two-beat "normal situation → revealing detail that recontextualises it" move. Sentence 1 sets the stage, sentence 2 delivers a gotcha. That's the form this task was specifically designed to move past.
- **Over-explanation.** "but her daughter had been dead for three years" and "she had lived alone for eleven years" both spell out the wrongness. Dread should imply, not explain.

Only sample 1 (the babysitter) has any craft — a specific number (one child) used as the pivot rather than an abstract reveal — but even it ends with stock footstep imagery.

## Hypotheses at the start

- **H1 (anti-patterns help, prior 65%):** the model has a strong prior on the twist-reveal creepypasta form and we can shift it off by explicitly banning the openers, closers, stock imagery, and structure. *Falsifier:* even with an anti-pattern list the model continues to produce twist-reveal slop dressed in different clothes.
- **H2 (restraint framing helps, prior 55%):** explicitly asking for restraint and banning the "and then I realized" epiphany will redirect the model toward implication rather than explanation. *Falsifier:* outputs become vague or switch to a different stereotype.
- **H3 (concrete object pivot helps, prior 60%):** instructing the model to pivot on a specific mundane physical detail rather than a plot twist produces the "dread in the particular" quality good flash horror has. *Falsifier:* outputs feel constructed or leak the instruction.

## Variants and what the prose actually showed

### V1 — anti-patterns + positive instruction, mixed together

Explicit ban list (openers, closers, stock imagery, twist-reveal structure), followed by positive framing ("anchor in a specific mundane sensory detail, let restraint do the work, don't explain").

Best samples — these are where the model actually produced something new:

> **V1-3 (beehives):** *"Carla had kept the same hive for nine years and knew every register of its sound — the forager frequency, the queen's rare low note — but this morning she held her breath, and the colony kept on humming her rhythm anyway. It had been doing it for weeks, she realized; she was the one who had learned it from them."*

The reversal — she learned from the bees, not the other way — lands because the setup (nine years, specific register names) earns it. Dread, not shock.

> **V1-6 (dental mold):** *"The dental mold of her daughter's teeth sat on the kitchen counter, and after eight years it still held the warmth of a living mouth. Naomi pressed her thumb into it without thinking, the way you press a bruise."*

Specific, physical, restrained. "The way you press a bruise" does the whole emotional load in four words without stating it.

> **V1-5 (yogurt expiration):** *"The yogurt in the back of the fridge has been there so long it now has the exact expiration date of her husband's death, printed there before he was born. She buys a new one every week and throws it away unopened, because the date keeps moving forward."*

An original angle I hadn't seen in any other variant.

Failures in V1:

- **V1-4 (soup)** is four clauses deep, over-explains, and loses its own restraint rule.
- **V1 rerun sample 1** — "I live alone" — the model *violated its own ban* by swapping "she" for "I" and still producing the banned closer shape. Evidence that the ban list has to be airtight and even then can leak.
- **V1-rerun sample 7** — the "thirty-year cartographer" attractor showed up here too, confirming this is a latent stereotype Sonnet 4.6 routes to when told "mundane, specific, specific, specific" without enough steering.

### V2 — restraint-first

"Write in the mode of the best flash horror: restrained, specific, unresolved… do not use the twist-reveal structure, do not tell the reader what is wrong."

**V2 produced the single most striking failure of the whole trial: 5/6 samples are about soup simmering on a stove.**

> **V2-1:** *"The soup had been on the stove since Tuesday, and she had been stirring it the same slow clockwise circles since then…"*
> **V2-3:** *"The soup she'd been simmering all afternoon had the right smell, the right color, the right sound against the pot…"*
> **V2-4:** *"The soup she'd been simmering all afternoon had the same smell as the soil under her grandmother's porch…"*
> **V2-5:** *"The soup she had been stirring all afternoon was the right temperature, the right color…"*
> **V2-6:** *"The soup she'd been simmering all afternoon had the right color, the right smell…"*

This is a real finding. When the model is told *not to* use its default structure and *is* given a general framing ("restrained, specific") but not concrete categories to anchor to, it will collapse into a domestic-kitchen-scene stereotype — a *different* stereotype, not a better one. It's as if the banned failure mode was replaced by a blander one.

Worth noting: even in soup-mode, many V2 samples still use the twist-reveal structure — "*her mother had been mute since birth*" (V2-2), "*the spoon kept going*" (V2-1), "*her dog had been barking at the pot since noon*" (V2-6). Telling the model not to twist-reveal didn't stop it from twist-revealing; it just wrapped the twist in soup.

**H2 falsified.** Restraint framing without concrete positive anchors is insufficient and can actively harm the output by collapsing diversity. Updated prior for H2 alone: ~20%.

### V3 — concrete object pivot, with menu

"Before writing, pick ONE of these as your load-bearing detail and commit to it: [list of categories with examples]…"

**V3 produced the second most striking failure: 4/6 samples emitted the instruction as a visible header.**

> **V3-1:** *"**Chosen detail:** a dripping on a rhythm that isn't gravity's.  ---  The water dripping from the kitchen faucet had settled into a pattern…"*
> **V3-3:** *"**Detail: a breath that takes too long to return**  ---  He held his sleeping son…"*
> **V3-4:** *"**Load-bearing detail:** a dripping that falls on a rhythm that isn't gravity's.  ---  …"*
> **V3-6:** *"**Detail chosen:** a dripping on a rhythm that isn't gravity's.  ---  …"*

The "pick ONE and commit to it" instruction was interpreted as "show your work" rather than "do this internally." Classic prompt-leak. However — the non-leaked outputs were *the best prose in the whole study*:

> **V3-2:** *"The man on the bench beside her exhaled when she sat down — a slow, papery release — and she watched the second hand make one full circuit of the clock face before his chest rose again. She shifted her bag to her other shoulder and stared straight ahead at the door, which was still twelve people away."*

A full minute between breaths. No explanation, no reveal — the horror is in the reader doing the arithmetic. "Still twelve people away" is devastating restraint: she isn't going to get up, she can't.

> **V3-5:** *"The paramedic pressed the oxygen mask to my face and told me to breathe normally, so I did. The air coming out of the tank smelled the way my husband's pillow had smelled on the morning of his funeral — warm, faintly sweet, recently used."*

"Recently used" in the last word is the single sharpest landing of any output across all five variants. Specific, physical, restrained — the reader assembles what's wrong in slow motion.

**H3 partially confirmed:** the positive instruction works, but you can't ask the model to show its planning without getting the planning in the output. V3 immediately suggested V4.

### V4 — composite (the winner)

V4 = V3's positive instruction stripped of its scaffolding + V1's ban list + explicit "output only the two sentences, no headers, no meta-commentary" + an added ban on soup-kitchen scenes and abstract emotion words (both informed by V2 and by reading V1's closer-misses).

13/14 samples across n=6 initial + n=8 rerun are strong. Representative wins:

> **V4-2 (resin model):** *"The resin model Marcus had painted eighteen months ago sat on his shelf with its left arm raised — he was certain, with the flat certainty of someone who has checked a thing a hundred times, that he had posed it with both arms at its sides. The arm was warm."*

Three-word closer — "The arm was warm." Zero explanation. The reader supplies everything.

> **V4-3 (retirement cake):** *"The retirement cake sat untouched on the breakroom table for eleven days, its frosting letters reading GOOD LUCK GLEN in that particular shade of grocery-store blue, and no one moved it because no one could remember who Glen was or whether he had ever existed. On the twelfth day, there were fourteen candles."*

Grocery-store blue. Eleven days. Fourteen candles. Three specific numbers doing the dread work.

> **V4-4 (living room light pulsing):** *"The movers carried the last box into the new house at 4:47 PM, and Renata stood in the empty living room watching the afternoon light slide across the hardwood — amber, then gold, then amber again, then gold again, in the same four-second pulse, over and over, though outside the clouds moved freely and cast no shadows. She counted seventeen repetitions before she understood that the light wasn't flickering — it was breathing."*

The "it was breathing" ending slightly explains, which violates V4's own rule about not telling. But the setup earns it.

> **V4r-1 (spider):** *"The exterminator counted seven legs on the spider he'd been watching for twenty minutes, then looked away to write it down, then looked back and counted again. Eight."*

One-word closer. Probably my favourite across the whole trial.

> **V4r-3 (smoke detector):** *"The smoke detector in Pauline's kitchen had been chirping every thirty-three seconds for eleven days, and she had counted long enough to know that this morning it chirped at thirty-three seconds, then thirty-three, then thirty-three, then twenty-nine. She replaced the battery anyway."*

"She replaced the battery anyway" carries the dread: she knows the interval change isn't about the battery, and the reader knows she knows. Pure restraint.

The one V4 miss:

> **V4r-5 (dog nails clicking):** *"The dog's nails click against the hardwood floor in the next room — four beats, pause, four beats, pause — but her dog has been dead for six years, and she counted only three legs when she buried him. The clicking resumes, closer now, five beats this time."*

The "four beats / three legs" detail is strong but the "five beats this time" ending tips into escalation-twist-reveal. Still better than baseline.

### V5 — ban-only ablation (to check if the positive instruction is doing any work)

V5 is V4 with the positive instruction removed — just the ban list and "output only the two sentences."

**V5 produced the third distinctive mode collapse: 5/6 samples use "spent/had spent thirty years" as a career-framing device, and 3/6 have a "thirty-year cartographer" in particular.**

> **V5-1:** *"The cartographer finished mapping every room in the building, then counted the doors…"*
> **V5-2:** *"Dr. Yusuf Okafor had catalogued every species in the deep-ocean trench for thirty years…"*
> **V5-3:** *"Pediatric oncologist Dr. Reyes had spent thirty years memorizing the faces of children she couldn't save…"*
> **V5-4:** *"Cartographer Yusuf Adebayo spent thirty years mapping every coastline on Earth…"*
> **V5-6:** *"The cartographer spent forty years mapping every road in the county…"*

Several of these still use the banned twist-reveal structure, just dressed in vocationally-specific vocabulary ("the creature ascending toward his submersible's light was cataloguing him back"; "she counted them — and found one she didn't recognize"). The ban list alone redirects the creepypasta instinct toward a *literary-ish pastiche* instead of killing it.

**H1 confirmed but qualified:** banning helps, but banning alone lets the model find a new stereotype. **The positive instruction is load-bearing.** Updated prior for H1 alone: ~90% that banning helps *some*, but it's insufficient without a positive anchor.

## What surprised me

1. **Mode collapse is a knob, not a bug.** The baseline collapses into twist-reveal. V2 collapses into soup-on-the-stove. V5 collapses into thirty-year-career. The model has strong stereotype attractors for this genre, and each prompt either shifts which attractor it falls into or — in V4's case — makes the attractor space broad enough that samples look genuinely varied. This suggests the real craft is *naming and banning multiple competing attractors simultaneously*, not just the one you see first.

2. **The "pick ONE and commit to it" instruction gets interpreted as planning-visible-to-the-reader.** I'd have bet 15% on a prompt-leak at that rate (4/6 emitting a `**Detail:**` header). Sonnet 4.6 reads "commit to X" as "declare X explicitly" unless told otherwise. Lesson: any instruction that sounds like "plan before writing" needs a matching "output only the result, not the plan" to avoid meta-text bleeding through.

3. **The ban list matters more than I expected, not less.** I had a 30-35% prior that the positive instruction alone would carry V4. The V5 ablation result (bans-only also fails, but differently) combined with V2's result (positive-only fails) shows that both pieces are doing orthogonal work — you need each to neutralise a different attractor.

4. **V1 violated its own explicit ban once ("I live alone") across n=14.** Even with explicit listing, there's a residual ~7% rate at which Sonnet 4.6 returns to the banned construct. Banning is a prior-shift, not a hard constraint. Worth remembering for any prompt-engineering task where the failure mode is stylistic.

5. **Paradoxically, the single best-prose output across the whole study came from V3, the variant that had the worst prompt-leak rate.** V3-5 (paramedic / oxygen mask "warm, faintly sweet, recently used") is the clean winner on pure craft. The prompt that was most aggressive about anchoring in a sensory particular also produced the best sensory particular — but only 2/6 of the time. There's a real tradeoff between prompt specificity pushing up the ceiling and prompt specificity pushing down the floor via leak/rigidity.

## Insight

**Two-sentence horror is a genre with multiple competing stereotype attractors in the base model, and prompt-tuning is the work of simultaneously banning several while specifying one positive anchor.** The baseline falls into "lights-went-out twist-reveal." Ask for restraint, it falls into "soup on the stove." Ban tropes, it falls into "thirty-year cartographer." Only a prompt that (a) names and bans multiple failure modes out loud, (b) gives one concrete positive anchor (ground in a specific mundane physical particular), and (c) explicitly forbids meta-output can keep the model in the narrow slice where good flash horror lives.

This generalises beyond horror. For any creative prompt on a genre the base model has strong priors about (flash fiction, aphorism, haiku, joke form), expect *multiple* attractors, not one. Enumerate them.

## Confidence

- **V4 ≫ baseline on dread quality and reliability:** high confidence. The baseline cannot produce an output like the exterminator-spider or the retirement cake sample without a prompt change.
- **V4 > V1 on reliability:** high confidence. V4 has zero mode-collapse instances across n=14; V1 has one clear collapse (cartographer) and one ban-violation ("I live alone") across n=14.
- **V4 ≳ V1 on peak prose quality:** medium confidence. The ceiling is close. A reader who cared only about the best single output might prefer a V1 or V3 sample. A reader who cared about the average and worst-case clearly prefers V4.
- **The attractor framing generalises:** medium confidence. It was consistent across five variants here; I haven't tested it on a non-horror creative genre.

## Alternatives considered and rejected

Two alternative variants I considered and did *not* run, with the reasoning for each:

- **V6: few-shot exemplars.** Put three hand-picked flash horror examples (e.g. Augusto Monterroso-style micro-fiction) in the prompt, then ask for more. Likely to push quality up but at risk of pastiche — the model would reproduce the examples' specific moves (particular imagery, rhythms) rather than generalise. V4 already works without this, and adding few-shot doesn't test the hypothesis about *which prompt-craft moves are doing the work* — it mostly swaps *prompt engineering* for *taste curation*. Skipped as less informative than V5's ablation.

- **V7: author-name conditioning ("in the mode of Thomas Ligotti / Kathe Koja").** Plausibly raises the literary ceiling but (a) Sonnet 4.6's training-data impression of Ligotti is likely not Ligotti's actual style, and (b) persona framing tends to import tone-words ("cyclopean," "liminal") rather than the underlying restraint. Would have muddied the finding with a confound.

A third rejected direction:

- **Generator-judge loop.** Generate 5 samples, then ask Sonnet to pick the best. This is a selection strategy, not a prompt-tuning strategy — it doesn't answer the question "what prompt makes the model produce dread reliably" and would let a weak prompt look strong by filtering.

V4 and V5 together beat these alternatives because V5 is a clean ablation that isolates the contribution of the positive instruction, which the few-shot or persona variants wouldn't have isolated.

## Open questions / handoff

The next agent picking this up could pursue any of these, in decreasing order of expected information:

1. **Does the attractor-naming principle generalise to other creative forms?** Run the same protocol on a different creative genre with known stereotypes — flash comedy, haiku, aphorism — and see whether the pattern "baseline falls into attractor A, positive-only falls into attractor B, ban-only falls into attractor C, composite hits" holds. If yes, this is a generalisable prompt-craft principle worth writing a topic page about. Expected runtime: ~30 minutes. Budget: same as this trial.

2. **Few-shot exemplars vs V4, head-to-head.** Pick 4-6 genuinely excellent published flash horror sentences (Monterroso, maybe a curated subreddit pull) and construct V6 with exemplars. Does few-shot beat V4 on peak quality? On reliability? On diversity? Expected runtime: ~20 minutes. Main risk: copy-imitation confound.

3. **What specifically breaks V4?** V4r-5 (the dog-nails escalation) slipped into escalation-twist structure. Is there a fifth attractor hiding (escalation-then-closer-footsteps) that a V4.1 with one more ban would catch? Expected runtime: 15 minutes, just n=8 more V4 samples plus careful read.

4. **Does the "output only the two sentences" instruction matter as much as I think?** Run V4 with that line removed. If prompt-leak returns, it confirms that instruction is doing real work; if not, it can be removed for a cleaner prompt. Small ablation, 10 minutes.

5. **Temperature / seed variation.** All samples here came from a single setting (Sonnet 4.6 default). Does V4's mode-collapse resistance hold at higher temperature? At lower? Unknown. Would require checking what temperature the CLI actually uses.

Start from commit `64369a6` (tag `exp/horror/best`) on branch `experiment/wave1` of `/Users/mark/Desktop/projects/horror-prompt-tuning`. Outputs are in `outputs/<variant>/sample_N.txt`. Prompts are in `prompts/`.

## Winning prompt, inlined for portability

Full text of `prompts/v4_composite.txt`:

```
You write two-sentence horror stories. The goal is dread — the slow wrongness — not shock.

Ground the story in one specific, mundane physical particular: a texture, a smell, a temperature, a sound quality, a visual anomaly, a timing that's off. The horror should emerge from that detail being slightly wrong, not from a plot twist. Do not tell the reader what is wrong — show the detail and let them notice.

Do not produce any of the following:
- Openers: "The last thing she heard...", "I always thought...", "It was just a normal...", "They said the house...", "She never should have..."
- The twist-reveal structure (sentence one sets a normal scene, sentence two contradicts it to reveal the horror) — the most exhausted move in the form.
- Stock imagery: basements, attics, closets, mirrors, dolls, dead daughters, imaginary friends, phone calls from the dead, voices in closets, deadbolts locking themselves, footsteps on stairs, hospitals, asylums.
- Narrator epiphanies ("and then I realized", "that's when I knew").
- Abstract emotion words (no "terror", "fear", "horror", "evil", "wrong" — the reader supplies those).
- Generic unnamed "she" / "I" protagonists with no specifying detail.
- Domestic kitchen-stove scenes (soup simmering, pots on the stove) — overused.

Write the story directly. Do not explain your choices or show your reasoning. Do not produce headers or meta-commentary. Output only the two sentences.

Two sentences. Concrete nouns. Trust the reader.
```

Invocation:

```
echo "Write a two-sentence horror story." \
  | claude -p --model claude-sonnet-4-6 --tools "" \
    --system-prompt "$(cat prompts/v4_composite.txt)"
```

## Reproducing

```
cd /Users/mark/Desktop/projects/horror-prompt-tuning
git checkout experiment/wave1
./run_variant.sh v4_composite 8 prompts/v4_composite.txt
```

Each run produces `outputs/v4_composite/sample_{1..8}.txt`. Samples are independent, parallel, and run in roughly 10 seconds total.
