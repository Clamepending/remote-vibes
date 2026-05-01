// WebGL renderer for the Library graph view.
//
// Renders via sigma.js (1 draw call per frame on a WebGL canvas) and lays
// the graph out with graphology-layout-forceatlas2 (Barnes-Hut O(n log n))
// running synchronously for a finite number of iterations.
//
// We deliberately do NOT run fa2 in a worker / continuous mode. fa2 in
// supervisor mode keeps writing micro-displacements forever, which sigma
// re-renders, producing visible jitter. Synchronous-with-finite-iterations
// settles the layout to a fixed point in one shot, sigma renders the
// settled state, and the GPU goes idle. The user can re-energize via
// `pulse()` (drag, button) and we run another finite settle.
//
// The module is mounted by main.js after the graph card is rendered. main.js
// keeps owning the source-of-truth `state.knowledgeBase.graphLayout` data;
// this module just consumes it via `setData`.

import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import { buildKnowledgeBaseGraph } from "./knowledge-base-graph-data.js";

// fa2 iteration counts. linLogMode + outboundAttractionDistribution converge
// slower than plain fa2 but produce dramatically clearer cluster structure
// instead of the hub-and-spoke / radial-spike look you get from defaults.
// We're running synchronously (not in a worker), so iterations are a fixed
// budget that we know completes in <500ms even for thousands of nodes
// thanks to Barnes-Hut.
function iterationsFor(order) {
  // linLog + outboundAttraction + adjustSizes converge slower than plain
  // fa2; for the "grouped islands" look the user wants, we need to let it
  // really cook. These budgets are sub-second even at 1k nodes thanks to
  // Barnes-Hut, since we're synchronous and compute-bound.
  if (order <= 50) return 400;
  if (order <= 200) return 700;
  if (order <= 800) return 1100;
  return 1600;
}

let cachedSettings = null;
let cachedSettingsOrder = -1;
function fa2SettingsFor(graph) {
  if (cachedSettingsOrder === graph.order && cachedSettings) return cachedSettings;
  const inferred = forceAtlas2.inferSettings(graph);
  cachedSettings = {
    ...inferred,
    barnesHutOptimize: graph.order > 200,
    barnesHutTheta: 0.5,
    // linLogMode produces clear cluster grouping (communities pull tightly
    // together while distinct communities push apart strongly) instead of
    // the radial hub-and-spoke layout you get from default fa2. Combined
    // with outboundAttractionDistribution this gives the "natural Obsidian
    // graph" look the user is asking for.
    linLogMode: true,
    // Scale-free / power-law graphs (which a Library is — a few hub notes
    // with many backlinks, a long tail of leaf notes) benefit from
    // redistributing edge attraction proportional to degree. Without this,
    // hubs dominate and produce stars; with it, edges bring leaves into
    // their own community space.
    outboundAttractionDistribution: true,
    // Treat node sizes as repulsion radii so hubs don't overlap their
    // leaves. Cheap; only relevant in linLog mode.
    adjustSizes: true,
    // Plain (non-strong) gravity at low magnitude: just enough to catch
    // stray orphan components, not enough to compress the whole graph into
    // a dense central ball. strongGravity was driving everything to the
    // origin and squashing cluster separation no matter how hard we pushed
    // scalingRatio. The camera fit-to-extent at end-of-settle handles
    // anything that drifts off the default viewport.
    strongGravityMode: false,
    gravity: 0.05,
    // The spread knob. With strong-gravity off and gravity low, this
    // dominates the equilibrium distance between clusters. 25 produces
    // visibly separated cluster islands at our typical Library scale.
    scalingRatio: 25,
    slowDown: 4,
  };
  cachedSettingsOrder = graph.order;
  return cachedSettings;
}

export function createKnowledgeBaseGraphRenderer(container, options = {}) {
  if (!(container instanceof HTMLElement)) {
    throw new Error("createKnowledgeBaseGraphRenderer: container must be an HTMLElement");
  }

  const handlers = {
    onNodeClick: typeof options.onNodeClick === "function" ? options.onNodeClick : () => {},
    onNodeHover: typeof options.onNodeHover === "function" ? options.onNodeHover : () => {},
    onSurfaceClick: typeof options.onSurfaceClick === "function" ? options.onSurfaceClick : () => {},
  };

  let graph = new Graph({ multi: false, allowSelfLoops: false, type: "undirected" });
  let sigma = null;
  let selectedKey = "";
  let connectedKeys = new Set();
  let hoveredKey = "";
  let dragging = null;
  let dragRafHandle = 0;
  let labelsAlwaysVisibleThreshold = 26;

  // Reveal animation state. We do an animated initial settle (RAF batches of
  // fa2 iterations interleaved with refreshes so the user can see the
  // layout converge instead of an ugly first paint) AND a BFS pop-in (each
  // node only becomes visible when its turn in the BFS order arrives). Both
  // run during the same animation window — by the time the last node pops
  // in, the layout is settled and stable.
  let revealAnimationHandle = 0;
  // Map of revealed node key -> performance.now() timestamp when it popped in.
  // The reducer reads this to compute a per-node pop scale (back/overshoot
  // easing) so each node bounces into existence at its already-settled
  // position. When revealMask is null, every node renders normally.
  let revealedNodes = new Map();
  let revealMask = null;
  // Each individual node's pop is fast — the user reads the cascade by the
  // gaps BETWEEN pops, not by the pop animation itself.
  const POP_DURATION_MS = 180;
  // We only run the reveal on the FIRST non-trivial setData call within a
  // single mount — subsequent re-renders from main.js (which fire often as
  // the user navigates) just rebuild silently.
  let hasPlayedReveal = false;

  function recomputeConnected() {
    connectedKeys = new Set();
    if (selectedKey && graph.hasNode(selectedKey)) {
      connectedKeys.add(selectedKey);
      for (const neighbor of graph.neighbors(selectedKey)) {
        connectedKeys.add(neighbor);
      }
    }
    if (hoveredKey && graph.hasNode(hoveredKey)) {
      connectedKeys.add(hoveredKey);
      for (const neighbor of graph.neighbors(hoveredKey)) {
        connectedKeys.add(neighbor);
      }
    }
  }

  // sigma reducers — called per-render frame. We do NOT mutate the underlying
  // graphology data here; that way fa2 can keep its source of truth and we
  // just decorate.
  function nodeReducer(key, attrs) {
    let popScale = 1;
    if (revealMask) {
      const revealedAt = revealMask.get(key);
      if (revealedAt === undefined) {
        return { ...attrs, hidden: true };
      }
      const elapsed = performance.now() - revealedAt;
      if (elapsed < POP_DURATION_MS) {
        // easeOutBack: overshoots to ~110% then settles to 100%.
        const t = elapsed / POP_DURATION_MS;
        const c1 = 1.70158;
        const c3 = c1 + 1;
        popScale = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      }
    }
    const isSelected = key === selectedKey;
    const isHovered = key === hoveredKey;
    const isConnected = connectedKeys.has(key);
    const totalNodes = graph.order;
    const labelAlwaysOn = totalNodes <= labelsAlwaysVisibleThreshold;
    // Labels: only the directly active node(s) get a label by default, even
    // when "connected" highlighting is on. Showing labels for the entire
    // 1-hop neighbourhood floods the canvas at hub nodes.
    const showLabel = (labelAlwaysOn || isSelected || isHovered) && popScale >= 0.99;
    const baseSize = Number(attrs.size) || 5;
    const stateSize = isSelected ? baseSize * 1.55 : isHovered ? baseSize * 1.3 : isConnected ? baseSize * 1.12 : baseSize;
    return {
      ...attrs,
      label: showLabel ? attrs.title : "",
      color: isSelected || isHovered || isConnected ? attrs.connectedColor : attrs.color,
      size: stateSize * popScale,
      zIndex: isSelected ? 3 : isHovered ? 2 : isConnected ? 1 : 0,
      forceLabel: (isSelected || isHovered) && popScale >= 0.99,
    };
  }

  function edgeReducer(key, attrs) {
    const [source, target] = graph.extremities(key);
    // During the BFS reveal, hide edges whose endpoints haven't popped in
    // yet — without this, sigma would render dangling lines from invisible
    // anchors (lines drawn from "hidden" nodes still render their start
    // point at the hidden coordinate, which produces ghost stubs).
    if (revealMask && (!revealMask.has(source) || !revealMask.has(target))) {
      return { ...attrs, hidden: true };
    }
    const touchesActive =
      source === selectedKey || target === selectedKey || source === hoveredKey || target === hoveredKey;
    return {
      ...attrs,
      color: touchesActive ? attrs.connectedColor : attrs.color,
      size: touchesActive ? (attrs.size || 0.6) * 2.2 : attrs.size || 0.6,
      zIndex: touchesActive ? 1 : 0,
    };
  }

  function ensureSigma() {
    if (sigma) return sigma;
    sigma = new Sigma(graph, container, {
      nodeReducer,
      edgeReducer,
      renderEdgeLabels: false,
      enableEdgeEvents: false,
      defaultEdgeColor: "rgba(255, 255, 255, 0.16)",
      defaultNodeColor: "rgba(180, 200, 240, 0.85)",
      labelColor: { color: "rgba(232, 236, 240, 0.95)" },
      labelSize: 11,
      labelWeight: "500",
      // labelDensity controls how aggressively sigma decimates labels in the
      // current viewport. Lower = fewer overlapping labels.
      labelDensity: 0.6,
      labelGridCellSize: 130,
      // Only render labels for nodes that occupy at least this many pixels;
      // tiny nodes never get labels in a packed view.
      labelRenderedSizeThreshold: 6,
      zIndex: true,
      allowInvalidContainer: false,
    });

    sigma.on("clickNode", ({ node }) => {
      if (dragging) return; // suppress click after drag
      handlers.onNodeClick(node);
    });
    sigma.on("clickStage", () => {
      handlers.onSurfaceClick();
    });
    sigma.on("enterNode", ({ node }) => {
      hoveredKey = node;
      recomputeConnected();
      handlers.onNodeHover(node);
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      hoveredKey = "";
      recomputeConnected();
      handlers.onNodeHover(null);
      sigma.refresh({ skipIndexation: true });
    });

    // Node dragging: while the user holds a node, run a continuous loop on
    // requestAnimationFrame that does ~3 fa2 iterations per frame and pins
    // the dragged node to the latest pointer position. This is what produces
    // the "live physics" feel — dragging a hub causes its leaves to swarm
    // around it in real time, not just snap when you release. We don't run
    // fa2 in a worker (which caused jitter at rest); instead we explicitly
    // start the loop on `downNode` and stop it on mouseup.
    sigma.on("downNode", ({ node, event }) => {
      // If the user grabs a node mid-reveal, finish the reveal immediately so
      // the rest of the graph is visible while they drag.
      if (revealAnimationHandle) {
        cancelRevealAnimation();
        sigma?.refresh({ skipIndexation: false });
      }
      dragging = { key: node, moved: false, lastX: undefined, lastY: undefined };
      graph.setNodeAttribute(node, "highlighted", true);
      event.preventSigmaDefault?.();
      startDragLoop();
    });

    const onMove = (rawEvent) => {
      if (!dragging || !sigma) return;
      const point = sigma.viewportToGraph({ x: rawEvent.x, y: rawEvent.y });
      dragging.lastX = point.x;
      dragging.lastY = point.y;
      // Pin the dragged node directly so the renderer reflects the pointer
      // even if the RAF tick hasn't fired yet.
      graph.setNodeAttribute(dragging.key, "x", point.x);
      graph.setNodeAttribute(dragging.key, "y", point.y);
      dragging.moved = true;
    };
    const onUp = () => {
      if (!dragging) return;
      const wasMoved = dragging.moved;
      graph.setNodeAttribute(dragging.key, "highlighted", false);
      stopDragLoop();
      dragging = null;
      if (wasMoved) {
        // Final relaxation pass so the layout settles fully into a fixed
        // point after the drag — no continuous worker means no jitter.
        runLayout({ iterations: 80 });
      }
    };
    sigma.getMouseCaptor().on("mousemovebody", onMove);
    sigma.getMouseCaptor().on("mouseup", onUp);
    sigma.getMouseCaptor().on("mouseleave", onUp);

    return sigma;
  }

  function startDragLoop() {
    if (dragRafHandle) return;
    const tick = () => {
      if (!dragging) {
        dragRafHandle = 0;
        return;
      }
      // ~3 fa2 iterations per frame is enough for visible response without
      // burning the main thread. With Barnes-Hut on 300 nodes this is well
      // under 5ms per frame, comfortably 60fps.
      forceAtlas2.assign(graph, { iterations: 3, settings: fa2SettingsFor(graph) });
      // fa2 may have moved the dragged node — re-pin it to the last pointer
      // position so the user always sees the node tracking their cursor.
      if (dragging.lastX !== undefined && dragging.lastY !== undefined) {
        graph.setNodeAttribute(dragging.key, "x", dragging.lastX);
        graph.setNodeAttribute(dragging.key, "y", dragging.lastY);
      }
      sigma?.refresh({ skipIndexation: true });
      dragRafHandle = window.requestAnimationFrame(tick);
    };
    dragRafHandle = window.requestAnimationFrame(tick);
  }

  function stopDragLoop() {
    if (dragRafHandle) {
      window.cancelAnimationFrame(dragRafHandle);
      dragRafHandle = 0;
    }
  }

  // Synchronous fa2 settle. Runs `iterations` ticks on the main thread; for
  // a few hundred nodes with Barnes-Hut this is well under 200ms. Used after
  // drag for the post-release relaxation — for the FIRST settle on a fresh
  // graph we use `runLayoutAnimated` instead so the user sees it converge.
  function runLayout({ iterations } = {}) {
    if (graph.order < 2) return;
    const iters = Number.isInteger(iterations) && iterations > 0 ? iterations : iterationsFor(graph.order);
    forceAtlas2.assign(graph, { iterations: iters, settings: fa2SettingsFor(graph) });
    sigma?.refresh({ skipIndexation: true });
  }

  // Pick a sensible BFS root for the reveal animation. We prefer the node
  // most likely to be the "front door" of the Library, in priority order:
  //   1. index.md (the conventional entry point)
  //   2. the highest-degree node (de facto hub)
  //   3. an arbitrary first node (last-resort fallback)
  function pickBfsRoot() {
    if (graph.hasNode("index.md")) return "index.md";
    let best = null;
    let bestDeg = -1;
    graph.forEachNode((key) => {
      const deg = graph.degree(key);
      if (deg > bestDeg) {
        bestDeg = deg;
        best = key;
      }
    });
    return best;
  }

  // Compute a BFS traversal order over the (possibly disconnected) graph.
  // Each disconnected component contributes its own BFS, with components
  // ordered by the highest-degree starting node first so the most "central"
  // component appears earliest in the reveal.
  function computeBfsOrder() {
    const order = [];
    const visited = new Set();
    const start = pickBfsRoot();
    const queue = start ? [start] : [];

    function bfsFrom(seed) {
      const q = [seed];
      visited.add(seed);
      while (q.length) {
        const cur = q.shift();
        order.push(cur);
        for (const nb of graph.neighbors(cur)) {
          if (!visited.has(nb)) {
            visited.add(nb);
            q.push(nb);
          }
        }
      }
    }

    if (queue.length) bfsFrom(queue[0]);
    // Pick up any nodes in disconnected components, starting each
    // sub-component from its own highest-degree seed.
    const remaining = [];
    graph.forEachNode((key) => {
      if (!visited.has(key)) remaining.push(key);
    });
    remaining.sort((a, b) => graph.degree(b) - graph.degree(a));
    for (const seed of remaining) {
      if (!visited.has(seed)) bfsFrom(seed);
    }
    return order;
  }

  // Obsidian-style reveal: settle the layout SYNCHRONOUSLY first so positions
  // are fixed, then BFS-pop each node into existence at its final spot with an
  // overshoot ease (see nodeReducer). No fa2 runs during the animation, so the
  // graph never appears to "expand outward" — it just blooms from the hub
  // outward at static positions.
  function runRevealAnimation() {
    cancelRevealAnimation();
    if (graph.order === 0) return;

    // 1. Fully settle layout before showing anything. Sub-second on Library
    //    scale thanks to Barnes-Hut.
    forceAtlas2.assign(graph, {
      iterations: iterationsFor(graph.order),
      settings: fa2SettingsFor(graph),
    });

    // 2. Compute reveal order from the now-settled graph and fit camera to
    //    the final extent before any node appears, so the camera never moves
    //    during the pop-in.
    const bfsOrder = computeBfsOrder();
    revealedNodes = new Map();
    revealMask = revealedNodes;
    sigma?.refresh({ skipIndexation: false });
    sigma?.getCamera().animatedReset({ duration: 0 });

    // 3. Stagger the pop-ins. The "pop... pop... pop" feel comes from the
    //    GAP between nodes, not from the pop animation itself, so keep the
    //    interval generous on small graphs. Scale down for bigger graphs to
    //    keep total reveal under a few seconds, but never below ~12ms or the
    //    cascade blurs into a wash.
    const totalNodes = bfsOrder.length;
    const stagger = totalNodes > 500 ? 12 : totalNodes > 200 ? 22 : totalNodes > 80 ? 50 : totalNodes > 30 ? 90 : 130;
    const startTime = performance.now();
    let nodeIdx = 0;

    const tick = () => {
      const now = performance.now();
      const elapsed = now - startTime;

      // Reveal every node whose stagger window has passed.
      while (nodeIdx < bfsOrder.length && elapsed >= nodeIdx * stagger) {
        revealedNodes.set(bfsOrder[nodeIdx], now);
        nodeIdx += 1;
      }

      sigma?.refresh({ skipIndexation: true });

      const allRevealed = nodeIdx >= bfsOrder.length;
      const lastPopAge = allRevealed ? now - (revealedNodes.get(bfsOrder[bfsOrder.length - 1]) || now) : 0;
      if (allRevealed && lastPopAge >= POP_DURATION_MS) {
        revealMask = null;
        revealAnimationHandle = 0;
        sigma?.refresh({ skipIndexation: false });
      } else {
        revealAnimationHandle = window.requestAnimationFrame(tick);
      }
    };
    revealAnimationHandle = window.requestAnimationFrame(tick);
  }

  function cancelRevealAnimation() {
    if (revealAnimationHandle) {
      window.cancelAnimationFrame(revealAnimationHandle);
      revealAnimationHandle = 0;
    }
    revealMask = null;
  }

  function setData({ nodes, edges, labelsAlwaysThreshold }) {
    if (Number.isInteger(labelsAlwaysThreshold)) {
      labelsAlwaysVisibleThreshold = labelsAlwaysThreshold;
    }
    const newGraph = buildKnowledgeBaseGraph(Array.isArray(nodes) ? nodes : [], Array.isArray(edges) ? edges : []);
    if (sigma) {
      graph.clear();
      newGraph.forEachNode((key, attrs) => graph.addNode(key, attrs));
      newGraph.forEachEdge((_key, attrs, src, tgt) => graph.addEdge(src, tgt, attrs));
    } else {
      graph = newGraph;
      ensureSigma();
    }
    selectedKey = selectedKey && graph.hasNode(selectedKey) ? selectedKey : "";
    hoveredKey = hoveredKey && graph.hasNode(hoveredKey) ? hoveredKey : "";
    recomputeConnected();

    // Run the BFS-reveal + animated-settle dance only on the FIRST data
    // load within this mount. main.js calls setData on every render — most
    // of those calls are no-ops or selection-only changes and re-running
    // the reveal each time would be jarring.
    if (!hasPlayedReveal && graph.order > 0) {
      hasPlayedReveal = true;
      runRevealAnimation();
    } else {
      // Subsequent updates: synchronous settle, no reveal.
      runLayout();
      sigma?.refresh({ skipIndexation: false });
    }
  }

  function setSelected(path) {
    const next = path && graph.hasNode(path) ? String(path) : "";
    if (next === selectedKey) return;
    selectedKey = next;
    recomputeConnected();
    sigma?.refresh({ skipIndexation: true });
  }

  function fit() {
    if (!sigma) return;
    sigma.getCamera().animatedReset({ duration: 350 });
  }

  function focus(path) {
    if (!sigma || !path || !graph.hasNode(path)) return false;
    const attrs = graph.getNodeAttributes(path);
    sigma.getCamera().animate({ x: attrs.x, y: attrs.y, ratio: 0.45 }, { duration: 400 });
    return true;
  }

  function pulse() {
    // Replays the reveal animation so the user sees the layout reform —
    // nodes vanish, then BFS-pop-in while fa2 re-settles from a perturbed
    // start. Cancels any in-flight reveal first so the button is always
    // responsive.
    cancelRevealAnimation();
    graph.forEachNode((key, attrs) => {
      const dx = (Math.random() - 0.5) * 30;
      const dy = (Math.random() - 0.5) * 30;
      graph.setNodeAttribute(key, "x", (attrs.x || 0) + dx);
      graph.setNodeAttribute(key, "y", (attrs.y || 0) + dy);
    });
    runRevealAnimation();
  }

  function unmount() {
    stopDragLoop();
    cancelRevealAnimation();
    sigma?.kill();
    sigma = null;
    graph.clear();
    dragging = null;
    selectedKey = "";
    hoveredKey = "";
    connectedKeys.clear();
    hasPlayedReveal = false;
  }

  ensureSigma();

  return { setData, setSelected, fit, focus, pulse, unmount };
}

// Exported for test coverage.
export { buildKnowledgeBaseGraph as __buildKnowledgeBaseGraph };
