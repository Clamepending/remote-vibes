import {
  AlertCircle,
  AppWindow,
  Bot,
  Box,
  CheckSquare,
  ExternalLink,
  Globe2,
  Grip,
  HardDrive,
  Image as ImageIcon,
  Map as MapIcon,
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Terminal,
} from "lucide";
import {
  buildCanvasCards,
  getCanvasBoardId,
  getCanvasLayoutStorageKey,
  getCanvasViewportStorageKey,
  mergeCanvasLayout,
  normalizeNodeSnapshot,
  sanitizeCanvasLayout,
} from "./canvas-model.js";

const VIEW_ROOT_SELECTOR = "[data-swarmlab-canvas-root]";
const STYLE_ID = "swarmlab-canvas-styles";
const SNAPSHOT_URL = "/api/node/snapshot?mode=privileged";
const NARRATIVE_POLL_MS = 4_000;
const REMOTE_NODES_STORAGE_KEY = "swarmlab.canvas.remoteNodes.v1";
const REMOTE_NODE_FETCH_TIMEOUT_MS = 4_500;
const BOARD_WIDTH = 4_800;
const BOARD_HEIGHT = 3_200;
const DEFAULT_VIEWPORT = { x: 64, y: 48, zoom: 0.92 };
const CARD_TYPE_ICONS = {
  agent: Bot,
  approval: CheckSquare,
  app: AppWindow,
  artifact: ImageIcon,
  browser: Globe2,
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function slugPart(value, fallback = "remote-node") {
  return String(value || fallback)
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:._-]/g, "")
    .slice(0, 120) || fallback;
}

function roundViewport(viewport) {
  return {
    x: Math.round(Number(viewport?.x) || 0),
    y: Math.round(Number(viewport?.y) || 0),
    zoom: Math.round((Number(viewport?.zoom) || DEFAULT_VIEWPORT.zoom) * 100) / 100,
  };
}

function sanitizeViewport(value) {
  return {
    x: clamp(Math.round(Number(value?.x) || DEFAULT_VIEWPORT.x), -20_000, 20_000),
    y: clamp(Math.round(Number(value?.y) || DEFAULT_VIEWPORT.y), -20_000, 20_000),
    zoom: clamp(Number(value?.zoom) || DEFAULT_VIEWPORT.zoom, 0.35, 1.8),
  };
}

function injectCanvasStyles(documentRef = document) {
  if (documentRef.getElementById(STYLE_ID)) {
    return;
  }
  const style = documentRef.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.swarmlab-canvas-view {
  --canvas-bg: #181816;
  --canvas-panel: rgba(35, 34, 31, 0.94);
  --canvas-panel-soft: rgba(47, 45, 40, 0.9);
  --canvas-line: rgba(232, 222, 206, 0.13);
  --canvas-line-strong: rgba(232, 222, 206, 0.23);
  --canvas-text: #f3eee5;
  --canvas-muted: #aaa297;
  --canvas-faint: #786f65;
  --canvas-accent: #e07a3f;
  --canvas-accent-2: #74c7b8;
  --canvas-danger: #e98277;
  background: var(--canvas-bg);
  color: var(--canvas-text);
  overflow: hidden;
}
.swarmlab-canvas-toolbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 64px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--canvas-line);
  background: rgba(26, 25, 23, 0.95);
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
  width: 36px;
  height: 36px;
  border: 1px solid rgba(224, 122, 63, 0.45);
  background: rgba(224, 122, 63, 0.1);
  color: var(--canvas-accent);
}
.swarmlab-canvas-title strong {
  display: block;
  font-size: 15px;
  font-weight: 760;
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
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  border: 1px solid var(--canvas-line-strong);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--canvas-text);
  padding: 0 12px;
  font: inherit;
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
}
.swarmlab-canvas-button:hover {
  border-color: rgba(224, 122, 63, 0.55);
  background: rgba(224, 122, 63, 0.1);
}
.swarmlab-canvas-button.is-primary {
  border-color: rgba(224, 122, 63, 0.55);
  background: rgba(224, 122, 63, 0.16);
}
.swarmlab-canvas-stage {
  position: relative;
  height: calc(100vh - 65px);
  min-height: 560px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background-color: #171715;
  background-image:
    radial-gradient(circle at center, rgba(232, 222, 206, 0.16) 1px, transparent 1.2px),
    radial-gradient(circle at 60% 20%, rgba(224, 122, 63, 0.08), transparent 28%),
    radial-gradient(circle at 18% 78%, rgba(116, 199, 184, 0.07), transparent 24%);
  background-size: 24px 24px, auto, auto;
}
.swarmlab-canvas-stage.is-panning {
  cursor: grabbing;
}
.swarmlab-canvas-plane {
  position: absolute;
  inset: 0 auto auto 0;
  width: ${BOARD_WIDTH}px;
  height: ${BOARD_HEIGHT}px;
  transform: translate3d(var(--canvas-pan-x), var(--canvas-pan-y), 0) scale(var(--canvas-zoom));
  transform-origin: 0 0;
  will-change: transform;
}
.swarmlab-canvas-card {
  position: absolute;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  border: 1px solid var(--canvas-line);
  border-radius: 8px;
  background: var(--canvas-panel);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.32);
  color: var(--canvas-text);
  transform: translate3d(var(--card-x), var(--card-y), 0);
  touch-action: none;
  user-select: text;
  overflow: hidden;
}
.swarmlab-canvas-card.is-dragging {
  border-color: rgba(224, 122, 63, 0.72);
  box-shadow: 0 34px 90px rgba(0, 0, 0, 0.46);
  user-select: none;
}
.swarmlab-canvas-card-head {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: start;
  padding: 14px 14px 11px;
  border-bottom: 1px solid rgba(232, 222, 206, 0.08);
  cursor: grab;
}
.swarmlab-canvas-card.is-dragging .swarmlab-canvas-card-head {
  cursor: grabbing;
}
.swarmlab-canvas-card-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  color: var(--canvas-accent-2);
  opacity: 0.95;
}
.swarmlab-canvas-card-title {
  min-width: 0;
}
.swarmlab-canvas-card-title strong {
  display: block;
  font-size: 13px;
  font-weight: 760;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.swarmlab-canvas-card-title span {
  display: block;
  margin-top: 3px;
  color: var(--canvas-muted);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.swarmlab-canvas-card.is-agent {
  background: rgba(31, 30, 27, 0.96);
}
.swarmlab-canvas-card.is-remote {
  border-color: rgba(116, 199, 184, 0.24);
}
.swarmlab-canvas-drag-grip {
  color: var(--canvas-faint);
}
.swarmlab-canvas-card-body {
  min-height: 0;
  padding: 13px 14px;
  color: var(--canvas-muted);
  font-size: 12px;
  line-height: 1.45;
  overflow: hidden;
}
.swarmlab-canvas-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 14px 13px;
  border-top: 1px solid rgba(232, 222, 206, 0.08);
  color: var(--canvas-faint);
  font-size: 11px;
}
.swarmlab-canvas-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.swarmlab-canvas-tag {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  max-width: 100%;
  padding: 0 7px;
  border: 1px solid rgba(232, 222, 206, 0.12);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.045);
  color: #d9d0c4;
  font-size: 11px;
}
.swarmlab-canvas-open {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--canvas-accent-2);
  text-decoration: none;
  font-size: 12px;
  white-space: nowrap;
}
.swarmlab-canvas-open:hover {
  text-decoration: underline;
}
.swarmlab-agent-chat-window {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
}
.swarmlab-agent-chat-feed {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 14px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.swarmlab-agent-message {
  max-width: 92%;
  border: 1px solid rgba(232, 222, 206, 0.09);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.06);
  color: #ddd5cb;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.swarmlab-agent-message span {
  display: block;
  margin-bottom: 4px;
  color: var(--canvas-faint);
  font-size: 10px;
  text-transform: uppercase;
}
.swarmlab-agent-message.is-user {
  align-self: flex-end;
  background: rgba(255, 255, 255, 0.09);
  color: var(--canvas-text);
}
.swarmlab-agent-message.is-agent {
  align-self: flex-start;
}
.swarmlab-agent-message.is-system {
  align-self: flex-start;
  max-width: 100%;
  border-style: dashed;
  color: #c8beb1;
}
.swarmlab-agent-message.is-loading,
.swarmlab-agent-message.is-error {
  align-self: center;
  max-width: 100%;
  color: var(--canvas-faint);
  text-align: center;
}
.swarmlab-agent-message.is-error {
  color: var(--canvas-danger);
}
.swarmlab-agent-composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin: 0 12px 12px;
  padding: 9px 10px;
  border: 1px solid rgba(232, 222, 206, 0.12);
  border-radius: 8px;
  background: rgba(18, 18, 16, 0.8);
  color: var(--canvas-muted);
  font-size: 12px;
}
.swarmlab-agent-composer textarea {
  width: 100%;
  min-width: 0;
  max-height: 86px;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: var(--canvas-text);
  font: inherit;
  line-height: 1.35;
}
.swarmlab-agent-composer textarea::placeholder {
  color: var(--canvas-muted);
}
.swarmlab-agent-composer button {
  min-width: 34px;
  height: 30px;
  padding: 0;
}
.swarmlab-agent-composer.is-sending button {
  opacity: 0.6;
  pointer-events: none;
}
.swarmlab-canvas-browser-body {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
}
.swarmlab-canvas-browser-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  border: 1px solid rgba(232, 222, 206, 0.1);
  border-radius: 7px;
  background: rgba(18, 18, 16, 0.75);
  padding: 7px 9px;
  color: #d9d0c4;
  overflow: hidden;
}
.swarmlab-canvas-browser-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--canvas-accent);
  opacity: 0.78;
}
.swarmlab-canvas-browser-url {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-canvas-browser-preview {
  display: grid;
  place-items: center;
  min-height: 130px;
  border: 1px dashed rgba(232, 222, 206, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--canvas-faint);
}
.swarmlab-port-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 10px;
}
.swarmlab-port-row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  color: #d9d0c4;
}
.swarmlab-port-row code {
  color: var(--canvas-accent-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.swarmlab-port-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-port-row small {
  color: var(--canvas-faint);
}
.swarmlab-canvas-floating-controls {
  position: absolute;
  left: 50%;
  bottom: 18px;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  padding: 8px;
  border: 1px solid var(--canvas-line);
  border-radius: 8px;
  background: rgba(37, 35, 32, 0.92);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(14px);
}
.swarmlab-canvas-control-button {
  width: 38px;
  height: 36px;
  min-height: 36px;
  padding: 0;
}
.swarmlab-canvas-zoom-readout {
  min-width: 48px;
  color: var(--canvas-muted);
  font-size: 12px;
  text-align: center;
}
.swarmlab-canvas-hint {
  position: absolute;
  left: 18px;
  bottom: 20px;
  z-index: 24;
  color: var(--canvas-faint);
  font-size: 11px;
  pointer-events: none;
}
.swarmlab-canvas-loading,
.swarmlab-canvas-empty,
.swarmlab-canvas-error {
  display: grid;
  place-items: center;
  min-height: 360px;
  margin: 24px;
  border: 1px solid var(--canvas-line);
  border-radius: 8px;
  background: rgba(28, 27, 25, 0.78);
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
  .swarmlab-canvas-hint {
    display: none;
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
          <p>Start an agent, open a browser task, or publish an artifact and refresh this view.</p>
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
            <span data-swarmlab-canvas-meta>spatial agent board</span>
          </div>
        </div>
        <div class="swarmlab-canvas-actions">
          <button class="swarmlab-canvas-button is-primary" type="button" data-swarmlab-canvas-add-node>
            ${renderIcon(HardDrive)}
            <span>Add machine</span>
          </button>
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

async function fetchJson(url, { fetchImpl = fetch, signal, method = "GET", body = null } = {}) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Vibe-Research-API": "1",
    },
    body: body == null ? undefined : JSON.stringify(body),
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

function timeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (parentSignal?.aborted) {
    abort();
  } else {
    parentSignal?.addEventListener?.("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.("abort", abort);
    },
  };
}

function remoteNodeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function absoluteRemoteHref(href, baseUrl) {
  const text = String(href || "").trim();
  if (!text) return "";
  try {
    return new URL(text, baseUrl).href;
  } catch {
    return "";
  }
}

async function fetchRemoteNodeRecord(baseUrl, { fetchImpl, signal }) {
  const timeout = timeoutSignal(signal, REMOTE_NODE_FETCH_TIMEOUT_MS);
  try {
    const payload = await fetchJson(`${baseUrl}/api/node/snapshot?mode=redacted`, {
      fetchImpl,
      signal: timeout.signal,
    });
    return {
      baseUrl,
      host: remoteNodeHost(baseUrl),
      snapshot: normalizeNodeSnapshot(payload),
      error: null,
    };
  } catch (error) {
    return {
      baseUrl,
      host: remoteNodeHost(baseUrl),
      snapshot: null,
      error: error?.name === "AbortError" ? "timed out fetching redacted snapshot" : (error?.message || "unreachable"),
    };
  } finally {
    timeout.clear();
  }
}

async function fetchRemoteNodeRecords({ fetchImpl, signal, storage, currentOrigin }) {
  const urls = readRemoteNodeUrls(storage)
    .filter((url) => url && url !== currentOrigin);
  if (!urls.length) return [];
  return Promise.all(urls.map((url) => fetchRemoteNodeRecord(url, { fetchImpl, signal })));
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

function readViewport(storage, key) {
  try {
    const raw = JSON.parse(storage.getItem(key) || "null");
    return raw ? sanitizeViewport(raw) : { ...DEFAULT_VIEWPORT };
  } catch {
    return { ...DEFAULT_VIEWPORT };
  }
}

function writeViewport(storage, key, viewport) {
  try {
    storage.setItem(key, JSON.stringify(roundViewport(sanitizeViewport(viewport))));
  } catch {
    // Viewport persistence is best effort.
  }
}

function normalizeRemoteNodeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/i.test(url.protocol) || !url.hostname) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function readRemoteNodeUrls(storage) {
  try {
    const raw = JSON.parse(storage.getItem(REMOTE_NODES_STORAGE_KEY) || "[]");
    const values = Array.isArray(raw) ? raw : [];
    return [...new Set(values.map(normalizeRemoteNodeUrl).filter(Boolean))];
  } catch {
    return [];
  }
}

function writeRemoteNodeUrls(storage, urls) {
  try {
    storage.setItem(
      REMOTE_NODES_STORAGE_KEY,
      JSON.stringify([...new Set((urls || []).map(normalizeRemoteNodeUrl).filter(Boolean))]),
    );
  } catch {
    // Remote node watchlist is optional state; ignore storage failures.
  }
}

function applyRemoteNodeUrlParams(storage, locationRef) {
  if (!locationRef?.search) return [];
  const params = new URLSearchParams(locationRef.search);
  const requested = [
    ...params.getAll("node"),
    ...params.getAll("nodes").flatMap((value) => String(value || "").split(",")),
  ]
    .map(normalizeRemoteNodeUrl)
    .filter(Boolean);
  if (!requested.length) return readRemoteNodeUrls(storage);
  const merged = [...readRemoteNodeUrls(storage), ...requested];
  writeRemoteNodeUrls(storage, merged);
  return readRemoteNodeUrls(storage);
}

function compactText(value, max = 520) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
}

function renderTags(card, { limit = 5 } = {}) {
  if (!card.tags?.length) {
    return "";
  }
  return `
    <div class="swarmlab-canvas-tag-row">
      ${card.tags.slice(0, limit).map((tag) => `<span class="swarmlab-canvas-tag">${escapeHtml(tag)}</span>`).join("")}
    </div>
  `;
}

function shortPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parts = text.split("/").filter(Boolean);
  if (parts.length <= 3) return text;
  return `.../${parts.slice(-3).join("/")}`;
}

function renderCardAction(card) {
  if (card.type === "agent" && card.ref?.sessionId) {
    return `
      <button class="swarmlab-canvas-open swarmlab-canvas-button" type="button" data-swarmlab-canvas-open-session="${escapeHtml(card.ref.sessionId)}">
        ${renderIcon(Bot)}
        <span>Open</span>
      </button>
    `;
  }
  if (card.href) {
    return `
      <a class="swarmlab-canvas-open" href="${escapeHtml(card.href)}" target="_blank" rel="noreferrer">
        ${renderIcon(ExternalLink)}
        <span>${escapeHtml(card.ref?.actionLabel || "Open")}</span>
      </a>
    `;
  }
  return "";
}

function cardFrame(card, layout, body, footer = "") {
  const icon = CARD_TYPE_ICONS[card.type] || Box;
  const sessionId = card.ref?.sessionId ? ` data-swarmlab-canvas-session-id="${escapeHtml(card.ref.sessionId)}"` : "";
  const remoteClass = card.ref?.remoteUrl ? " is-remote" : "";
  return `
    <article
      class="swarmlab-canvas-card is-${escapeHtml(card.type)}${remoteClass}"
      data-swarmlab-canvas-card-id="${escapeHtml(card.id)}"
      data-swarmlab-canvas-card-type="${escapeHtml(card.type)}"
      ${sessionId}
      style="--card-x: ${layout.x}px; --card-y: ${layout.y}px; width: ${layout.width}px; height: ${layout.height}px; z-index: ${layout.z};"
    >
      <div class="swarmlab-canvas-card-head" data-swarmlab-card-drag-handle>
        <span class="swarmlab-canvas-card-icon" aria-hidden="true">${renderIcon(icon)}</span>
        <div class="swarmlab-canvas-card-title">
          <strong>${escapeHtml(card.title)}</strong>
          <span>${escapeHtml([card.subtitle, card.status].filter(Boolean).join(" / "))}</span>
        </div>
        <span class="swarmlab-canvas-drag-grip" aria-hidden="true">${renderIcon(Grip, { width: 16, height: 16 })}</span>
      </div>
      ${body}
      ${footer}
    </article>
  `;
}

function renderAgentCard(card, layout) {
  if (card.ref?.remoteUrl) {
    return renderStandardCard(card, layout);
  }
  const cwd = shortPath(card.detail);
  const status = [card.subtitle, card.status].filter(Boolean).join(" / ") || "agent session";
  const body = `
    <div class="swarmlab-agent-chat-window">
      <div class="swarmlab-agent-chat-feed" data-swarmlab-agent-chat-feed data-swarmlab-agent-session-id="${escapeHtml(card.ref?.sessionId || "")}">
        <div class="swarmlab-agent-message is-user">
          <span>Workspace</span>
          ${escapeHtml(cwd || "default project")}
        </div>
        <div class="swarmlab-agent-message is-agent">
          <span>${escapeHtml(status)}</span>
          ${escapeHtml(card.meta ? `Last activity ${card.meta}` : "Ready on this machine.")}
        </div>
        ${renderTags(card, { limit: 3 })}
      </div>
      <form class="swarmlab-agent-composer" data-swarmlab-agent-composer data-swarmlab-agent-session-id="${escapeHtml(card.ref?.sessionId || "")}">
        <textarea rows="1" name="input" placeholder="Message agent, @ for context, / for commands"></textarea>
        <button class="swarmlab-canvas-button" type="submit" title="Send">${renderIcon(Send)}</button>
      </form>
    </div>
  `;
  return cardFrame(card, layout, body);
}

function narrativeEntryText(entry) {
  return compactText(
    [
      entry?.text,
      entry?.summary,
      entry?.outputPreview,
      entry?.statusText,
    ].filter(Boolean).join(" "),
  );
}

function narrativeEntryClass(entry) {
  const kind = String(entry?.kind || entry?.role || "").toLowerCase();
  if (kind === "user" || kind === "human") return "is-user";
  if (kind === "assistant") return "is-agent";
  return "is-system";
}

function narrativeEntryLabel(entry) {
  const kind = String(entry?.kind || entry?.role || "").toLowerCase();
  if (entry?.label) return entry.label;
  if (kind === "user" || kind === "human") return "You";
  if (kind === "assistant") return "Agent";
  if (kind === "tool") return "Tool";
  return kind || "Status";
}

function renderNarrativeEntries(narrative) {
  const entries = Array.isArray(narrative?.entries) ? narrative.entries : [];
  const visible = entries
    .filter((entry) => narrativeEntryText(entry))
    .slice(-6);
  if (!visible.length) {
    return `
      <div class="swarmlab-agent-message is-loading">
        <span>Native chat</span>
        No messages yet.
      </div>
    `;
  }
  return visible.map((entry) => `
    <div class="swarmlab-agent-message ${narrativeEntryClass(entry)}" data-swarmlab-agent-entry-id="${escapeHtml(entry?.id || "")}">
      <span>${escapeHtml(narrativeEntryLabel(entry))}</span>
      ${escapeHtml(narrativeEntryText(entry))}
    </div>
  `).join("");
}

function updateAgentFeed(card, html) {
  const feed = card.querySelector("[data-swarmlab-agent-chat-feed]");
  if (!(feed instanceof HTMLElement)) return;
  feed.innerHTML = html;
  feed.scrollTop = feed.scrollHeight;
}

async function loadAgentNarrative(root, card, { fetchImpl, abortController }) {
  const sessionId = String(card?.dataset?.swarmlabCanvasSessionId || "").trim();
  if (!sessionId || !(card instanceof HTMLElement)) {
    return;
  }
  try {
    const payload = await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/narrative`, {
      fetchImpl,
      signal: abortController.signal,
    });
    if (abortController.signal.aborted) return;
    updateAgentFeed(card, renderNarrativeEntries(payload.narrative));
  } catch (error) {
    if (abortController.signal.aborted) return;
    updateAgentFeed(card, `
      <div class="swarmlab-agent-message is-error">
        <span>Native chat unavailable</span>
        ${escapeHtml(error?.message || "Could not load session narrative.")}
      </div>
    `);
  }
}

function clearAgentNarrativePoll(root) {
  const windowRef = root.ownerDocument?.defaultView || globalThis.window;
  if (root.__swarmlabCanvasNarrativePoll) {
    windowRef.clearInterval(root.__swarmlabCanvasNarrativePoll);
    root.__swarmlabCanvasNarrativePoll = null;
  }
}

function refreshAgentNarratives(root, options) {
  root.querySelectorAll(".swarmlab-canvas-card.is-agent:not(.is-remote)[data-swarmlab-canvas-session-id]").forEach((card) => {
    void loadAgentNarrative(root, card, options);
  });
}

function renderBrowserCard(card, layout) {
  const action = renderCardAction(card);
  const body = `
    <div class="swarmlab-canvas-card-body swarmlab-canvas-browser-body">
      <div class="swarmlab-canvas-browser-bar">
        <span class="swarmlab-canvas-browser-dot"></span>
        <span class="swarmlab-canvas-browser-dot"></span>
        <span class="swarmlab-canvas-browser-dot"></span>
        <span class="swarmlab-canvas-browser-url">${escapeHtml(card.detail || card.title)}</span>
      </div>
      <div class="swarmlab-canvas-browser-preview">
        ${renderIcon(Globe2, { width: 28, height: 28 })}
      </div>
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || "browser window")}</span>${action}</div>`;
  return cardFrame(card, layout, body, footer);
}

function renderAppCard(card, layout) {
  const ports = Array.isArray(card.ref?.ports) ? card.ref.ports : [];
  const portList = ports.length
    ? `
      <div class="swarmlab-port-list">
        ${ports.slice(0, 6).map((port) => `
          <div class="swarmlab-port-row">
            <code>${escapeHtml(port.label)}</code>
            <span>${escapeHtml(port.name)}</span>
            <small>${escapeHtml(port.access || "")}</small>
          </div>
        `).join("")}
      </div>
    `
    : "";
  const action = renderCardAction(card);
  const body = `
    <div class="swarmlab-canvas-card-body">
      ${card.detail ? `<div>${escapeHtml(card.detail)}</div>` : ""}
      ${portList}
      ${renderTags(card, { limit: 6 })}
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || "local app")}</span>${action}</div>`;
  return cardFrame(card, layout, body, footer);
}

function renderStandardCard(card, layout) {
  const action = renderCardAction(card);
  const body = `
    <div class="swarmlab-canvas-card-body">
      ${card.detail ? `<div>${escapeHtml(card.detail)}</div>` : ""}
      ${renderTags(card)}
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || "")}</span>${action}</div>`;
  return cardFrame(card, layout, body, footer);
}

function renderCanvasCard(card, layout) {
  if (card.type === "agent") return renderAgentCard(card, layout);
  if (card.type === "browser") return renderBrowserCard(card, layout);
  if (card.type === "app") return renderAppCard(card, layout);
  return renderStandardCard(card, layout);
}

function makeRemoteOfflineCard(record) {
  const host = record.host || remoteNodeHost(record.baseUrl);
  return {
    id: `remote:${slugPart(host)}`,
    type: "machine",
    title: host,
    subtitle: "remote node",
    status: "offline",
    detail: record.error || "Could not fetch redacted node snapshot.",
    meta: record.baseUrl,
    tags: ["remote", "unreachable"],
    href: absoluteRemoteHref("/?view=canvas", record.baseUrl),
    ref: {
      remoteUrl: record.baseUrl,
      actionLabel: "Open canvas",
    },
    width: 320,
    height: 170,
  };
}

function remoteCardsForRecord(record, remoteIndex) {
  if (!record.snapshot) {
    return [makeRemoteOfflineCard(record)];
  }
  const baseId = slugPart(record.snapshot.node.id || record.host, `remote-${remoteIndex + 1}`);
  return buildCanvasCards(record.snapshot).map((card) => {
    const sourceId = card.id;
    const isMachine = card.type === "machine";
    const href = isMachine
      ? absoluteRemoteHref("/?view=canvas", record.baseUrl)
      : absoluteRemoteHref(card.href, record.baseUrl);
    return {
      ...card,
      id: `remote:${baseId}:${sourceId}`,
      title: isMachine ? `${card.title} (${record.host})` : card.title,
      subtitle: [card.subtitle, isMachine ? "remote canvas" : "remote"].filter(Boolean).join(" / "),
      tags: ["remote", ...card.tags],
      href,
      ref: {
        ...(card.ref || {}),
        sourceCardId: sourceId,
        remoteUrl: record.baseUrl,
        actionLabel: isMachine ? "Open canvas" : "Open",
      },
    };
  });
}

function combineCanvasCards(localPayload, remoteRecords) {
  const snapshot = normalizeNodeSnapshot(localPayload);
  const cards = buildCanvasCards(snapshot);
  const remoteCards = remoteRecords.flatMap((record, index) => remoteCardsForRecord(record, index));
  return {
    snapshot,
    cards: [...cards, ...remoteCards],
    remoteRecords,
  };
}

function renderFloatingControls(viewport) {
  const zoom = Math.round((Number(viewport.zoom) || 1) * 100);
  return `
    <div class="swarmlab-canvas-floating-controls" data-swarmlab-canvas-controls>
      <button class="swarmlab-canvas-button swarmlab-canvas-control-button" type="button" data-swarmlab-canvas-zoom-out title="Zoom out">${renderIcon(Minus)}</button>
      <span class="swarmlab-canvas-zoom-readout" data-swarmlab-canvas-zoom-readout>${zoom}%</span>
      <button class="swarmlab-canvas-button swarmlab-canvas-control-button" type="button" data-swarmlab-canvas-zoom-in title="Zoom in">${renderIcon(Plus)}</button>
      <button class="swarmlab-canvas-button swarmlab-canvas-control-button" type="button" data-swarmlab-canvas-fit title="Fit cards">${renderIcon(Maximize2)}</button>
      <button class="swarmlab-canvas-button swarmlab-canvas-control-button" type="button" data-swarmlab-canvas-reset title="Reset view">${renderIcon(RotateCcw)}</button>
    </div>
    <div class="swarmlab-canvas-hint">drag empty board to pan · drag card headers to move · trackpad scroll pans · pinch zooms</div>
  `;
}

function applyViewport(root, viewport) {
  const next = sanitizeViewport(viewport);
  root.__swarmlabCanvasViewport = next;
  const plane = root.querySelector("[data-swarmlab-canvas-plane]");
  if (plane instanceof HTMLElement) {
    plane.style.setProperty("--canvas-pan-x", `${next.x}px`);
    plane.style.setProperty("--canvas-pan-y", `${next.y}px`);
    plane.style.setProperty("--canvas-zoom", String(next.zoom));
  }
  const readout = root.querySelector("[data-swarmlab-canvas-zoom-readout]");
  if (readout) {
    readout.textContent = `${Math.round(next.zoom * 100)}%`;
  }
}

function getCardsBounds(root) {
  const layout = root.__swarmlabCanvasLayout || {};
  const entries = Object.values(layout);
  if (!entries.length) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of entries) {
    const x = Number(item.x) || 0;
    const y = Number(item.y) || 0;
    const width = Number(item.width) || 260;
    const height = Number(item.height) || 180;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function fitViewportToCards(root) {
  const bounds = getCardsBounds(root);
  const rect = root.getBoundingClientRect();
  if (!bounds || rect.width <= 0 || rect.height <= 0) {
    return { ...DEFAULT_VIEWPORT };
  }
  const zoom = clamp(Math.min((rect.width - 180) / Math.max(1, bounds.width), (rect.height - 160) / Math.max(1, bounds.height)), 0.42, 1.12);
  return sanitizeViewport({
    x: (rect.width - bounds.width * zoom) / 2 - bounds.minX * zoom,
    y: (rect.height - bounds.height * zoom) / 2 - bounds.minY * zoom,
    zoom,
  });
}

function renderSnapshot(root, payload, { storage, remoteRecords = [] } = {}) {
  const { snapshot, cards } = combineCanvasCards(payload, remoteRecords);
  const boardId = remoteRecords.length
    ? `fleet:${slugPart(snapshot.node.id, "local")}`
    : getCanvasBoardId(snapshot);
  const storageKey = getCanvasLayoutStorageKey(boardId);
  const viewportKey = getCanvasViewportStorageKey(boardId);
  const savedLayout = readLayout(storage, storageKey);
  const viewport = readViewport(storage, viewportKey);
  const layout = mergeCanvasLayout(cards, savedLayout);
  const meta = root.closest(".swarmlab-canvas-view")?.querySelector("[data-swarmlab-canvas-meta]");
  if (meta) {
    const onlineRemotes = remoteRecords.filter((record) => record.snapshot).length;
    const offlineRemotes = remoteRecords.length - onlineRemotes;
    const remoteText = remoteRecords.length
      ? ` / ${onlineRemotes} remote online${offlineRemotes ? `, ${offlineRemotes} unreachable` : ""}`
      : "";
    meta.textContent = `${snapshot.node.name}${remoteText} / ${cards.length} windows / ${snapshot.generatedAt}`;
  }

  root.dataset.swarmlabCanvasBoardId = boardId;
  root.dataset.swarmlabCanvasStorageKey = storageKey;
  root.dataset.swarmlabCanvasViewportStorageKey = viewportKey;
  root.__swarmlabCanvasLayout = layout;
  root.__swarmlabCanvasViewport = viewport;

  if (!cards.length) {
    root.innerHTML = renderCanvasShell({ status: "empty" });
    return;
  }

  root.innerHTML = `
    <div
      class="swarmlab-canvas-plane"
      data-swarmlab-canvas-plane
      style="--canvas-pan-x: ${viewport.x}px; --canvas-pan-y: ${viewport.y}px; --canvas-zoom: ${viewport.zoom};"
    >
      ${cards.map((card) => renderCanvasCard(card, layout[card.id])).join("")}
    </div>
    ${renderFloatingControls(viewport)}
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

function bringCardToFront(root, id, card) {
  const layout = root.__swarmlabCanvasLayout?.[id];
  if (!layout) return;
  layout.z = Math.max(...Object.values(root.__swarmlabCanvasLayout || {}).map((item) => Number(item.z) || 0), 0) + 1;
  card.style.zIndex = String(layout.z);
}

function bindCardDrag(root, { storage }) {
  const active = {
    card: null,
    id: "",
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startX: 0,
    startY: 0,
  };

  root.querySelectorAll("[data-swarmlab-canvas-card-id]").forEach((card) => {
    card.addEventListener("pointerdown", (event) => {
      if (
        !(card instanceof HTMLElement)
        || isInteractiveDragTarget(event.target, card)
        || !(event.target instanceof Element)
        || !event.target.closest("[data-swarmlab-card-drag-handle]")
      ) {
        return;
      }
      const id = card.dataset.swarmlabCanvasCardId || "";
      const layout = root.__swarmlabCanvasLayout?.[id];
      if (!id || !layout) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      active.card = card;
      active.id = id;
      active.pointerId = event.pointerId;
      active.startClientX = event.clientX;
      active.startClientY = event.clientY;
      active.startX = Number(layout.x) || 0;
      active.startY = Number(layout.y) || 0;
      bringCardToFront(root, id, card);
      card.classList.add("is-dragging");
      card.setPointerCapture?.(event.pointerId);
    });

    card.addEventListener("pointermove", (event) => {
      if (active.card !== card || !active.id) {
        return;
      }
      const viewport = sanitizeViewport(root.__swarmlabCanvasViewport || DEFAULT_VIEWPORT);
      const dx = (event.clientX - active.startClientX) / viewport.zoom;
      const dy = (event.clientY - active.startClientY) / viewport.zoom;
      const x = Math.round(active.startX + dx);
      const y = Math.round(active.startY + dy);
      const layout = root.__swarmlabCanvasLayout?.[active.id];
      if (layout) {
        layout.x = x;
        layout.y = y;
      }
      card.style.setProperty("--card-x", `${x}px`);
      card.style.setProperty("--card-y", `${y}px`);
    });

    const finish = (event) => {
      if (active.card !== card) {
        return;
      }
      card.classList.remove("is-dragging");
      if (active.pointerId != null) {
        card.releasePointerCapture?.(active.pointerId);
      } else if (event?.pointerId != null) {
        card.releasePointerCapture?.(event.pointerId);
      }
      const storageKey = root.dataset.swarmlabCanvasStorageKey || "";
      if (storageKey) {
        writeLayout(storage, storageKey, root.__swarmlabCanvasLayout || {});
      }
      active.card = null;
      active.id = "";
      active.pointerId = null;
    };

    card.addEventListener("pointerup", finish);
    card.addEventListener("pointercancel", finish);
  });
}

function setViewport(root, storage, viewport) {
  const next = sanitizeViewport(viewport);
  applyViewport(root, next);
  const viewportKey = root.dataset.swarmlabCanvasViewportStorageKey || "";
  if (viewportKey) {
    writeViewport(storage, viewportKey, next);
  }
}

function zoomAtPoint(root, storage, clientX, clientY, nextZoom) {
  const rect = root.getBoundingClientRect();
  const viewport = sanitizeViewport(root.__swarmlabCanvasViewport || DEFAULT_VIEWPORT);
  const zoom = clamp(nextZoom, 0.35, 1.8);
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const boardX = (localX - viewport.x) / viewport.zoom;
  const boardY = (localY - viewport.y) / viewport.zoom;
  setViewport(root, storage, {
    x: localX - boardX * zoom,
    y: localY - boardY * zoom,
    zoom,
  });
}

function bindViewportPanAndZoom(root, { storage }) {
  const active = {
    panning: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startX: 0,
    startY: 0,
  };

  root.addEventListener("pointerdown", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest("[data-swarmlab-canvas-card-id], [data-swarmlab-canvas-controls], a, button, input, textarea, select")) {
      return;
    }
    const viewport = sanitizeViewport(root.__swarmlabCanvasViewport || DEFAULT_VIEWPORT);
    active.panning = true;
    active.pointerId = event.pointerId;
    active.startClientX = event.clientX;
    active.startClientY = event.clientY;
    active.startX = viewport.x;
    active.startY = viewport.y;
    root.classList.add("is-panning");
    root.setPointerCapture?.(event.pointerId);
  });

  root.addEventListener("pointermove", (event) => {
    if (!active.panning) {
      return;
    }
    setViewport(root, storage, {
      ...sanitizeViewport(root.__swarmlabCanvasViewport || DEFAULT_VIEWPORT),
      x: active.startX + event.clientX - active.startClientX,
      y: active.startY + event.clientY - active.startClientY,
    });
  });

  const finishPan = (event) => {
    if (!active.panning) {
      return;
    }
    active.panning = false;
    root.classList.remove("is-panning");
    if (active.pointerId != null) {
      root.releasePointerCapture?.(active.pointerId);
    } else if (event?.pointerId != null) {
      root.releasePointerCapture?.(event.pointerId);
    }
    active.pointerId = null;
  };

  root.addEventListener("pointerup", finishPan);
  root.addEventListener("pointercancel", finishPan);

  root.addEventListener("wheel", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-swarmlab-agent-chat-feed], textarea, input, select")) {
      return;
    }
    const viewport = sanitizeViewport(root.__swarmlabCanvasViewport || DEFAULT_VIEWPORT);
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.002);
      zoomAtPoint(root, storage, event.clientX, event.clientY, viewport.zoom * factor);
      return;
    }
    setViewport(root, storage, {
      ...viewport,
      x: viewport.x - event.deltaX,
      y: viewport.y - event.deltaY,
    });
  }, { passive: false });
}

function autosizeComposerInput(textarea) {
  if (!(textarea instanceof HTMLElement)) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(86, Math.max(24, textarea.scrollHeight))}px`;
}

async function sendAgentComposerInput(form, { fetchImpl, abortController }) {
  const sessionId = String(form?.dataset?.swarmlabAgentSessionId || "").trim();
  const textarea = form?.querySelector("textarea[name='input']");
  const input = textarea instanceof HTMLTextAreaElement ? textarea.value : "";
  const text = input.trim();
  if (!sessionId || !text) {
    return;
  }
  form.classList.add("is-sending");
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.disabled = true;
  }
  try {
    await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
      fetchImpl,
      signal: abortController.signal,
      method: "POST",
      body: {
        input: text,
        clientMessageId: `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      },
    });
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.value = "";
      autosizeComposerInput(textarea);
    }
    const card = form.closest(".swarmlab-canvas-card.is-agent");
    if (card) {
      updateAgentFeed(card, `
        <div class="swarmlab-agent-message is-loading">
          <span>Sent</span>
          Waiting for native chat refresh...
        </div>
      `);
    }
  } catch (error) {
    const card = form.closest(".swarmlab-canvas-card.is-agent");
    if (card) {
      updateAgentFeed(card, `
        <div class="swarmlab-agent-message is-error">
          <span>Send failed</span>
          ${escapeHtml(error?.message || "Could not send message.")}
        </div>
      `);
    }
  } finally {
    form.classList.remove("is-sending");
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.disabled = false;
      textarea.focus();
    }
  }
}

function bindAgentComposers(root, options) {
  root.querySelectorAll("[data-swarmlab-agent-composer]").forEach((form) => {
    if (!(form instanceof HTMLFormElement)) return;
    const textarea = form.querySelector("textarea[name='input']");
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.addEventListener("input", () => autosizeComposerInput(textarea));
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          form.requestSubmit();
        }
      });
      autosizeComposerInput(textarea);
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void sendAgentComposerInput(form, options).then(() => {
        refreshAgentNarratives(root, options);
      });
    });
  });
}

function bindCanvasActions(root, options) {
  const { onOpenSession, storage } = options;
  bindViewportPanAndZoom(root, { storage });
  bindCardDrag(root, { storage });
  bindAgentComposers(root, options);

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

  root.querySelector("[data-swarmlab-canvas-zoom-in]")?.addEventListener("click", (event) => {
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    const viewport = sanitizeViewport(root.__swarmlabCanvasViewport || DEFAULT_VIEWPORT);
    zoomAtPoint(root, storage, rect.left + rect.width / 2, rect.top + rect.height / 2, viewport.zoom * 1.15);
  });

  root.querySelector("[data-swarmlab-canvas-zoom-out]")?.addEventListener("click", (event) => {
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    const viewport = sanitizeViewport(root.__swarmlabCanvasViewport || DEFAULT_VIEWPORT);
    zoomAtPoint(root, storage, rect.left + rect.width / 2, rect.top + rect.height / 2, viewport.zoom / 1.15);
  });

  root.querySelector("[data-swarmlab-canvas-fit]")?.addEventListener("click", (event) => {
    event.preventDefault();
    setViewport(root, storage, fitViewportToCards(root));
  });

  root.querySelector("[data-swarmlab-canvas-reset]")?.addEventListener("click", (event) => {
    event.preventDefault();
    setViewport(root, storage, DEFAULT_VIEWPORT);
  });
}

async function loadCanvas(root, options) {
  const { abortController, fetchImpl, storage, currentOrigin } = options;
  clearAgentNarrativePoll(root);
  root.innerHTML = renderCanvasShell();
  try {
    const [payload, remoteRecords] = await Promise.all([
      fetchJson(SNAPSHOT_URL, {
        fetchImpl,
        signal: abortController.signal,
      }),
      fetchRemoteNodeRecords({
        fetchImpl,
        signal: abortController.signal,
        storage,
        currentOrigin,
      }),
    ]);
    if (abortController.signal.aborted) {
      return;
    }
    renderSnapshot(root, payload, { storage, remoteRecords });
    bindCanvasActions(root, options);
    refreshAgentNarratives(root, options);
    const windowRef = root.ownerDocument?.defaultView || globalThis.window;
    root.__swarmlabCanvasNarrativePoll = windowRef.setInterval(() => {
      if (!abortController.signal.aborted) {
        refreshAgentNarratives(root, options);
      }
    }, NARRATIVE_POLL_MS);
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
  const windowRef = documentRef.defaultView || globalThis.window;
  const locationRef = windowRef?.location || globalThis.location;
  applyRemoteNodeUrlParams(storage, locationRef);
  activeController?.abort();
  let currentController = new AbortController();
  activeController = currentController;
  const options = {
    abortController: currentController,
    documentRef,
    fetchImpl,
    storage,
    onOpenSession,
    currentOrigin: locationRef?.origin || "",
  };

  const refresh = () => {
    clearAgentNarrativePoll(root);
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

  documentRef.querySelectorAll("[data-swarmlab-canvas-add-node]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const entered = windowRef?.prompt?.("Paste a Swarmlab machine URL, for example https://cthulhu1.tailnet.ts.net") || "";
      const url = normalizeRemoteNodeUrl(entered);
      if (!url) {
        return;
      }
      writeRemoteNodeUrls(storage, [...readRemoteNodeUrls(storage), url]);
      refresh();
    });
  });

  void loadCanvas(root, options);
  return {
    abort: () => {
      clearAgentNarrativePoll(root);
      currentController.abort();
    },
    refresh,
  };
}
