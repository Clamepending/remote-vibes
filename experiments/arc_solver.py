"""ARC hill-climb solver. Iterate-able: CYCLE controls DSL breadth/depth."""
import json
import time
import sys
from itertools import product
from copy import deepcopy

CYCLE = int(sys.argv[1]) if len(sys.argv) > 1 else 1
PUZZLES = json.load(open("/Users/mark/Desktop/projects/remote-vibes/.remote-vibes/wiki/experiments/arc-puzzles.json"))["puzzles"]

# ------- Primitives: Grid (list[list[int]]) -> Grid -------
def identity(g): return [row[:] for row in g]
def flip_h(g): return [row[::-1] for row in g]
def flip_v(g): return g[::-1]
def rot90(g):
    h, w = len(g), len(g[0])
    return [[g[h-1-i][j] for i in range(h)] for j in range(w)]
def rot180(g): return flip_v(flip_h(g))
def rot270(g): return rot90(rot90(rot90(g)))
def transpose(g):
    h, w = len(g), len(g[0])
    return [[g[i][j] for i in range(h)] for j in range(w)]

# Parameterized factories
def make_color_swap(a, b):
    def f(g):
        return [[b if c==a else a if c==b else c for c in row] for row in g]
    f.__name__ = f"swap_{a}_{b}"
    return f

def make_recolor_all_nonzero(target):
    def f(g):
        return [[target if c!=0 else 0 for c in row] for row in g]
    f.__name__ = f"recolor_nz_{target}"
    return f

def gravity_down(g):
    h, w = len(g), len(g[0])
    out = [[0]*w for _ in range(h)]
    for j in range(w):
        col = [g[i][j] for i in range(h) if g[i][j] != 0]
        for k, v in enumerate(col):
            out[h - len(col) + k][j] = v
    return out

def mirror_left_to_right(g):
    """Take left half and mirror into right half."""
    h, w = len(g), len(g[0])
    half = w // 2
    out = [row[:] for row in g]
    for i in range(h):
        for j in range(half):
            out[i][w-1-j] = out[i][j]
    return out

def count_nonzero_column(g):
    """Emit an Nx1 column where N = count of nonzero, color = dominant nonzero."""
    colors = [c for row in g for c in row if c != 0]
    if not colors: return [[0]]
    n = len(colors)
    # Pick most common color
    from collections import Counter
    color = Counter(colors).most_common(1)[0][0]
    return [[color] for _ in range(n)]

# ------- DSL assembly per cycle -------
def build_dsl(cycle):
    base = [identity, flip_h, flip_v, rot90, rot180, rot270, transpose]
    if cycle >= 2:
        # add parameterized color swap + recolor
        for a, b in [(1,2),(1,3),(2,3),(1,4),(2,4),(3,4),(1,5),(2,5),(1,0),(2,0),(3,0)]:
            base.append(make_color_swap(a,b))
        for t in [1,2,3,4,5,6,7,8,9]:
            base.append(make_recolor_all_nonzero(t))
    if cycle >= 3:
        base.append(gravity_down)
        base.append(mirror_left_to_right)
        base.append(count_nonzero_column)
    return base

MAX_DEPTH = 2  # fixed; cycles vary DSL not depth to keep runtime sane

def eq(a, b):
    if len(a) != len(b): return False
    for r1, r2 in zip(a,b):
        if r1 != r2: return False
    return True

def apply_program(prog, g):
    out = g
    for f in prog:
        try:
            out = f(out)
        except Exception:
            return None
    return out

def search(puzzle, dsl, max_depth=MAX_DEPTH):
    train = puzzle["train"]
    nodes = 0
    # depth 1
    for f in dsl:
        nodes += 1
        ok = True
        for pair in train:
            r = apply_program([f], pair["input"])
            if r is None or not eq(r, pair["output"]):
                ok = False; break
        if ok:
            return [f], nodes
    # depth 2
    for f in dsl:
        for g in dsl:
            nodes += 1
            prog = [f,g]
            ok = True
            for pair in train:
                r = apply_program(prog, pair["input"])
                if r is None or not eq(r, pair["output"]):
                    ok = False; break
            if ok:
                return prog, nodes
    return None, nodes

def run():
    dsl = build_dsl(CYCLE)
    print(f"=== CYCLE {CYCLE} | DSL size: {len(dsl)} | max_depth: {MAX_DEPTH} ===")
    results = []
    total_start = time.time()
    for p in PUZZLES:
        t0 = time.time()
        prog, nodes = search(p, dsl)
        dt = time.time() - t0
        test_in = p["test"]["input"]
        test_out_expected = p["test"]["output"]
        test_out_got = apply_program(prog, test_in) if prog else None
        solved = (test_out_got is not None) and eq(test_out_got, test_out_expected)
        prog_str = "->".join(f.__name__ for f in prog) if prog else "NO_PROGRAM"
        results.append({
            "id": p["id"], "desc": p["description"],
            "solved": solved, "program": prog_str,
            "nodes": nodes, "time_s": round(dt,3),
            "got": test_out_got, "expected": test_out_expected,
            "test_in": test_in,
        })
        status = "OK" if solved else "FAIL"
        print(f"  [{status}] {p['id']} prog={prog_str} nodes={nodes} t={dt:.3f}s")
        if not solved:
            print(f"      expected: {test_out_expected}")
            print(f"      got:      {test_out_got}")
    total = time.time() - total_start
    n_solved = sum(1 for r in results if r["solved"])
    print(f"\nTOTAL: {n_solved}/{len(results)} solved | total_time={total:.2f}s")
    return results, n_solved, total

if __name__ == "__main__":
    results, n_solved, total = run()
    out_path = f"/Users/mark/Desktop/projects/remote-vibes/.remote-vibes/wiki/experiments/cycle{CYCLE}_results.json"
    json.dump({"cycle": CYCLE, "solved": n_solved, "total_time": total, "results": results}, open(out_path,"w"), indent=2)
    print(f"wrote {out_path}")
