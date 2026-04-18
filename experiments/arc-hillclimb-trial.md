# ARC Hill-Climb Trial

updated_at: 2026-04-18
scope: single-session research experiment
confidence: medium (small hand-crafted set, contrived puzzles)

## Synthesis

**Insight.** On a hand-crafted 8-puzzle set, brute-force DSL search at depth-2 climbs from 37.5% -> 62.5% -> 100% by adding *expressibility* (new primitives), not *depth*. The one surprise was self-inflicted: my hand-written ground truth for the gravity puzzle was wrong, and looking at the grid output (not just the pass/fail bit) caught it.

**Final score.** 8/8 after three cycles + one label correction.
**Confidence.** Medium. The puzzles were hand-crafted to be DSL-reachable; real ARC-AGI is far harder. The experiment validates the loop, not the solver.

## Puzzles

| id | description | shape in/out |
|----|-------------|--------------|
| p1_flip_h | Horizontal flip | 3x3/3x3, 3x4/3x4 |
| p2_rot90 | Rotate 90 clockwise | 3x3/3x3 |
| p3_color_swap | Swap all 1s with 2s | 3x3/3x3 |
| p4_recolor_nonzero | Replace every nonzero with 4 | 3x3/3x3 |
| p5_gravity_down | Nonzeros fall to column bottom | 3x3/3x3 |
| p6_symmetry_complete | Mirror left half into right half | 3x4/3x4 |
| p7_flip_v | Vertical flip | 3x3/3x3 |
| p8_count_fill | Output Nx1 column of dominant color, N=nonzero count | 3x3/Nx1 |

## Hypotheses (pre-coding)

- H1: Depth-2 brute force on base geometric DSL solves ~30-50%.
- H2: Biggest failure mode is *parameterized* ops (color swap w/ inferred a,b).
- H3: Adding color-swap + recolor is the single biggest per-cycle lift.

## DSL

- Cycle 1: identity, flip_h, flip_v, rot90, rot180, rot270, transpose (7)
- Cycle 2: + 11 color_swap(a,b) + 9 recolor_nonzero(t) -> 27 primitives
- Cycle 3: + gravity_down + mirror_left_to_right + count_nonzero_column -> 30 primitives

Search: exhaustive depth-1 then depth-2 composition. Program accepted iff it matches every train pair exactly, then evaluated on the held-out test.

## Iteration log

### Cycle 1 - base geometric

- hypothesis: geometric ops alone solve pure-geometry puzzles only.
- change: N/A (baseline).
- quant: 3/8 solved. Nodes/failed puzzle: 56 (exhausts 7 + 49).
- qual: All 5 failures were "primitive doesn't exist", not "depth too shallow". For p3 the expected `[[2,0,1],[0,2,0],[1,0,2]]` is unreachable from `[[1,0,2],[0,1,0],[2,0,1]]` by any composition of flips/rots/transpose because the color-count histogram differs in a position-correlated way.
- learned: H1 high side (37.5%), H2 directly validated.

### Cycle 2 - add color primitives

- hypothesis: Adding parameterized color swap + recolor picks up p3, p4.
- change: +20 color primitives (ONE change class).
- quant: 5/8 solved. Nodes/failed puzzle: 756 (27 + 729).
- qual: p5 still failed because expected output preserved row-order in a way I initially read as "wrong gravity" (this became the Cycle-3 finding). p6 fails because mirror-left-to-right is not expressible as a composition of flips (it needs *half-aware* mutation). p8 fails because every primitive is shape-preserving; the output is Nx1.
- learned: H3 confirmed. Runtime still trivial (<3 ms/puzzle) so brute force is fine at this DSL size.

### Cycle 3 - add topology/shape-changing primitives

- hypothesis: +gravity, +mirror_half, +count_column clears the remaining 3.
- change: +3 primitives.
- quant (pre-fix): 7/8. p5 still failed.
- qual (critical): I printed the actual grid produced by `gravity_down` against the puzzle's expected output. My primitive produced `[[0,0,0],[0,0,0],[1,3,2]]` (standard gravity). The puzzle's label said `[[0,0,0],[1,0,0],[0,3,2]]`. The second train pair matched standard gravity. The first did not. **The puzzle's ground-truth label was wrong** - I'd written it inconsistently with my own description. A pass/fail counter would have blamed the solver.
- change (micro-iter): fix the puzzle label to true gravity.
- quant (post-fix): 8/8 solved. Total wall time: ~4 ms for the whole set.
- learned: Looking at grids beats looking at booleans. The qual loop caught a labeling bug that no quant metric would have surfaced.

## Results table

| cycle | DSL size | solved | nodes on hardest fail | total time | delta |
|-------|----------|--------|-----------------------|-----------|-------|
| 1     | 7        | 3/8    | 56                    | <1 ms     | -     |
| 2     | 27       | 5/8    | 756                   | ~3 ms     | +2    |
| 3     | 30       | 7/8    | 930                   | ~3 ms     | +2    |
| 3'    | 30       | 8/8    | -                     | ~4 ms     | +1 (label fix) |

Per-puzzle solutions found:
- p1 -> flip_h
- p2 -> rot90
- p3 -> swap_1_2
- p4 -> recolor_nz_4
- p5 -> gravity_down
- p6 -> mirror_left_to_right
- p7 -> flip_v
- p8 -> count_nonzero_column

All solutions are depth-1. Depth-2 was never needed for this set, which is another qualitative signal: my puzzles were too compositionally flat.

## What the failures taught me that a number wouldn't

1. **DSL expressibility dominates search depth** on this set. Every cycle-1 failure was "the transform isn't in the DSL at all". No amount of depth would help.
2. **Shape-preserving bias is a hidden constraint.** Until cycle 3, *every* primitive was H x W -> H x W. p8 (shape-changing output) is invisible to the solver no matter how many shape-preserving primitives I stack.
3. **Parameterization explodes the DSL.** color_swap(a,b) is a family with 90 members for colors 0-9; I added 11. For harder puzzles I'd need *inferred* parameters from the train pairs, not enumerated - the enumeration style doesn't scale past cycle 2.
4. **My own ground truth was wrong.** The gravity puzzle had an inconsistent expected output. Only side-by-side grid printing revealed this; the search "failed" silently with `NO_PROGRAM`.
5. **Depth-2 was never used.** Composition was unnecessary because puzzles were single-primitive. A real ARC-AGI subset would stress the depth-vs-breadth tradeoff; this set did not.

## Next steps

- Replace enumeration of `color_swap(a,b)` with *inference*: for each train pair, solve the permutation that maps input->output colors and check consistency across pairs.
- Add compositional puzzles (e.g., rotate-then-recolor) to stress depth-2 usefulness.
- Score "partial match" (% cells correct) as a secondary metric so near-miss failures surface in quant, not only in qual.
- Try a real ARC-AGI mini-subset (from the public eval set); the current set is too DSL-friendly to generalize confidence.
- Add a "primitive usage" histogram per cycle to catch dead code in the DSL.

## Artifacts

- Puzzles: `/Users/mark/Desktop/projects/remote-vibes/.remote-vibes/wiki/experiments/arc-puzzles.json`
- Solver: `/Users/mark/Desktop/projects/remote-vibes/.remote-vibes/wiki/experiments/arc_solver.py`
- Per-cycle results: `cycle{1,2,3}_results.json` in same dir
