# v3-object-pivot

## TAKEAWAY

V3 ("pick ONE mundane physical detail and commit to it, here is a menu") produces the best single prose in the whole study (V3-5 paramedic / oxygen mask "recently used") but 4/6 samples emit the instruction as a visible `**Detail chosen:**` header — prompt leaks. Reveals that "pick and commit" gets interpreted as "show your work" unless explicitly told otherwise.

## STATUS

resolved

## STARTING POINT

[r/baseline@b137274](https://github.com/mark/horror-prompt-tuning/tree/r/baseline)

## BRANCH

[r/v3-object-pivot](https://github.com/mark/horror-prompt-tuning/tree/r/v3-object-pivot)

## AGENT

0

## Question

Does instructing the model to pick one concrete mundane physical detail from a menu and pivot on it produce the "dread in the particular" quality good flash horror has?

## Hypothesis

**Prior (60% confident):** naming concrete categories (texture, smell, timing off, visual anomaly) with examples will produce specific grounded prose.
**Falsifier:** outputs feel constructed, OR leak the instruction, OR continue twist-revealing at the end.

## Experiment design

Change: system prompt including "Before writing, pick ONE of these as your load-bearing detail and commit to it: [list of 7-8 categories with examples]."
Measure: (a) do samples pivot on a specific named detail, (b) does the category menu leak into output, (c) subjective hit rate.

## Cycles

- `cycle 1 @175d206: V3 object-pivot prompt, n=6 -> 2/6 clean + 4/6 leaked (emitted **Detail chosen:** or **Load-bearing detail:** as visible header). qual: the 2 clean samples (V3-2 bench breathing, V3-5 paramedic oxygen mask) are the best single-sample prose of the whole study.`

## Results

Commit [175d206](https://github.com/mark/horror-prompt-tuning/commit/175d206), outputs at `outputs/v3_object/sample_{1..6}.txt`.

Four samples leaked the instruction as a header:
> **V3-1:** *"**Chosen detail:** a dripping on a rhythm that isn't gravity's.  ---  The water dripping from the kitchen faucet…"*
> **V3-3:** *"**Detail: a breath that takes too long to return**  ---  He held his sleeping son…"*
> **V3-4:** *"**Load-bearing detail:** a dripping that falls on a rhythm that isn't gravity's.  ---  …"*
> **V3-6:** *"**Detail chosen:** a dripping on a rhythm that isn't gravity's.  ---  …"*

The two clean outputs are exceptional:

> **V3-2:** *"The man on the bench beside her exhaled when she sat down — a slow, papery release — and she watched the second hand make one full circuit of the clock face before his chest rose again. She shifted her bag to her other shoulder and stared straight ahead at the door, which was still twelve people away."*

> **V3-5:** *"The paramedic pressed the oxygen mask to my face and told me to breathe normally, so I did. The air coming out of the tank smelled the way my husband's pillow had smelled on the morning of his funeral — warm, faintly sweet, recently used."*

V3-5 is the single sharpest landing of any output across all variants. "Recently used" does the entire emotional load.

## Analysis

H3 partially confirmed: the positive instruction works — it produces the best prose in the study. But it fails on prompt hygiene — Sonnet 4.6 interprets "pick ONE and commit to it" as "declare X explicitly" 4/6 of the time.

Generalisable lesson: any instruction phrased as *plan before writing* needs a paired *output only the result* guard, or it will leak as meta-text. This directly motivated V4's "output only the two sentences, no headers, no meta-commentary" line.

Prior update on H3: the positive anchor is powerful but must not read as a planning instruction.

## Reproducibility

Commit: [175d206](https://github.com/mark/horror-prompt-tuning/commit/175d206)
Command: `./run_variant.sh v3_object 6 prompts/v3_object.txt`
Artifacts: `outputs/v3_object/sample_{1..6}.txt`
Config: default temperature, n=6

## Leaderboard verdict

- vs rank 1 (v4-composite): worse on flash horror craft because V3 leaks `**Detail chosen:**` header in 4/6 — V4 fixes exactly this failure mode; peak prose is incomparable on craft (V3-5 arguably sharpest single output, V4 has 13/14 clean hits).
- vs rank 2 (v1-antipattern): better on peak prose (V3-5 > any V1 sample) but worse on reliability because V1 has zero prompt-leaks and V3 has 4/6. Incomparable overall; V1 wins on reliability axis, V3 on peak.
  - Note (protocol flag): `qualitative` flavor ranks by one-line pairwise argument. V3-vs-V1 is genuinely close; I'm calling V1 better because reliability beats peak in an agent-followup context, but this is the judgment call the protocol leaves to the writer.
- vs rank 4 (v5-ban-ablation): better on craft because V3's hit samples are genuinely strong and V5 collapses to cartographer in 5/6.
- vs rank 5 (v2-restraint): better — V3 has 2/6 clean strong samples; V2 has ~1/6.

Decision: insert at rank 3.

## Queue updates

*(motivates V4 directly — which has already been run)*
