"""
Hybrid neurosymbolic ARC solver.

Architecture:
  1. For each puzzle, the "LLM" (me, at design time) proposes 2-3 candidate
     transformation rules as named Python functions.
  2. A symbolic verifier runs every candidate against all 3 train pairs.
  3. The first candidate that matches all 3 train pairs exactly is the winner.
  4. The winner is applied to the test input.

We also log:
  - prior ranking for each candidate (my natural-language guess before running)
  - which candidate the verifier picked
  - whether that candidate ALSO matches the held-out test output
  - hypothesis-quality metric: did the correct rule even appear in my candidate
    list, and was it my top-ranked one?
"""

from __future__ import annotations

import json
from collections import Counter
from copy import deepcopy
from pathlib import Path
from typing import Callable, Iterable


Grid = list[list[int]]


# ---------------------------------------------------------------------------
# Generic primitive transformations. These are the building blocks my
# candidates compose. I keep them tiny and pure.
# ---------------------------------------------------------------------------


def flip_h(g: Grid) -> Grid:
    return [row[::-1] for row in g]


def flip_v(g: Grid) -> Grid:
    return [row[:] for row in g[::-1]]


def rot90(g: Grid) -> Grid:
    # counter-clockwise: new[r][c] = old[c][W-1-r]
    h = len(g)
    w = len(g[0])
    return [[g[c][w - 1 - r] for c in range(w)] for r in range(h)]


def rot90cw(g: Grid) -> Grid:
    h = len(g)
    w = len(g[0])
    return [[g[h - 1 - c][r] for c in range(h)] for r in range(w)]


def rot180(g: Grid) -> Grid:
    return flip_v(flip_h(g))


def transpose(g: Grid) -> Grid:
    h = len(g)
    w = len(g[0])
    return [[g[r][c] for r in range(h)] for c in range(w)]


def swap_colors(g: Grid, a: int, b: int) -> Grid:
    out = [row[:] for row in g]
    for r in range(len(out)):
        for c in range(len(out[0])):
            if out[r][c] == a:
                out[r][c] = b
            elif out[r][c] == b:
                out[r][c] = a
    return out


def gravity_up(g: Grid) -> Grid:
    """Collapse non-zero cells upward, column-wise, preserving order."""
    h = len(g)
    w = len(g[0])
    out = [[0] * w for _ in range(h)]
    for c in range(w):
        col = [g[r][c] for r in range(h) if g[r][c] != 0]
        for r, v in enumerate(col):
            out[r][c] = v
    return out


def gravity_down(g: Grid) -> Grid:
    h = len(g)
    w = len(g[0])
    out = [[0] * w for _ in range(h)]
    for c in range(w):
        col = [g[r][c] for r in range(h) if g[r][c] != 0]
        start = h - len(col)
        for i, v in enumerate(col):
            out[start + i][c] = v
    return out


def connected_components(
    g: Grid, include_bg: bool = False
) -> list[tuple[int, list[tuple[int, int]]]]:
    """4-connected components over non-zero cells regardless of colour."""
    h = len(g)
    w = len(g[0])
    seen = [[False] * w for _ in range(h)]
    comps: list[tuple[int, list[tuple[int, int]]]] = []
    for r in range(h):
        for c in range(w):
            v = g[r][c]
            if seen[r][c]:
                continue
            if not include_bg and v == 0:
                continue
            stack = [(r, c)]
            cells: list[tuple[int, int]] = []
            while stack:
                y, x = stack.pop()
                if y < 0 or y >= h or x < 0 or x >= w:
                    continue
                if seen[y][x]:
                    continue
                if g[y][x] != v:
                    continue
                seen[y][x] = True
                cells.append((y, x))
                stack.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])
            comps.append((v, cells))
    return comps


def connected_components_any_color(g: Grid) -> list[list[tuple[int, int]]]:
    """4-connected components of non-zero cells, ignoring colour differences."""
    h = len(g)
    w = len(g[0])
    seen = [[False] * w for _ in range(h)]
    comps: list[list[tuple[int, int]]] = []
    for r in range(h):
        for c in range(w):
            if seen[r][c] or g[r][c] == 0:
                continue
            stack = [(r, c)]
            cells: list[tuple[int, int]] = []
            while stack:
                y, x = stack.pop()
                if y < 0 or y >= h or x < 0 or x >= w:
                    continue
                if seen[y][x] or g[y][x] == 0:
                    continue
                seen[y][x] = True
                cells.append((y, x))
                stack.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])
            comps.append(cells)
    return comps


def grid_equal(a: Grid, b: Grid) -> bool:
    if len(a) != len(b):
        return False
    for ra, rb in zip(a, b):
        if len(ra) != len(rb):
            return False
        if any(x != y for x, y in zip(ra, rb)):
            return False
    return True


# ---------------------------------------------------------------------------
# Per-puzzle candidate rules. Every candidate must implement:
#   (name, prior_rank, fn: Grid -> Grid)
# where prior_rank is my pre-verifier belief (1 = most likely, higher = less).
# ---------------------------------------------------------------------------


def p01_candidates():
    return [
        ("flip_horizontal", 1, flip_h),
        ("flip_vertical", 2, flip_v),
        ("rotate_180", 3, rot180),
    ]


def p02_candidates():
    return [
        ("rotate_180", 1, rot180),
        ("flip_vertical", 2, flip_v),
        ("flip_horizontal", 3, flip_h),
    ]


def p03_candidates():
    return [
        ("swap_1_and_2", 1, lambda g: swap_colors(g, 1, 2)),
        ("swap_1_and_0", 2, lambda g: swap_colors(g, 1, 0)),
        ("swap_2_and_0", 3, lambda g: swap_colors(g, 2, 0)),
    ]


def p04_candidates():
    return [
        ("rot90_ccw_then_swap12", 1, lambda g: swap_colors(rot90(g), 1, 2)),
        ("swap12_then_rot90_ccw", 2, lambda g: rot90(swap_colors(g, 1, 2))),
        ("rot90_cw_then_swap12", 3, lambda g: swap_colors(rot90cw(g), 1, 2)),
        ("transpose_then_swap12", 4, lambda g: swap_colors(transpose(g), 1, 2)),
    ]


def p05_candidates():
    return [
        ("gravity_up", 1, gravity_up),
        ("gravity_down_then_flip_v", 2, lambda g: flip_v(gravity_down(g))),
        ("flip_v_then_gravity_down", 3, lambda g: gravity_down(flip_v(g))),
    ]


def _fill_rectangles_with_color(g: Grid, frame: int, fill: int) -> Grid:
    """Find axis-aligned rectangular frames of colour `frame` (hollow) and
    fill their strict interior zero cells with `fill`."""
    h = len(g)
    w = len(g[0])
    out = [row[:] for row in g]
    # Find every closed hollow rectangle of `frame` cells. Approach: for
    # each pair (r1,c1), find the largest rectangle whose perimeter is all
    # `frame` and whose interior is all 0.
    for r1 in range(h):
        for c1 in range(w):
            if g[r1][c1] != frame:
                continue
            for r2 in range(r1 + 2, h):
                for c2 in range(c1 + 2, w):
                    # Check perimeter
                    ok = True
                    for c in range(c1, c2 + 1):
                        if g[r1][c] != frame or g[r2][c] != frame:
                            ok = False
                            break
                    if not ok:
                        continue
                    for r in range(r1, r2 + 1):
                        if g[r][c1] != frame or g[r][c2] != frame:
                            ok = False
                            break
                    if not ok:
                        continue
                    # Check interior is zero
                    interior_ok = True
                    for r in range(r1 + 1, r2):
                        for c in range(c1 + 1, c2):
                            if g[r][c] != 0:
                                interior_ok = False
                                break
                        if not interior_ok:
                            break
                    if not interior_ok:
                        continue
                    # Fill interior
                    for r in range(r1 + 1, r2):
                        for c in range(c1 + 1, c2):
                            out[r][c] = fill
    return out


def p06_candidates():
    return [
        ("fill_1_box_interior_with_3", 1,
         lambda g: _fill_rectangles_with_color(g, 1, 3)),
        ("fill_1_box_interior_with_2", 2,
         lambda g: _fill_rectangles_with_color(g, 1, 2)),
    ]


def _keep_largest_component(g: Grid) -> Grid:
    """Keep only the largest 4-connected non-zero component; zero the rest."""
    comps = connected_components_any_color(g)
    if not comps:
        return [row[:] for row in g]
    largest = max(comps, key=len)
    keep = set(largest)
    h = len(g)
    w = len(g[0])
    out = [[0] * w for _ in range(h)]
    for r in range(h):
        for c in range(w):
            if (r, c) in keep:
                out[r][c] = g[r][c]
    return out


def _keep_largest_same_color_component(g: Grid) -> Grid:
    comps = connected_components(g)
    if not comps:
        return [row[:] for row in g]
    _, cells = max(comps, key=lambda p: len(p[1]))
    keep = set(cells)
    h = len(g)
    w = len(g[0])
    out = [[0] * w for _ in range(h)]
    for r in range(h):
        for c in range(w):
            if (r, c) in keep:
                out[r][c] = g[r][c]
    return out


def p07_candidates():
    return [
        ("keep_largest_same_color_component", 1,
         _keep_largest_same_color_component),
        ("keep_largest_any_color_component", 2, _keep_largest_component),
    ]


def _most_common_nonzero(g: Grid) -> int | None:
    vals = [v for row in g for v in row if v != 0]
    if not vals:
        return None
    counts = Counter(vals)
    # Highest count, then highest value as tiebreaker (doesn't really matter
    # if there is a unique max).
    return counts.most_common(1)[0][0]


def _nxn_of_dominant(g: Grid) -> Grid:
    """Output is an N x N grid filled with the most common non-zero colour,
    where N is the count of that colour in the input."""
    colour = _most_common_nonzero(g)
    if colour is None:
        return [[0]]
    n = sum(1 for row in g for v in row if v == colour)
    return [[colour] * n for _ in range(n)]


def _nxn_of_least_common(g: Grid) -> Grid:
    vals = [v for row in g for v in row if v != 0]
    if not vals:
        return [[0]]
    counts = Counter(vals)
    colour, n = counts.most_common()[-1]
    return [[colour] * n for _ in range(n)]


def p08_candidates():
    return [
        ("n_of_dominant_square_nxn", 1, _nxn_of_dominant),
        ("n_of_least_common_square_nxn", 2, _nxn_of_least_common),
    ]


def _complete_horizontal_symmetry(g: Grid) -> Grid:
    """Mirror each row: out[r][W-1-c] = max(out[r][W-1-c], g[r][c]) for non-zero."""
    h = len(g)
    w = len(g[0])
    out = [row[:] for row in g]
    for r in range(h):
        for c in range(w):
            v = g[r][c]
            if v != 0:
                mirror = w - 1 - c
                if out[r][mirror] == 0:
                    out[r][mirror] = v
    return out


def _complete_vertical_symmetry(g: Grid) -> Grid:
    h = len(g)
    w = len(g[0])
    out = [row[:] for row in g]
    for r in range(h):
        for c in range(w):
            v = g[r][c]
            if v != 0:
                mirror = h - 1 - r
                if out[mirror][c] == 0:
                    out[mirror][c] = v
    return out


def p09_candidates():
    return [
        ("complete_horizontal_symmetry", 1, _complete_horizontal_symmetry),
        ("complete_vertical_symmetry", 2, _complete_vertical_symmetry),
    ]


def _gravity_color_down(g: Grid, colour: int) -> Grid:
    """Only cells of `colour` fall down in their column, everything else stays."""
    h = len(g)
    w = len(g[0])
    out = [row[:] for row in g]
    for c in range(w):
        # Walk column from bottom to top. Collect positions of `colour` and
        # positions of 0. Non-zero non-colour acts as a floor.
        # Simpler: segment-by-segment between non-colour-non-zero walls.
        segments: list[list[int]] = [[]]
        for r in range(h):
            v = out[r][c]
            if v != 0 and v != colour:
                segments.append([])
                segments[-1].append(-1)  # placeholder wall
                segments.append([])
            else:
                segments[-1].append(r)
        # Instead of the above tricky bookkeeping, just do a two-pointer pass
        # within each "free segment" bounded by walls.
        rows_in_col = [out[r][c] for r in range(h)]
        wall_rows = [r for r in range(h) if rows_in_col[r] not in (0, colour)]
        bounds = [-1] + wall_rows + [h]
        for i in range(len(bounds) - 1):
            lo = bounds[i] + 1
            hi = bounds[i + 1]  # exclusive
            # collect colour cells, zero the rest
            col_cells = [rows_in_col[r] for r in range(lo, hi) if rows_in_col[r] == colour]
            for r in range(lo, hi):
                rows_in_col[r] = 0
            # drop them to the bottom of [lo, hi)
            start = hi - len(col_cells)
            for k, v in enumerate(col_cells):
                rows_in_col[start + k] = v
        for r in range(h):
            out[r][c] = rows_in_col[r]
    return out


def p10_candidates():
    return [
        ("only_color_2_falls", 1, lambda g: _gravity_color_down(g, 2)),
        ("only_color_1_falls", 2, lambda g: _gravity_color_down(g, 1)),
        ("only_color_3_falls", 3, lambda g: _gravity_color_down(g, 3)),
    ]


def _tile_2x2_to_4x4(g: Grid) -> Grid:
    h = len(g)
    w = len(g[0])
    out = [[0] * (w * 2) for _ in range(h * 2)]
    for r in range(h * 2):
        for c in range(w * 2):
            out[r][c] = g[r % h][c % w]
    return out


def _tile_2x2_flip_h(g: Grid) -> Grid:
    flipped = flip_h(g)
    h = len(g)
    w = len(g[0])
    top = [g[r] + flipped[r] for r in range(h)]
    return top + top


def p11_candidates():
    return [
        ("tile_repeat_2x2", 1, _tile_2x2_to_4x4),
        ("tile_mirror_horizontal", 2, _tile_2x2_flip_h),
    ]


def _keep_longest_line(g: Grid) -> Grid:
    """Find the longest straight horizontal or vertical run of identical
    non-zero colour; zero everything else."""
    h = len(g)
    w = len(g[0])
    best_len = 0
    best_cells: set[tuple[int, int]] = set()
    # horizontal runs
    for r in range(h):
        c = 0
        while c < w:
            if g[r][c] == 0:
                c += 1
                continue
            v = g[r][c]
            start = c
            while c < w and g[r][c] == v:
                c += 1
            length = c - start
            if length > best_len:
                best_len = length
                best_cells = {(r, cc) for cc in range(start, c)}
    # vertical runs
    for c in range(w):
        r = 0
        while r < h:
            if g[r][c] == 0:
                r += 1
                continue
            v = g[r][c]
            start = r
            while r < h and g[r][c] == v:
                r += 1
            length = r - start
            if length > best_len:
                best_len = length
                best_cells = {(rr, c) for rr in range(start, r)}
    out = [[0] * w for _ in range(h)]
    for r, c in best_cells:
        out[r][c] = g[r][c]
    return out


def _keep_longest_line_any_run(g: Grid) -> Grid:
    """Same as above but treats any non-zero contiguous run as a line,
    regardless of colour identity."""
    h = len(g)
    w = len(g[0])
    best_len = 0
    best_cells: set[tuple[int, int]] = set()
    # horizontal runs of any non-zero
    for r in range(h):
        c = 0
        while c < w:
            if g[r][c] == 0:
                c += 1
                continue
            start = c
            while c < w and g[r][c] != 0:
                c += 1
            length = c - start
            if length > best_len:
                best_len = length
                best_cells = {(r, cc) for cc in range(start, c)}
    # vertical runs
    for c in range(w):
        r = 0
        while r < h:
            if g[r][c] == 0:
                r += 1
                continue
            start = r
            while r < h and g[r][c] != 0:
                r += 1
            length = r - start
            if length > best_len:
                best_len = length
                best_cells = {(rr, c) for rr in range(start, r)}
    out = [[0] * w for _ in range(h)]
    for r, c in best_cells:
        out[r][c] = g[r][c]
    return out


def p12_candidates():
    return [
        ("keep_longest_single_color_line", 1, _keep_longest_line),
        ("keep_longest_any_color_line", 2, _keep_longest_line_any_run),
    ]


CANDIDATE_GENERATORS: dict[str, Callable[[], list[tuple[str, int, Callable[[Grid], Grid]]]]] = {
    "p01_flip_h": p01_candidates,
    "p02_rot180": p02_candidates,
    "p03_swap_1_2": p03_candidates,
    "p04_rot90_then_swap": p04_candidates,
    "p05_gravity_then_flip_v": p05_candidates,
    "p06_fill_box_interior": p06_candidates,
    "p07_largest_component": p07_candidates,
    "p08_count_dominant_nxn": p08_candidates,
    "p09_complete_symmetry": p09_candidates,
    "p10_color2_falls": p10_candidates,
    "p11_tile_2x2_to_4x4": p11_candidates,
    "p12_longest_line": p12_candidates,
}


# ---------------------------------------------------------------------------
# Verifier + runner
# ---------------------------------------------------------------------------


def verify_on_train(
    fn: Callable[[Grid], Grid], train_pairs: Iterable[dict]
) -> bool:
    for pair in train_pairs:
        try:
            produced = fn(deepcopy(pair["input"]))
        except Exception:
            return False
        if not grid_equal(produced, pair["output"]):
            return False
    return True


def solve_puzzle(puzzle: dict) -> dict:
    candidates = CANDIDATE_GENERATORS[puzzle["id"]]()
    train = puzzle["train"]
    test_input = puzzle["test"]["input"]
    test_output_truth = puzzle["test"]["output"]

    per_candidate = []
    winner = None
    winner_test_output: Grid | None = None
    for name, prior, fn in candidates:
        matches_train = verify_on_train(fn, train)
        try:
            produced_test = fn(deepcopy(test_input))
        except Exception:
            produced_test = None
        matches_test = (
            produced_test is not None and grid_equal(produced_test, test_output_truth)
        )
        per_candidate.append(
            {
                "name": name,
                "prior_rank": prior,
                "train_all_match": matches_train,
                "test_match_if_picked": matches_test,
            }
        )
        if matches_train and winner is None:
            winner = name
            winner_test_output = produced_test

    # Was a correct rule (i.e. matches held-out test) present at all?
    correct_rule_exists = any(c["test_match_if_picked"] for c in per_candidate)
    # Was my top-ranked (prior=1) candidate the correct one?
    top_ranked = min(per_candidate, key=lambda c: c["prior_rank"])
    top_ranked_is_correct = top_ranked["test_match_if_picked"]

    return {
        "puzzle_id": puzzle["id"],
        "difficulty": puzzle["difficulty"],
        "candidates": per_candidate,
        "winner": winner,
        "winner_test_output": winner_test_output,
        "solved": winner_test_output is not None
        and grid_equal(winner_test_output, test_output_truth),
        "correct_rule_in_candidates": correct_rule_exists,
        "top_ranked_is_correct": top_ranked_is_correct,
    }


def run_all(puzzles_path: Path) -> tuple[list[dict], dict[str, Grid]]:
    with puzzles_path.open() as fh:
        data = json.load(fh)
    reports = []
    test_outputs: dict[str, Grid] = {}
    for puzzle in data["puzzles"]:
        rep = solve_puzzle(puzzle)
        reports.append(rep)
        if rep["winner_test_output"] is not None:
            test_outputs[puzzle["id"]] = rep["winner_test_output"]
        else:
            # Fallback: return input unchanged so the output file stays complete.
            test_outputs[puzzle["id"]] = puzzle["test"]["input"]
    return reports, test_outputs


def summarize(reports: list[dict]) -> dict:
    total = len(reports)
    solved = sum(1 for r in reports if r["solved"])
    correct_in_candidates = sum(1 for r in reports if r["correct_rule_in_candidates"])
    top_ranked_correct = sum(1 for r in reports if r["top_ranked_is_correct"])
    bucket = {"easy": [], "medium": [], "medium-hard": [], "hard": []}
    for r in reports:
        bucket[r["difficulty"]].append(r["solved"])
    return {
        "total": total,
        "solved": solved,
        "hyp_correct_in_candidates": correct_in_candidates,
        "top_ranked_correct": top_ranked_correct,
        "by_difficulty": {k: (sum(v), len(v)) for k, v in bucket.items()},
    }


if __name__ == "__main__":
    puzzles_path = Path(
        "/Users/mark/Desktop/projects/remote-vibes/.remote-vibes/wiki/"
        "experiments/arc-swarm/puzzles.json"
    )
    reports, outputs = run_all(puzzles_path)
    summary = summarize(reports)
    print(json.dumps({"summary": summary, "reports": reports}, indent=2))
