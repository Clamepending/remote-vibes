import {
  AlertCircle,
  AppWindow,
  Archive,
  Bot,
  Box,
  CheckSquare,
  ExternalLink,
  Globe2,
  Grip,
  HardDrive,
  Image as ImageIcon,
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
} from "lucide";
import {
  buildCanvasCards,
  buildCanvasRegions,
  getCanvasCardMachineId,
  getCanvasCardRegionId,
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
const FLEET_NODES_URL = "/api/fleet/nodes";
const NODE_ACCOUNT_NODES_URL = "/api/node/account/nodes";
const ACCOUNT_NODES_URL = "/api/account/nodes";
const REMOTE_NODE_SNAPSHOT_PROXY_URL = "/api/node/remote-snapshot";
const NARRATIVE_POLL_MS = 4_000;
const REMOTE_NODES_STORAGE_KEY = "swarmlab.canvas.remoteNodes.v1";
const REMOTE_NODE_FETCH_TIMEOUT_MS = 4_500;
const BOARD_WIDTH = 4_800;
const BOARD_HEIGHT = 5_200;
const DEFAULT_VIEWPORT = { x: 64, y: 48, zoom: 0.92 };
const CARD_TYPE_ICONS = {
  agent: Bot,
  approval: CheckSquare,
  app: AppWindow,
  artifact: ImageIcon,
  browser: Globe2,
  brain: MessageSquare,
  handoff: Send,
  machine: HardDrive,
  summary: Archive,
};
const REGION_COLORS = ["#f97316", "#74c7b8", "#7aa2f7", "#9ece6a", "#e879f9", "#f6c177"];

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

function renderSwarmlabMark() {
  return `<span class="swarmlab-brand-mark" aria-hidden="true"></span>`;
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
  --canvas-accent: #f97316;
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
  border: 1px solid rgba(249, 115, 22, 0.42);
  background: rgba(249, 115, 22, 0.1);
}
.swarmlab-brand-mark {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: #f97316;
  box-shadow: 0 0 18px rgba(249, 115, 22, 0.42);
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
    radial-gradient(circle at center, rgba(232, 222, 206, 0.16) 1px, transparent 1.2px);
  background-size: 24px 24px;
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
.swarmlab-canvas-region {
  position: absolute;
  transform: translate3d(var(--region-x), var(--region-y), 0);
  width: var(--region-width);
  height: var(--region-height);
  border: 1px solid color-mix(in srgb, var(--region-accent) 42%, transparent);
  border-radius: 10px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--region-accent) 10%, transparent), transparent 34%),
    color-mix(in srgb, var(--region-accent) 4%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
  pointer-events: none;
}
.swarmlab-canvas-region.is-drop-target {
  border-color: color-mix(in srgb, var(--region-accent) 76%, white 8%);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--region-accent) 16%, transparent), transparent 38%),
    color-mix(in srgb, var(--region-accent) 8%, transparent);
}
.swarmlab-canvas-region-label {
  position: absolute;
  left: 18px;
  top: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 36px);
  color: var(--canvas-text);
}
.swarmlab-canvas-region-chip {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  border-radius: 4px;
  background: var(--region-accent);
  box-shadow: 0 0 18px color-mix(in srgb, var(--region-accent) 42%, transparent);
}
.swarmlab-canvas-region-title {
  min-width: 0;
}
.swarmlab-canvas-region-title strong,
.swarmlab-canvas-region-title span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-canvas-region-title strong {
  font-size: 12px;
  font-weight: 760;
}
.swarmlab-canvas-region-title span {
  margin-top: 2px;
  color: var(--canvas-muted);
  font-size: 10px;
}
.swarmlab-canvas-pipe-layer {
  position: absolute;
  inset: 0;
  width: ${BOARD_WIDTH}px;
  height: ${BOARD_HEIGHT}px;
  overflow: visible;
  pointer-events: none;
}
.swarmlab-canvas-pipe {
  fill: none;
  stroke: rgba(116, 199, 184, 0.46);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 9 9;
}
.swarmlab-canvas-pipe.is-transfer {
  stroke: rgba(249, 115, 22, 0.72);
  stroke-width: 2.5;
  stroke-dasharray: none;
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
.swarmlab-canvas-card.is-cross-region {
  border-color: rgba(249, 115, 22, 0.55);
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
.swarmlab-agent-transfer-bar {
  display: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 12px 12px 0;
  padding: 8px 9px;
  border: 1px solid rgba(249, 115, 22, 0.35);
  border-radius: 8px;
  background: rgba(249, 115, 22, 0.12);
  color: #f6d5be;
  font-size: 11px;
}
.swarmlab-canvas-card.is-cross-region .swarmlab-agent-transfer-bar {
  display: flex;
}
.swarmlab-canvas-agent-body {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}
.swarmlab-agent-transfer-bar span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-agent-transfer-bar button {
  min-height: 28px;
  padding: 0 9px;
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
.swarmlab-agent-composer.is-disabled {
  grid-template-columns: minmax(0, 1fr);
  color: var(--canvas-faint);
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
.swarmlab-canvas-app-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 9px;
  min-height: 0;
  height: 100%;
}
.swarmlab-canvas-app-frame-shell {
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(232, 222, 206, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
}
.swarmlab-canvas-app-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #0b0d0c;
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
.swarmlab-summary-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 10px;
}
.swarmlab-summary-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 26px;
  padding: 6px 8px;
  border: 1px solid rgba(232, 222, 206, 0.1);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.035);
}
.swarmlab-summary-row strong,
.swarmlab-summary-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-summary-row strong {
  color: #d9d0c4;
  font-size: 11px;
  font-weight: 650;
}
.swarmlab-summary-row small {
  color: var(--canvas-faint);
}
.swarmlab-handoff-steps,
.swarmlab-brain-notes {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 10px;
}
.swarmlab-handoff-step,
.swarmlab-brain-note {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 28px;
  padding: 7px 8px;
  border: 1px solid rgba(232, 222, 206, 0.1);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  color: #d9d0c4;
}
.swarmlab-brain-note {
  grid-template-columns: minmax(0, 1fr);
  text-decoration: none;
}
.swarmlab-brain-note:hover {
  border-color: rgba(116, 199, 184, 0.4);
}
.swarmlab-handoff-step span,
.swarmlab-brain-note strong,
.swarmlab-brain-note span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-handoff-step small,
.swarmlab-brain-note span {
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
          <span class="swarmlab-canvas-title-icon" aria-hidden="true">${renderSwarmlabMark()}</span>
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
          <button class="swarmlab-canvas-button" type="button" data-swarmlab-canvas-new-handoff>
            ${renderIcon(Send)}
            <span>Handoff</span>
          </button>
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
  const registryNode = typeof baseUrl === "string"
    ? { baseUrl: normalizeRemoteNodeUrl(baseUrl), url: normalizeRemoteNodeUrl(baseUrl) }
    : normalizeRegistryFleetNode(baseUrl);
  const normalizedBaseUrl = registryNode.baseUrl || registryNode.url;
  const timeout = timeoutSignal(signal, REMOTE_NODE_FETCH_TIMEOUT_MS);
  try {
    let payload = null;
    try {
      payload = await fetchRemoteNodeSnapshotViaProxy(normalizedBaseUrl, {
        fetchImpl,
        signal: timeout.signal,
      });
    } catch (proxyError) {
      if (!proxyError?.proxyUnavailable) {
        throw proxyError;
      }
      payload = await fetchJson(`${normalizedBaseUrl}/api/node/snapshot?mode=redacted`, {
        fetchImpl,
        signal: timeout.signal,
      });
    }
    return {
      baseUrl: normalizedBaseUrl,
      host: remoteNodeHost(normalizedBaseUrl),
      registryNode,
      snapshot: normalizeNodeSnapshot(payload),
      error: null,
    };
  } catch (error) {
    return {
      baseUrl: normalizedBaseUrl,
      host: remoteNodeHost(normalizedBaseUrl),
      registryNode,
      snapshot: null,
      error: error?.name === "AbortError" ? "timed out fetching redacted snapshot" : (error?.message || "unreachable"),
    };
  } finally {
    timeout.clear();
  }
}

async function fetchRemoteNodeSnapshotViaProxy(normalizedBaseUrl, { fetchImpl, signal }) {
  const response = await fetchImpl(`${REMOTE_NODE_SNAPSHOT_PROXY_URL}?baseUrl=${encodeURIComponent(normalizedBaseUrl)}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status === 404 || response.status === 405) {
    const error = new Error("remote snapshot proxy unavailable");
    error.proxyUnavailable = true;
    throw error;
  }
  if (!response.ok) {
    throw new Error(payload?.error || `Remote snapshot proxy failed with status ${response.status}`);
  }
  return payload;
}

function normalizeRegistryFleetNode(node) {
  const baseUrl = normalizeRemoteNodeUrl(node?.baseUrl || node?.url || node?.href);
  const connectionHints = Array.isArray(node?.connectionHints) ? node.connectionHints : [];
  const fallbackUrl = normalizeRemoteNodeUrl(connectionHints.find((hint) => hint?.url)?.url || "");
  const nodeId = String(node?.nodeId || node?.id || "").trim();
  return {
    id: String(node?.id || node?.nodeId || "").trim(),
    nodeId,
    source: String(node?.source || "").trim(),
    commandable: Boolean(node?.commandable),
    baseUrl: baseUrl || fallbackUrl,
    url: baseUrl || fallbackUrl,
    label: String(node?.label || "").trim(),
    displayName: String(node?.displayName || node?.name || "").trim(),
    status: String(node?.status || "").trim(),
    lastSeenAt: String(node?.lastSeenAt || node?.updatedAt || "").trim(),
    os: String(node?.os || "").trim(),
    swarmlabVersion: String(node?.swarmlabVersion || node?.version || "").trim(),
    counts: node?.counts && typeof node.counts === "object" ? node.counts : {},
    capabilities: node?.capabilities && typeof node.capabilities === "object" ? node.capabilities : {},
    connectionHints,
    lastError: String(node?.lastError || "").trim(),
  };
}

function normalizeFleetNodes(payload) {
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  return nodes
    .map(normalizeRegistryFleetNode)
    .filter((node) => node.baseUrl);
}

async function fetchRegistryNodes({ fetchImpl, signal }) {
  const payloads = await Promise.all([
    fetchJson(FLEET_NODES_URL, { fetchImpl, signal }).catch(() => null),
    fetchJson(NODE_ACCOUNT_NODES_URL, { fetchImpl, signal }).catch(() => null),
    fetchJson(ACCOUNT_NODES_URL, { fetchImpl, signal }).catch(() => null),
  ]);
  return [
    ...normalizeFleetNodes(payloads[0]).map((node) => ({ ...node, source: node.source || "fleet" })),
    ...normalizeFleetNodes(payloads[1]).map((node) => ({ ...node, source: node.source || "node-account", commandable: true })),
    ...normalizeFleetNodes(payloads[2]).map((node) => ({ ...node, source: node.source || "account", commandable: true })),
  ];
}

async function registerFleetNodeUrl(url, { fetchImpl, signal, source = "manual", snapshot = null, label = "", lastError = "" } = {}) {
  const normalizedUrl = normalizeRemoteNodeUrl(url);
  if (!normalizedUrl) return null;
  try {
    const payload = await fetchJson(FLEET_NODES_URL, {
      fetchImpl,
      signal,
      method: "POST",
      body: {
        url: normalizedUrl,
        source,
        ...(label ? { label } : {}),
        ...(snapshot ? { snapshot } : {}),
        ...(lastError ? { lastError } : {}),
      },
    });
    return payload?.node || null;
  } catch {
    return null;
  }
}

async function promoteRemoteNodeUrls(urls, { fetchImpl, signal, storage, source = "query" } = {}) {
  const normalizedUrls = [...new Set((urls || []).map(normalizeRemoteNodeUrl).filter(Boolean))];
  if (!normalizedUrls.length) return [];
  writeRemoteNodeUrls(storage, [...readRemoteNodeUrls(storage), ...normalizedUrls]);
  await Promise.all(normalizedUrls.map((url) => registerFleetNodeUrl(url, { fetchImpl, signal, source })));
  return normalizedUrls;
}

async function fetchRemoteNodeRecords({ fetchImpl, signal, storage, currentOrigin }) {
  const nodesByUrl = new Map();
  const addNode = (node) => {
    const normalized = normalizeRegistryFleetNode(node);
    if (!normalized.baseUrl || normalized.baseUrl === currentOrigin) return;
    const existing = nodesByUrl.get(normalized.baseUrl) || {};
    const counts = Object.keys(normalized.counts || {}).length ? normalized.counts : (existing.counts || {});
    const capabilities = Object.keys(normalized.capabilities || {}).length ? normalized.capabilities : (existing.capabilities || {});
    const connectionHints = normalized.connectionHints?.length ? normalized.connectionHints : (existing.connectionHints || []);
    nodesByUrl.set(normalized.baseUrl, {
      ...normalized,
      baseUrl: normalized.baseUrl,
      url: normalized.baseUrl,
      id: normalized.id || existing.id || "",
      label: normalized.label || existing.label || "",
      displayName: normalized.displayName || existing.displayName || "",
      source: normalized.source || existing.source || "",
      commandable: Boolean(normalized.commandable || existing.commandable),
      status: normalized.status || existing.status || "",
      lastSeenAt: normalized.lastSeenAt || existing.lastSeenAt || "",
      os: normalized.os || existing.os || "",
      swarmlabVersion: normalized.swarmlabVersion || existing.swarmlabVersion || "",
      counts,
      capabilities,
      connectionHints,
      lastError: normalized.lastError || existing.lastError || "",
    });
  };
  for (const node of await fetchRegistryNodes({ fetchImpl, signal })) {
    addNode(node);
  }
  for (const url of readRemoteNodeUrls(storage)) {
    addNode({ baseUrl: url });
  }
  const nodes = [...nodesByUrl.values()];
  if (!nodes.length) return [];
  const records = await Promise.all(nodes.map((node) => fetchRemoteNodeRecord(node, { fetchImpl, signal })));
  await Promise.all(records.map((record) => {
    if (!record.snapshot) return null;
    return registerFleetNodeUrl(record.baseUrl, {
      fetchImpl,
      signal,
      source: "snapshot",
      snapshot: record.snapshot,
      label: record.registryNode?.label || record.snapshot.node?.name || "",
    });
  }));
  return records;
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
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasExplicitScheme && !/^https?:\/\//i.test(raw)) return "";
  const withScheme = hasExplicitScheme ? raw : `https://${raw}`;
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

function readRemoteNodeUrlParams(locationRef) {
  if (!locationRef?.search) return [];
  const params = new URLSearchParams(locationRef.search);
  return [
    ...params.getAll("node"),
    ...params.getAll("nodes").flatMap((value) => String(value || "").split(",")),
  ]
    .map(normalizeRemoteNodeUrl)
    .filter(Boolean);
}

function applyRemoteNodeUrlParams(storage, locationRef) {
  const requested = readRemoteNodeUrlParams(locationRef);
  if (!requested.length) return readRemoteNodeUrls(storage);
  writeRemoteNodeUrls(storage, [...readRemoteNodeUrls(storage), ...requested]);
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

function regionAccent(region) {
  return REGION_COLORS[Math.abs(Number(region?.colorIndex) || 0) % REGION_COLORS.length];
}

function regionSummary(region) {
  return [region.subtitle, region.status].filter(Boolean).join(" / ") || region.detail || "machine region";
}

function renderCanvasRegion(region) {
  return `
    <section
      class="swarmlab-canvas-region"
      data-swarmlab-canvas-region-id="${escapeHtml(region.id)}"
      ${region.remoteNodeId ? `data-swarmlab-canvas-region-remote-node-id="${escapeHtml(region.remoteNodeId)}"` : ""}
      ${region.remoteUrl ? `data-swarmlab-canvas-region-remote-url="${escapeHtml(region.remoteUrl)}"` : ""}
      style="--region-x: ${region.x}px; --region-y: ${region.y}px; --region-width: ${region.width}px; --region-height: ${region.height}px; --region-accent: ${regionAccent(region)};"
    >
      <div class="swarmlab-canvas-region-label">
        <span class="swarmlab-canvas-region-chip" aria-hidden="true"></span>
        <span class="swarmlab-canvas-region-title">
          <strong>${escapeHtml(region.title || region.id)}</strong>
          <span>${escapeHtml(regionSummary(region))}</span>
        </span>
      </div>
    </section>
  `;
}

function cardCenter(layout = {}) {
  return {
    x: (Number(layout.x) || 0) + (Number(layout.width) || 0) / 2,
    y: (Number(layout.y) || 0) + (Number(layout.height) || 0) / 2,
  };
}

function regionControlPoint(region = {}) {
  return {
    x: (Number(region.x) || 0) + Math.min(260, Math.max(80, (Number(region.width) || 0) * 0.25)),
    y: (Number(region.y) || 0) + 40,
  };
}

function pipePath(from, to) {
  const midX = Math.round((from.x + to.x) / 2);
  return `M ${Math.round(from.x)} ${Math.round(from.y)} C ${midX} ${Math.round(from.y)}, ${midX} ${Math.round(to.y)}, ${Math.round(to.x)} ${Math.round(to.y)}`;
}

function renderCanvasPipes(cards, layout, regions, localMachineId) {
  const regionsById = new Map(regions.map((region) => [region.id, region]));
  const pipes = [];
  cards.forEach((card) => {
    const item = layout[card.id];
    if (!item) return;
    const homeRegionId = getCanvasCardMachineId(card);
    const assignedRegionId = getCanvasCardRegionId(card, item);
    const assignedRegion = regionsById.get(assignedRegionId);
    const cardPoint = cardCenter(item);
    if (homeRegionId !== assignedRegionId && assignedRegion) {
      const sourceRegion = regionsById.get(homeRegionId);
      if (sourceRegion) {
        pipes.push({
          kind: "transfer",
          cardId: card.id,
          sourceRegionId: homeRegionId,
          targetRegionId: assignedRegionId,
          path: pipePath(regionControlPoint(sourceRegion), cardPoint),
        });
      }
    }
    if (card.type === "agent" && card.ref?.remoteNodeId && card.ref?.remoteUrl && localMachineId && homeRegionId !== localMachineId) {
      const localRegion = regionsById.get(localMachineId);
      if (localRegion) {
        pipes.push({
          kind: "control",
          cardId: card.id,
          sourceRegionId: localMachineId,
          targetRegionId: homeRegionId,
          path: pipePath(regionControlPoint(localRegion), cardPoint),
        });
      }
    }
  });
  return pipes.map((pipe) => `
    <path
      class="swarmlab-canvas-pipe is-${escapeHtml(pipe.kind)}"
      data-swarmlab-canvas-pipe-card-id="${escapeHtml(pipe.cardId)}"
      data-swarmlab-canvas-pipe-source-region-id="${escapeHtml(pipe.sourceRegionId)}"
      data-swarmlab-canvas-pipe-target-region-id="${escapeHtml(pipe.targetRegionId)}"
      d="${escapeHtml(pipe.path)}"
    ></path>
  `).join("");
}

function renderCanvasPipeLayer(cards, layout, regions, localMachineId) {
  return `
    <svg class="swarmlab-canvas-pipe-layer" data-swarmlab-canvas-pipe-layer aria-hidden="true">
      ${renderCanvasPipes(cards, layout, regions, localMachineId)}
    </svg>
  `;
}

function isRegionCommandable(region, localMachineId) {
  return Boolean(region && (region.id === localMachineId || region.remoteNodeId));
}

function renderAgentTransferBarContent(card, layout, region, localMachineId) {
  if (!region) return "";
  const homeRegionId = getCanvasCardMachineId(card);
  const targetRegionId = getCanvasCardRegionId(card, layout);
  if (homeRegionId === targetRegionId) return "";
  const targetName = region.title || targetRegionId;
  if (!isRegionCommandable(region, localMachineId)) {
    return `<span>Pair ${escapeHtml(targetName)} before moving this agent there.</span>`;
  }
  return `
    <span>Capsule ready for ${escapeHtml(targetName)}</span>
    <button class="swarmlab-canvas-button" type="button" data-swarmlab-canvas-agent-capsule="${escapeHtml(card.id)}">
      ${renderIcon(Send)}
      <span>Move</span>
    </button>
  `;
}

function renderCardAction(card) {
  if (card.type === "handoff" && card.ref?.launchedSessionId && !card.ref?.remoteUrl) {
    return `
      <button class="swarmlab-canvas-open swarmlab-canvas-button" type="button" data-swarmlab-canvas-open-session="${escapeHtml(card.ref.launchedSessionId)}">
        ${renderIcon(Bot)}
        <span>Open agent</span>
      </button>
    `;
  }
  if (card.type === "handoff" && card.ref?.jobId && !card.ref?.remoteUrl) {
    return `
      <button class="swarmlab-canvas-open swarmlab-canvas-button" type="button" data-swarmlab-canvas-launch-handoff="${escapeHtml(card.ref.jobId)}">
        ${renderIcon(Send)}
        <span>Launch</span>
      </button>
    `;
  }
  if (card.type === "agent" && card.ref?.sessionId && !card.ref?.remoteUrl) {
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
  const remoteNodeId = card.ref?.remoteNodeId ? ` data-swarmlab-canvas-remote-node-id="${escapeHtml(card.ref.remoteNodeId)}"` : "";
  const remoteClass = card.ref?.remoteUrl ? " is-remote" : "";
  const machineId = getCanvasCardMachineId(card);
  const regionId = getCanvasCardRegionId(card, layout);
  const crossRegionClass = machineId !== regionId ? " is-cross-region" : "";
  return `
    <article
      class="swarmlab-canvas-card is-${escapeHtml(card.type)}${remoteClass}${crossRegionClass}"
      data-swarmlab-canvas-card-id="${escapeHtml(card.id)}"
      data-swarmlab-canvas-card-type="${escapeHtml(card.type)}"
      data-swarmlab-canvas-machine-id="${escapeHtml(machineId)}"
      data-swarmlab-canvas-region-id="${escapeHtml(regionId)}"
      ${sessionId}
      ${remoteNodeId}
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
    return renderRemoteAgentCard(card, layout);
  }
  const cwd = shortPath(card.detail);
  const status = [card.subtitle, card.status].filter(Boolean).join(" / ") || "agent session";
  const body = `
    <div class="swarmlab-canvas-agent-body">
      <div class="swarmlab-agent-transfer-bar" data-swarmlab-agent-transfer-bar></div>
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
    </div>
  `;
  return cardFrame(card, layout, body);
}

function renderRemoteAgentCard(card, layout) {
  const sessionId = card.ref?.sessionId || "";
  const remoteNodeId = card.ref?.remoteNodeId || "";
  const action = renderCardAction(card);
  const composer = remoteNodeId
    ? `
        <form class="swarmlab-agent-composer" data-swarmlab-agent-composer data-swarmlab-agent-session-id="${escapeHtml(sessionId)}" data-swarmlab-agent-remote-node-id="${escapeHtml(remoteNodeId)}">
          <textarea rows="1" name="input" placeholder="Message agent, @ for context, / for commands"></textarea>
          <button class="swarmlab-canvas-button" type="submit" title="Send">${renderIcon(Send)}</button>
        </form>
      `
    : `
        <div class="swarmlab-agent-composer is-disabled">
          <span>Pair this machine for native chat.</span>
        </div>
      `;
  const body = `
    <div class="swarmlab-canvas-agent-body">
      <div class="swarmlab-agent-transfer-bar" data-swarmlab-agent-transfer-bar></div>
      <div class="swarmlab-agent-chat-window">
        <div class="swarmlab-agent-chat-feed" data-swarmlab-agent-chat-feed data-swarmlab-agent-session-id="${escapeHtml(sessionId)}" data-swarmlab-agent-remote-node-id="${escapeHtml(remoteNodeId)}">
          <div class="swarmlab-agent-message is-agent">
            <span>${escapeHtml([card.subtitle, card.status].filter(Boolean).join(" / ") || "Remote agent")}</span>
            ${escapeHtml(card.meta || card.ref?.remoteUrl || "Ready")}
          </div>
          ${renderTags(card, { limit: 3 })}
        </div>
        ${composer}
      </div>
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || "")}</span>${action}</div>`;
  return cardFrame(card, layout, body, footer);
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
  const embedUrl = String(card.ref?.embedUrl || "").trim();
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
  if (embedUrl) {
    const body = `
      <div class="swarmlab-canvas-card-body swarmlab-canvas-app-preview">
        <div class="swarmlab-canvas-browser-bar">
          <span class="swarmlab-canvas-browser-dot"></span>
          <span class="swarmlab-canvas-browser-dot"></span>
          <span class="swarmlab-canvas-browser-dot"></span>
          <span class="swarmlab-canvas-browser-url">${escapeHtml(embedUrl)}</span>
        </div>
        <div class="swarmlab-canvas-app-frame-shell">
          <iframe
            class="swarmlab-canvas-app-frame"
            title="${escapeHtml(`${card.title} preview`)}"
            src="${escapeHtml(embedUrl)}"
            loading="lazy"
            referrerpolicy="no-referrer"
            sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
          ></iframe>
        </div>
      </div>
    `;
    const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.subtitle || "local app")}</span>${action}</div>`;
    return cardFrame(card, layout, body, footer);
  }
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

function renderHandoffCard(card, layout) {
  const steps = Array.isArray(card.ref?.steps) ? card.ref.steps : [];
  const action = renderCardAction(card);
  const body = `
    <div class="swarmlab-canvas-card-body">
      ${card.detail ? `<div>${escapeHtml(card.detail)}</div>` : ""}
      <div class="swarmlab-handoff-steps">
        ${steps.slice(0, 5).map((step) => `
          <div class="swarmlab-handoff-step">
            <span>${escapeHtml(step.title || step.id || "step")}</span>
            <small>${escapeHtml(step.status || "pending")}</small>
          </div>
        `).join("")}
      </div>
      ${renderTags(card, { limit: 4 })}
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || "machine handoff")}</span>${action}</div>`;
  return cardFrame(card, layout, body, footer);
}

function knowledgeBaseHref(notePath = "") {
  const normalized = String(notePath || "").trim();
  const params = new URLSearchParams({ view: "library" });
  if (normalized) {
    params.set("note", normalized);
  }
  return `/?${params.toString()}`;
}

function renderBrainCard(card, layout) {
  const notes = Array.isArray(card.ref?.notes) ? card.ref.notes : [];
  const action = renderCardAction(card);
  const body = `
    <div class="swarmlab-canvas-card-body">
      <div>${escapeHtml(`${card.ref?.noteCount || 0} markdown notes · ${card.ref?.edgeCount || 0} links`)}</div>
      <div class="swarmlab-brain-notes">
        ${notes.slice(0, 4).map((note) => `
          <a class="swarmlab-brain-note" href="${escapeHtml(knowledgeBaseHref(note.path))}">
            <strong>${escapeHtml(note.title || note.path || "Note")}</strong>
            <span>${escapeHtml(note.excerpt || note.path || "")}</span>
          </a>
        `).join("")}
      </div>
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || "brain")}</span>${action}</div>`;
  return cardFrame(card, layout, body, footer);
}

function renderSummaryCard(card, layout) {
  const items = Array.isArray(card.ref?.items) ? card.ref.items : [];
  const body = `
    <div class="swarmlab-canvas-card-body">
      ${card.detail ? `<div>${escapeHtml(card.detail)}</div>` : ""}
      <div class="swarmlab-summary-list">
        ${items.slice(0, 4).map((item) => `
          <div class="swarmlab-summary-row">
            <strong>${escapeHtml(item.title || "Item")}</strong>
            <small>${escapeHtml(item.status || item.meta || "")}</small>
          </div>
        `).join("")}
      </div>
      ${renderTags(card, { limit: 3 })}
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || "collapsed")}</span></div>`;
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
  if (card.type === "handoff") return renderHandoffCard(card, layout);
  if (card.type === "brain") return renderBrainCard(card, layout);
  if (card.type === "summary") return renderSummaryCard(card, layout);
  return renderStandardCard(card, layout);
}

function machineDetailFromRegistryNode(node = {}) {
  const counts = node.counts && typeof node.counts === "object" ? node.counts : {};
  const sessions = Number(counts.sessions || 0);
  const ports = Number(counts.ports || 0);
  const handoffs = Number(counts.handoffJobs || 0);
  const parts = [
    Number.isFinite(sessions) && sessions > 0 ? `${sessions} sessions` : "",
    Number.isFinite(ports) && ports > 0 ? `${ports} apps` : "",
    Number.isFinite(handoffs) && handoffs > 0 ? `${handoffs} handoffs` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

function machineTagsFromRegistryNode(node = {}) {
  const capabilities = node.capabilities && typeof node.capabilities === "object" ? node.capabilities : {};
  const roles = Array.isArray(capabilities.roles) ? capabilities.roles : [];
  return [
    "remote",
    node.status || "",
    Number(capabilities.gpuCount || 0) ? `${Number(capabilities.gpuCount)} gpu${Number(capabilities.gpuCount) === 1 ? "" : "s"}` : "",
    Number(capabilities.providerCount || 0) ? `${Number(capabilities.providerCount)} providers` : "",
    ...roles,
  ].filter(Boolean);
}

function makeRemoteOfflineCard(record) {
  const registryNode = record.registryNode || {};
  const host = record.host || remoteNodeHost(record.baseUrl);
  const title = registryNode.displayName || registryNode.label || host;
  const detail = machineDetailFromRegistryNode(registryNode) || record.error || registryNode.lastError || "Could not fetch redacted node snapshot.";
  const machineId = slugPart(registryNode.nodeId || registryNode.id || host, "remote-node");
  return {
    id: `remote:${slugPart(host)}`,
    type: "machine",
    title,
    subtitle: [registryNode.os, registryNode.swarmlabVersion, "remote node"].filter(Boolean).join(" / "),
    status: registryNode.status || "offline",
    detail,
    meta: registryNode.lastSeenAt || record.baseUrl,
    tags: machineTagsFromRegistryNode(registryNode).length ? machineTagsFromRegistryNode(registryNode) : ["remote", "unreachable"],
    href: absoluteRemoteHref("/?view=canvas", record.baseUrl),
    ref: {
      machineId,
      remoteNodeId: registryNode.commandable ? (registryNode.nodeId || registryNode.id || "") : "",
      remoteUrl: record.baseUrl,
      actionLabel: "Open canvas",
    },
    width: 320,
    height: 170,
  };
}

function remoteCardHref(card, baseUrl) {
  if (card.type === "machine") {
    return absoluteRemoteHref("/?view=canvas", baseUrl);
  }
  if (card.type === "agent" && card.ref?.sessionId) {
    return absoluteRemoteHref(`/?view=shell&sessionId=${encodeURIComponent(card.ref.sessionId)}`, baseUrl);
  }
  if (card.type === "handoff" && card.ref?.launchedSessionId) {
    return absoluteRemoteHref(`/?view=shell&sessionId=${encodeURIComponent(card.ref.launchedSessionId)}`, baseUrl);
  }
  if (card.type === "handoff") {
    return absoluteRemoteHref("/?view=canvas", baseUrl);
  }
  return absoluteRemoteHref(card.href, baseUrl);
}

function remoteCardActionLabel(card) {
  if (card.type === "machine") return "Open canvas";
  if (card.type === "agent") return "Open agent";
  if (card.type === "handoff" && card.ref?.launchedSessionId) return "Open agent";
  if (card.type === "handoff") return "Open canvas";
  return card.ref?.actionLabel || "Open";
}

function remoteCardsForRecord(record, remoteIndex) {
  if (!record.snapshot) {
    return [makeRemoteOfflineCard(record)];
  }
  const baseId = slugPart(record.snapshot.node.id || record.host, `remote-${remoteIndex + 1}`);
  const remoteNodeId = record.registryNode?.commandable
    ? (record.registryNode?.nodeId || record.snapshot.node.id || record.registryNode?.id || "")
    : "";
  return buildCanvasCards(record.snapshot).map((card) => {
    const sourceId = card.id;
    const isMachine = card.type === "machine";
    const href = remoteCardHref(card, record.baseUrl);
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
        remoteNodeId,
        remoteUrl: record.baseUrl,
        actionLabel: remoteCardActionLabel(card),
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
  const regions = buildCanvasRegions(cards, layout);
  const regionsById = Object.fromEntries(regions.map((region) => [region.id, region]));
  const cardsById = Object.fromEntries(cards.map((card) => [card.id, card]));
  const localMachineId = snapshot.node.id;
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
  root.__swarmlabCanvasCards = cards;
  root.__swarmlabCanvasCardsById = cardsById;
  root.__swarmlabCanvasRegions = regions;
  root.__swarmlabCanvasRegionsById = regionsById;
  root.__swarmlabCanvasLocalMachineId = localMachineId;

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
      ${regions.map((region) => renderCanvasRegion(region)).join("")}
      ${renderCanvasPipeLayer(cards, layout, regions, localMachineId)}
      ${cards.map((card) => renderCanvasCard(card, layout[card.id])).join("")}
    </div>
    ${renderFloatingControls(viewport)}
  `;
  refreshRegionPresentation(root);
}

function findRegionAtPoint(root, x, y) {
  const regions = Array.isArray(root.__swarmlabCanvasRegions) ? root.__swarmlabCanvasRegions : [];
  return regions.find((region) =>
    x >= region.x
      && x <= region.x + region.width
      && y >= region.y
      && y <= region.y + region.height,
  ) || null;
}

function refreshCanvasPipes(root) {
  const layer = root.querySelector("[data-swarmlab-canvas-pipe-layer]");
  if (!layer) return;
  layer.innerHTML = renderCanvasPipes(
    root.__swarmlabCanvasCards || [],
    root.__swarmlabCanvasLayout || {},
    root.__swarmlabCanvasRegions || [],
    root.__swarmlabCanvasLocalMachineId || "",
  );
}

function refreshCardRegionState(root, cardElement) {
  if (!(cardElement instanceof HTMLElement)) return;
  const id = cardElement.dataset.swarmlabCanvasCardId || "";
  const model = root.__swarmlabCanvasCardsById?.[id];
  const layout = root.__swarmlabCanvasLayout?.[id];
  if (!model || !layout) return;
  const machineId = getCanvasCardMachineId(model);
  const regionId = getCanvasCardRegionId(model, layout);
  cardElement.dataset.swarmlabCanvasMachineId = machineId;
  cardElement.dataset.swarmlabCanvasRegionId = regionId;
  cardElement.classList.toggle("is-cross-region", machineId !== regionId);
  const transferBar = cardElement.querySelector("[data-swarmlab-agent-transfer-bar]");
  if (transferBar instanceof HTMLElement) {
    const region = root.__swarmlabCanvasRegionsById?.[regionId] || null;
    transferBar.innerHTML = renderAgentTransferBarContent(model, layout, region, root.__swarmlabCanvasLocalMachineId || "");
  }
}

function refreshRegionPresentation(root) {
  root.querySelectorAll("[data-swarmlab-canvas-card-id]").forEach((cardElement) => {
    refreshCardRegionState(root, cardElement);
  });
  refreshCanvasPipes(root);
}

function updateRegionDropTarget(root, cardId) {
  const layout = root.__swarmlabCanvasLayout?.[cardId];
  if (!layout) return null;
  const center = cardCenter(layout);
  const region = findRegionAtPoint(root, center.x, center.y);
  root.querySelectorAll("[data-swarmlab-canvas-region-id]").forEach((regionElement) => {
    regionElement.classList.toggle(
      "is-drop-target",
      Boolean(region && regionElement.getAttribute("data-swarmlab-canvas-region-id") === region.id),
    );
  });
  return region;
}

function clearRegionDropTargets(root) {
  root.querySelectorAll("[data-swarmlab-canvas-region-id]").forEach((regionElement) => {
    regionElement.classList.remove("is-drop-target");
  });
}

function assignCardRegionFromPosition(root, cardId, cardElement) {
  const layout = root.__swarmlabCanvasLayout?.[cardId];
  if (!layout) return;
  const center = cardCenter(layout);
  const region = findRegionAtPoint(root, center.x, center.y);
  if (region) {
    layout.regionId = region.id;
  }
  refreshCardRegionState(root, cardElement);
  refreshCanvasPipes(root);
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
      updateRegionDropTarget(root, active.id);
      refreshCanvasPipes(root);
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
      assignCardRegionFromPosition(root, active.id, card);
      clearRegionDropTargets(root);
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
  const remoteNodeId = String(form?.dataset?.swarmlabAgentRemoteNodeId || "").trim();
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
    const clientMessageId = `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (remoteNodeId) {
      await fetchJson(`/api/account/nodes/${encodeURIComponent(remoteNodeId)}/commands`, {
        fetchImpl,
        signal: abortController.signal,
        method: "POST",
        body: {
          operation: "session.input.write",
          clientCommandId: clientMessageId,
          payload: {
            sessionId,
            input: text,
            clientMessageId,
          },
        },
      });
    } else {
      await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
        fetchImpl,
        signal: abortController.signal,
        method: "POST",
        body: {
          input: text,
          clientMessageId,
        },
      });
    }
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.value = "";
      autosizeComposerInput(textarea);
    }
    const card = form.closest(".swarmlab-canvas-card.is-agent");
    if (card) {
      updateAgentFeed(card, `
        <div class="swarmlab-agent-message is-loading">
          <span>${remoteNodeId ? "Queued" : "Sent"}</span>
          ${remoteNodeId ? "Waiting for remote node." : "Waiting for native chat refresh..."}
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

function inferAgentProviderId(card) {
  const explicit = String(card?.ref?.providerId || "").trim();
  if (explicit) return explicit;
  const candidates = [
    card?.subtitle,
    ...(Array.isArray(card?.tags) ? card.tags : []),
  ].map((value) => String(value || "").trim().toLowerCase());
  return candidates.find((value) => ["codex", "claude", "openswarm", "shell"].includes(value)) || "";
}

function buildAgentCapsulePrompt(card, { sourceRegion, targetRegion, targetIsLocal }) {
  const sourceMachineId = getCanvasCardMachineId(card);
  const sourceName = sourceRegion?.title || sourceMachineId;
  const targetMachineId = targetRegion?.id || "";
  const targetName = targetRegion?.title || targetMachineId;
  const tags = Array.isArray(card.tags) && card.tags.length ? card.tags.join(", ") : "none";
  return [
    "You are a Swarmlab agent capsule moved across the fleet canvas.",
    "",
    `Source agent: ${card.title || "agent"}`,
    `Source session id: ${card.ref?.sessionId || "unknown"}`,
    `Source machine id: ${sourceMachineId}`,
    `Source machine: ${sourceName}`,
    `Target machine id: ${targetMachineId}`,
    `Target machine: ${targetName}`,
    `Target location: ${targetIsLocal ? "local Swarmlab node" : "remote paired Swarmlab node"}`,
    `Provider hint: ${inferAgentProviderId(card) || "default"}`,
    `Source status: ${[card.subtitle, card.status].filter(Boolean).join(" / ") || "unknown"}`,
    `Last activity: ${card.meta || "unknown"}`,
    `Workspace hint: ${card.ref?.cwd || card.detail || "default workspace"}`,
    `Tags: ${tags}`,
    "",
    "Continue the work from the source agent as faithfully as possible. First reconstruct the likely state from this capsule, then inspect local files or services on this machine before making changes. If an artifact or model must move from another machine, ask for or use the available handoff path instead of pretending the bytes are already present.",
  ].join("\n");
}

function buildAgentCapsulePayload(card, { sourceRegion, targetRegion, targetIsLocal }) {
  const sourceMachineId = getCanvasCardMachineId(card);
  const providerId = inferAgentProviderId(card);
  const canReuseWorkspace = targetRegion?.id === sourceMachineId || targetIsLocal;
  return {
    ...(providerId ? { providerId } : {}),
    name: `Moved: ${card.title || "Agent"}`,
    cwd: canReuseWorkspace ? String(card.ref?.cwd || card.detail || "").trim() : "",
    initialPrompt: buildAgentCapsulePrompt(card, { sourceRegion, targetRegion, targetIsLocal }),
    initialPromptDelayMs: 800,
  };
}

async function launchAgentCapsule(button, root, { fetchImpl, abortController, onOpenSession, refresh }) {
  const cardId = button.getAttribute("data-swarmlab-canvas-agent-capsule") || "";
  const card = root.__swarmlabCanvasCardsById?.[cardId];
  const layout = root.__swarmlabCanvasLayout?.[cardId];
  if (!card || !layout) {
    return;
  }
  const sourceRegionId = getCanvasCardMachineId(card);
  const targetRegionId = getCanvasCardRegionId(card, layout);
  const regionsById = root.__swarmlabCanvasRegionsById || {};
  const sourceRegion = regionsById[sourceRegionId] || null;
  const targetRegion = regionsById[targetRegionId] || null;
  const localMachineId = root.__swarmlabCanvasLocalMachineId || "";
  const targetIsLocal = targetRegionId === localMachineId;
  if (!targetRegion || sourceRegionId === targetRegionId) {
    return;
  }
  if (!targetIsLocal && !targetRegion.remoteNodeId) {
    button.textContent = "Pair target first";
    return;
  }
  const payload = buildAgentCapsulePayload(card, { sourceRegion, targetRegion, targetIsLocal });
  button.setAttribute("disabled", "true");
  try {
    if (targetIsLocal) {
      const result = await fetchJson("/api/sessions", {
        fetchImpl,
        signal: abortController.signal,
        method: "POST",
        body: payload,
      });
      const sessionId = result?.session?.id || "";
      button.textContent = "Moved";
      if (sessionId && typeof onOpenSession === "function") {
        onOpenSession(sessionId);
      } else if (typeof refresh === "function") {
        refresh();
      }
      return;
    }
    const clientCommandId = `capsule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await fetchJson(`/api/account/nodes/${encodeURIComponent(targetRegion.remoteNodeId)}/commands`, {
      fetchImpl,
      signal: abortController.signal,
      method: "POST",
      body: {
        operation: "session.create",
        clientCommandId,
        payload,
      },
    });
    button.textContent = "Queued";
    const cardElement = root.querySelector(`[data-swarmlab-canvas-card-id="${CSS.escape(cardId)}"]`);
    if (cardElement) {
      updateAgentFeed(cardElement, `
        <div class="swarmlab-agent-message is-loading">
          <span>Capsule queued</span>
          Starting ${escapeHtml(card.title || "agent")} on ${escapeHtml(targetRegion.title || targetRegion.id)}.
        </div>
      `);
    }
  } catch (error) {
    button.removeAttribute("disabled");
    button.textContent = error?.message || "Move failed";
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
  const { onOpenSession, storage, fetchImpl, abortController, refresh } = options;
  root.__swarmlabCanvasActionOptions = options;
  bindViewportPanAndZoom(root, { storage });
  bindCardDrag(root, { storage });
  bindAgentComposers(root, options);

  if (!root.__swarmlabCanvasCapsuleBound) {
    root.__swarmlabCanvasCapsuleBound = true;
    root.addEventListener("click", (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("[data-swarmlab-canvas-agent-capsule]")
        : null;
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      void launchAgentCapsule(button, root, root.__swarmlabCanvasActionOptions || {});
    });
  }

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

  root.querySelectorAll("[data-swarmlab-canvas-launch-handoff]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const jobId = button.getAttribute("data-swarmlab-canvas-launch-handoff") || "";
      if (!jobId) return;
      button.setAttribute("disabled", "true");
      try {
        const payload = await fetchJson(`/api/handoff/jobs/${encodeURIComponent(jobId)}/launch`, {
          fetchImpl,
          signal: abortController.signal,
          method: "POST",
          body: {},
        });
        if (payload?.session?.id && typeof onOpenSession === "function") {
          onOpenSession(payload.session.id);
        } else if (typeof refresh === "function") {
          refresh();
        }
      } catch (error) {
        button.removeAttribute("disabled");
        button.textContent = error?.message || "Launch failed";
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
  const { abortController, fetchImpl, storage, currentOrigin, pendingParamNodeUrls = [] } = options;
  clearAgentNarrativePoll(root);
  root.innerHTML = renderCanvasShell();
  try {
    if (pendingParamNodeUrls.length) {
      await promoteRemoteNodeUrls(pendingParamNodeUrls, {
        fetchImpl,
        signal: abortController.signal,
        storage,
        source: "query",
      });
      pendingParamNodeUrls.splice(0);
    }
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
  const pendingParamNodeUrls = readRemoteNodeUrlParams(locationRef);
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
    pendingParamNodeUrls,
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
  options.refresh = refresh;

  documentRef.querySelectorAll("[data-swarmlab-canvas-refresh]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      refresh();
    });
  });

  documentRef.querySelectorAll("[data-swarmlab-canvas-add-node]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const entered = windowRef?.prompt?.("Paste a Swarmlab machine URL, for example https://cthulhu1.tailnet.ts.net") || "";
      const url = normalizeRemoteNodeUrl(entered);
      if (!url) {
        return;
      }
      writeRemoteNodeUrls(storage, [...readRemoteNodeUrls(storage), url]);
      await registerFleetNodeUrl(url, {
        fetchImpl,
        source: "manual",
      });
      refresh();
    });
  });

  documentRef.querySelectorAll("[data-swarmlab-canvas-new-handoff]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const objective = windowRef?.prompt?.("What should an agent move across machines?") || "";
      if (!objective.trim()) {
        return;
      }
      const targetText = windowRef?.prompt?.("Target SSH host or Swarmlab URL") || "";
      if (!targetText.trim()) {
        return;
      }
      const targetUrl = targetText.includes("@") ? "" : normalizeRemoteNodeUrl(targetText);
      await fetchJson("/api/handoff/jobs", {
        fetchImpl,
        method: "POST",
        body: {
          objective,
          title: objective.split(/\s+/u).slice(0, 8).join(" "),
          target: targetUrl
            ? { url: targetUrl, label: remoteNodeHost(targetUrl) }
            : { sshTarget: targetText.trim(), label: targetText.trim() },
        },
      });
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
