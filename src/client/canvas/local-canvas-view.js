import {
  AlertCircle,
  AppWindow,
  Bot,
  Box,
  CheckSquare,
  ExternalLink,
  HardDrive,
  Image as ImageIcon,
  Map as MapIcon,
  RefreshCw,
} from "lucide";
import {
  buildCanvasCards,
  getCanvasBoardId,
  getCanvasLayoutStorageKey,
  mergeCanvasLayout,
  normalizeNodeSnapshot,
  sanitizeCanvasLayout,
} from "./canvas-model.js";

const VIEW_ROOT_SELECTOR = "[data-swarmlab-canvas-root]";
const STYLE_ID = "swarmlab-canvas-styles";
const SNAPSHOT_URL = "/api/node/snapshot?mode=privileged";
const CARD_TYPE_ICONS = {
  agent: Bot,
  approval: CheckSquare,
  app: AppWindow,
  artifact: ImageIcon,
  browser: AppWindow,
  machine: HardDrive,
};

let activeController = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderIcon(icon, attrs = {}) {
  const nodes = Array.isArray(icon) ? icon : icon?.[2] || [];
  const attrText = Object.entries({ width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", ...attrs })
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(" ");
  const childHtml = nodes
    .map(([tag, attrsMap = {}]) => {
      const nodeAttrs = Object.entries(attrsMap)
        .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
        .join(" ");
      return `<${tag}${nodeAttrs ? ` ${nodeAttrs}` : ""}></${tag}>`;
    })
    .join("");
  return `<svg ${attrText} aria-hidden="true">${childHtml}</svg>`;
}

function injectCanvasStyles(documentRef = document) {
  if (documentRef.getElementById(STYLE_ID)) {
    return;
  }
  const style = documentRef.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.swarmlab-canvas-view {
  --canvas-bg: #0d1017;
  --canvas-panel: rgba(20, 24, 34, 0.92);
  --canvas-panel-strong: rgba(27, 32, 45, 0.96);
  --canvas-line: rgba(226, 232, 240, 0.12);
  --canvas-text: #f5f7fb;
  --canvas-muted: #a9b3c5;
  --canvas-accent: #6ee7d8;
  --canvas-warn: #f6c85f;
  background:
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    radial-gradient(circle at 30% 20%, rgba(110, 231, 216, 0.08), transparent 32%),
    var(--canvas-bg);
  background-size: 32px 32px, 32px 32px, auto, auto;
  color: var(--canvas-text);
  overflow: hidden;
}
.swarmlab-canvas-toolbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--canvas-line);
  background: rgba(12, 15, 22, 0.9);
  backdrop-filter: blur(14px);
}
.swarmlab-canvas-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.swarmlab-canvas-title-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid rgba(110, 231, 216, 0.34);
  background: rgba(110, 231, 216, 0.1);
}
.swarmlab-canvas-title strong {
  display: block;
  font-size: 15px;
  font-weight: 720;
}
.swarmlab-canvas-title span {
  display: block;
  color: var(--canvas-muted);
  font-size: 12px;
  line-height: 1.35;
}
.swarmlab-canvas-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.swarmlab-canvas-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  border: 1px solid var(--canvas-line);
  background: rgba(255, 255, 255, 0.06);
  color: var(--canvas-text);
  padding: 0 11px;
  font: inherit;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}
.swarmlab-canvas-button:hover {
  border-color: rgba(110, 231, 216, 0.46);
  background: rgba(110, 231, 216, 0.1);
}
.swarmlab-canvas-stage {
  position: relative;
  min-height: calc(100vh - 92px);
  overflow: auto;
}
.swarmlab-canvas-plane {
  position: relative;
  width: max(1320px, 100%);
  min-height: 860px;
}
.swarmlab-canvas-card {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 11px;
  border: 1px solid var(--canvas-line);
  background: var(--canvas-panel);
  box-shadow: 0 22px 55px rgba(0, 0, 0, 0.26);
  color: var(--canvas-text);
  padding: 14px;
  transform: translate3d(var(--card-x), var(--card-y), 0);
  touch-action: none;
  user-select: text;
}
.swarmlab-canvas-card.is-dragging {
  border-color: rgba(110, 231, 216, 0.72);
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.34);
  user-select: none;
}
.swarmlab-canvas-card-head {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 11px;
  align-items: start;
}
.swarmlab-canvas-card-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--canvas-line);
  background: rgba(255, 255, 255, 0.06);
  color: var(--canvas-accent);
}
.swarmlab-canvas-card-title {
  min-width: 0;
}
.swarmlab-canvas-card-title strong {
  display: block;
  font-size: 14px;
  font-weight: 720;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.swarmlab-canvas-card-title span {
  display: block;
  margin-top: 3px;
  color: var(--canvas-muted);
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.swarmlab-canvas-card-detail,
.swarmlab-canvas-card-meta {
  color: var(--canvas-muted);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.swarmlab-canvas-card-meta {
  margin-top: auto;
  color: #c8d0df;
}
.swarmlab-canvas-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.swarmlab-canvas-tag {
  display: inline-flex;
  align-items: center;
  min-height: 21px;
  padding: 0 7px;
  border: 1px solid var(--canvas-line);
  background: rgba(255, 255, 255, 0.05);
  color: #d8e1ee;
  font-size: 11px;
  max-width: 100%;
}
.swarmlab-canvas-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.swarmlab-canvas-open {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--canvas-accent);
  text-decoration: none;
  font-size: 12px;
}
.swarmlab-canvas-open:hover {
  text-decoration: underline;
}
.swarmlab-canvas-loading,
.swarmlab-canvas-empty,
.swarmlab-canvas-error {
  display: grid;
  place-items: center;
  min-height: 360px;
  margin: 24px;
  border: 1px solid var(--canvas-line);
  background: rgba(12, 15, 22, 0.76);
  text-align: center;
  color: var(--canvas-muted);
}
.swarmlab-canvas-error {
  color: #ffd7d7;
  border-color: rgba(255, 135, 135, 0.28);
}
.swarmlab-canvas-error svg,
.swarmlab-canvas-loading svg {
  margin-bottom: 12px;
}
@media (max-width: 760px) {
  .swarmlab-canvas-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .swarmlab-canvas-actions {
    justify-content: flex-start;
  }
  .swarmlab-canvas-plane {
    min-width: 980px;
  }
}
`;
  documentRef.head.appendChild(style);
}

function renderCanvasShell({ status = "loading", message = "loading local machine snapshot..." } = {}) {
  if (status === "error") {
    return `
      <div class="swarmlab-canvas-error" role="alert">
        <div>
          ${renderIcon(AlertCircle, { width: 24, height: 24 })}
          <strong>Could not load local canvas</strong>
          <p>${escapeHtml(message)}</p>
        </div>
      </div>
    `;
  }
  if (status === "empty") {
    return `
      <div class="swarmlab-canvas-empty">
        <div>
          ${renderIcon(Box, { width: 24, height: 24 })}
          <strong>No canvas cards yet</strong>
          <p>Start an agent, open a port, or publish an artifact and refresh this view.</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="swarmlab-canvas-loading">
      <div>
        ${renderIcon(RefreshCw, { width: 24, height: 24 })}
        <strong>${escapeHtml(message)}</strong>
      </div>
    </div>
  `;
}

export function renderSwarmlabCanvasView() {
  return `
    <section class="dashboard-panel main-view swarmlab-canvas-view" data-main-view="canvas" data-main-scroll-key="canvas">
      <div class="swarmlab-canvas-toolbar">
        <div class="swarmlab-canvas-title">
          <span class="swarmlab-canvas-title-icon" aria-hidden="true">${renderIcon(AppWindow)}</span>
          <div>
            <strong>Swarmlab Canvas</strong>
            <span data-swarmlab-canvas-meta>local machine dashboard</span>
          </div>
        </div>
        <div class="swarmlab-canvas-actions">
          <a class="swarmlab-canvas-button" href="?view=swarm" data-open-main-view="visual-interface">
            ${renderIcon(MapIcon)}
            <span>Agent Town</span>
          </a>
          <button class="swarmlab-canvas-button" type="button" data-swarmlab-canvas-refresh>
            ${renderIcon(RefreshCw)}
            <span>Refresh</span>
          </button>
        </div>
      </div>
      <div class="swarmlab-canvas-stage" data-swarmlab-canvas-root>
        ${renderCanvasShell()}
      </div>
    </section>
  `;
}

async function fetchJson(url, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Vibe-Research-API": "1",
    },
    referrerPolicy: "no-referrer",
    signal,
  });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

function readLayout(storage, key) {
  try {
    return sanitizeCanvasLayout(JSON.parse(storage.getItem(key) || "{}"));
  } catch {
    return {};
  }
}

function writeLayout(storage, key, layout) {
  try {
    storage.setItem(key, JSON.stringify(sanitizeCanvasLayout(layout)));
  } catch {
    // Layout persistence is a convenience; storage failures should not block the canvas.
  }
}

function renderTags(card) {
  if (!card.tags?.length) {
    return "";
  }
  return `
    <div class="swarmlab-canvas-tag-row">
      ${card.tags.map((tag) => `<span class="swarmlab-canvas-tag">${escapeHtml(tag)}</span>`).join("")}
    </div>
  `;
}

function renderCardAction(card) {
  if (card.type === "agent" && card.ref?.sessionId) {
    return `
      <button class="swarmlab-canvas-open swarmlab-canvas-button" type="button" data-swarmlab-canvas-open-session="${escapeHtml(card.ref.sessionId)}">
        ${renderIcon(Bot)}
        <span>Open session</span>
      </button>
    `;
  }
  if (card.href) {
    return `
      <a class="swarmlab-canvas-open" href="${escapeHtml(card.href)}" target="_blank" rel="noreferrer">
        ${renderIcon(ExternalLink)}
        <span>Open</span>
      </a>
    `;
  }
  return "";
}

function renderCanvasCard(card, layout) {
  const icon = CARD_TYPE_ICONS[card.type] || Box;
  const action = renderCardAction(card);
  return `
    <article
      class="swarmlab-canvas-card is-${escapeHtml(card.type)}"
      data-swarmlab-canvas-card-id="${escapeHtml(card.id)}"
      data-swarmlab-canvas-card-type="${escapeHtml(card.type)}"
      style="--card-x: ${layout.x}px; --card-y: ${layout.y}px; width: ${layout.width}px; min-height: ${layout.height}px; z-index: ${layout.z};"
    >
      <div class="swarmlab-canvas-card-head">
        <span class="swarmlab-canvas-card-icon" aria-hidden="true">${renderIcon(icon)}</span>
        <div class="swarmlab-canvas-card-title">
          <strong>${escapeHtml(card.title)}</strong>
          <span>${escapeHtml([card.subtitle, card.status].filter(Boolean).join(" / "))}</span>
        </div>
      </div>
      ${card.detail ? `<div class="swarmlab-canvas-card-detail">${escapeHtml(card.detail)}</div>` : ""}
      ${renderTags(card)}
      ${card.meta ? `<div class="swarmlab-canvas-card-meta">${escapeHtml(card.meta)}</div>` : ""}
      ${action ? `<div class="swarmlab-canvas-card-actions">${action}</div>` : ""}
    </article>
  `;
}

function renderSnapshot(root, payload, { storage }) {
  const snapshot = normalizeNodeSnapshot(payload);
  const cards = buildCanvasCards(snapshot);
  const boardId = getCanvasBoardId(snapshot);
  const storageKey = getCanvasLayoutStorageKey(boardId);
  const savedLayout = readLayout(storage, storageKey);
  const layout = mergeCanvasLayout(cards, savedLayout);
  const meta = root.closest(".swarmlab-canvas-view")?.querySelector("[data-swarmlab-canvas-meta]");
  if (meta) {
    meta.textContent = `${snapshot.node.name} / ${cards.length} cards / ${snapshot.generatedAt}`;
  }

  root.dataset.swarmlabCanvasBoardId = boardId;
  root.dataset.swarmlabCanvasStorageKey = storageKey;
  root.__swarmlabCanvasLayout = layout;

  if (!cards.length) {
    root.innerHTML = renderCanvasShell({ status: "empty" });
    return;
  }

  root.innerHTML = `
    <div class="swarmlab-canvas-plane" data-swarmlab-canvas-plane>
      ${cards.map((card) => renderCanvasCard(card, layout[card.id])).join("")}
    </div>
  `;
}

function isInteractiveDragTarget(target, card) {
  if (!(target instanceof Element)) {
    return false;
  }
  if (!card.contains(target)) {
    return false;
  }
  return Boolean(target.closest("a, button, input, textarea, select, summary"));
}

function bindCardDrag(root, { storage }) {
  const active = {
    card: null,
    id: "",
    startClientX: 0,
    startClientY: 0,
    startX: 0,
    startY: 0,
    moved: false,
  };

  root.querySelectorAll("[data-swarmlab-canvas-card-id]").forEach((card) => {
    card.addEventListener("pointerdown", (event) => {
      if (!(card instanceof HTMLElement) || isInteractiveDragTarget(event.target, card)) {
        return;
      }
      const id = card.dataset.swarmlabCanvasCardId || "";
      const layout = root.__swarmlabCanvasLayout?.[id];
      if (!id || !layout) {
        return;
      }
      active.card = card;
      active.id = id;
      active.startClientX = event.clientX;
      active.startClientY = event.clientY;
      active.startX = Number(layout.x) || 0;
      active.startY = Number(layout.y) || 0;
      active.moved = false;
      card.classList.add("is-dragging");
      card.setPointerCapture?.(event.pointerId);
    });

    card.addEventListener("pointermove", (event) => {
      if (active.card !== card || !active.id) {
        return;
      }
      const dx = event.clientX - active.startClientX;
      const dy = event.clientY - active.startClientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        active.moved = true;
      }
      const x = Math.round(active.startX + dx);
      const y = Math.round(active.startY + dy);
      const layout = root.__swarmlabCanvasLayout?.[active.id];
      if (layout) {
        layout.x = x;
        layout.y = y;
        layout.z = Math.max(...Object.values(root.__swarmlabCanvasLayout || {}).map((item) => Number(item.z) || 0), 0) + 1;
      }
      card.style.setProperty("--card-x", `${x}px`);
      card.style.setProperty("--card-y", `${y}px`);
      card.style.zIndex = String(layout?.z || 1);
    });

    card.addEventListener("pointerup", (event) => {
      if (active.card !== card) {
        return;
      }
      card.classList.remove("is-dragging");
      card.releasePointerCapture?.(event.pointerId);
      const storageKey = root.dataset.swarmlabCanvasStorageKey || "";
      if (storageKey) {
        writeLayout(storage, storageKey, root.__swarmlabCanvasLayout || {});
      }
      active.card = null;
      active.id = "";
    });

    card.addEventListener("pointercancel", () => {
      if (active.card === card) {
        card.classList.remove("is-dragging");
        active.card = null;
        active.id = "";
      }
    });
  });
}

function bindCanvasActions(root, { onOpenSession, storage }) {
  bindCardDrag(root, { storage });
  root.querySelectorAll("[data-swarmlab-canvas-open-session]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sessionId = button.getAttribute("data-swarmlab-canvas-open-session") || "";
      if (sessionId && typeof onOpenSession === "function") {
        onOpenSession(sessionId);
      }
    });
  });
}

async function loadCanvas(root, options) {
  const { abortController, fetchImpl, storage } = options;
  root.innerHTML = renderCanvasShell();
  try {
    const payload = await fetchJson(SNAPSHOT_URL, {
      fetchImpl,
      signal: abortController.signal,
    });
    if (abortController.signal.aborted) {
      return;
    }
    renderSnapshot(root, payload, { storage });
    bindCanvasActions(root, options);
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }
    root.innerHTML = renderCanvasShell({
      status: "error",
      message: error?.message || "The local node snapshot endpoint is unavailable.",
    });
  }
}

export function mountSwarmlabCanvasView({
  documentRef = document,
  fetchImpl = fetch,
  storage = window.localStorage,
  onOpenSession = null,
} = {}) {
  const root = documentRef.querySelector(VIEW_ROOT_SELECTOR);
  if (!(root instanceof HTMLElement)) {
    return null;
  }

  injectCanvasStyles(documentRef);
  activeController?.abort();
  let currentController = new AbortController();
  activeController = currentController;
  const options = {
    abortController: currentController,
    documentRef,
    fetchImpl,
    storage,
    onOpenSession,
  };

  const refresh = () => {
    currentController.abort();
    currentController = new AbortController();
    activeController = currentController;
    void loadCanvas(root, {
      ...options,
      abortController: currentController,
    });
  };

  documentRef.querySelectorAll("[data-swarmlab-canvas-refresh]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      refresh();
    });
  });

  void loadCanvas(root, options);
  return {
    abort: () => currentController.abort(),
    refresh,
  };
}
