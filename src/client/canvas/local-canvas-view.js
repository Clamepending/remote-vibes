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
  X,
} from "lucide";
import {
  buildCanvasCards,
  buildCanvasLauncherCards,
  buildCanvasRegions,
  CANVAS_REGION_RESIZE_LIMITS,
  getRenderableCanvasCardIds,
  getRenderableCanvasCards,
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
const REMOTE_NODE_PAIR_URL = "/api/node/remote-pair";
const NARRATIVE_POLL_MS = 4_000;
const REMOTE_NODES_STORAGE_KEY = "swarmlab.canvas.remoteNodes.v1";
const LAUNCH_LIFECYCLE_STORAGE_PREFIX = "swarmlab.canvas.launches.v1";
const REMOTE_NODE_FETCH_TIMEOUT_MS = 4_500;
const BOARD_WIDTH = 4_800;
const BOARD_HEIGHT = 5_200;
const DEFAULT_VIEWPORT = { x: 28, y: 42, zoom: 0.74 };
const MAX_VISIBLE_DOCK_LAUNCHERS = 6;
const {
  minWidth: REGION_RESIZE_MIN_WIDTH,
  minHeight: REGION_RESIZE_MIN_HEIGHT,
  maxWidth: REGION_RESIZE_MAX_WIDTH,
  maxHeight: REGION_RESIZE_MAX_HEIGHT,
} = CANVAS_REGION_RESIZE_LIMITS;
const CARD_TYPE_ICONS = {
  agent: Bot,
  approval: CheckSquare,
  app: AppWindow,
  artifact: ImageIcon,
  browser: Globe2,
  brain: MessageSquare,
  handoff: Send,
  launcher: AppWindow,
  machine: HardDrive,
  monitor: Globe2,
  summary: Archive,
};
const REGION_COLORS = ["#f97316", "#74c7b8", "#7aa2f7", "#9ece6a", "#e879f9", "#f6c177"];
const TERMINAL_COMMAND_STATUSES = new Set(["completed", "failed", "expired", "cancelled", "canceled", "dismissed"]);

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
  gap: 14px;
  min-height: 48px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--canvas-line);
  background: rgba(26, 25, 23, 0.95);
  backdrop-filter: blur(14px);
}
.swarmlab-canvas-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.swarmlab-canvas-title-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(249, 115, 22, 0.42);
  background: rgba(249, 115, 22, 0.1);
}
.swarmlab-brand-mark {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 6px;
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
  gap: 7px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.swarmlab-canvas-advanced {
  position: relative;
}
.swarmlab-canvas-advanced > summary {
  list-style: none;
}
.swarmlab-canvas-advanced > summary::-webkit-details-marker {
  display: none;
}
.swarmlab-canvas-advanced-panel {
  position: absolute;
  right: 0;
  z-index: 30;
  display: grid;
  gap: 8px;
  min-width: 260px;
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--canvas-line);
  border-radius: 8px;
  background: rgba(27, 26, 24, 0.96);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
}
.swarmlab-canvas-advanced-panel p {
  margin: 0;
  color: var(--canvas-muted);
  font-size: 12px;
  line-height: 1.35;
}
.swarmlab-canvas-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  border: 1px solid var(--canvas-line-strong);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--canvas-text);
  padding: 0 10px;
  font: inherit;
  font-size: 11px;
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
.swarmlab-canvas-button.is-connected {
  border-color: rgba(116, 199, 184, 0.34);
  background: rgba(116, 199, 184, 0.08);
  color: color-mix(in srgb, var(--canvas-accent-2) 58%, var(--canvas-text));
}
.swarmlab-canvas-icon-button {
  width: 34px;
  padding: 0;
}
.swarmlab-canvas-launch-dock {
  position: absolute;
  left: 14px;
  right: auto;
  bottom: 14px;
  z-index: 26;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  width: max-content;
  max-width: min(760px, calc(100% - 248px));
  min-height: 38px;
  padding: 4px;
  border: 1px solid rgba(232, 222, 206, 0.14);
  border-radius: 10px;
  background: rgba(31, 30, 27, 0.92);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px);
  cursor: default;
  overflow: visible;
  pointer-events: auto;
  touch-action: pan-x;
}
.swarmlab-canvas-launch-dock.is-single-machine {
  grid-template-columns: auto minmax(0, 1fr);
}
.swarmlab-canvas-launch-machines {
  display: flex;
  align-items: stretch;
  gap: 5px;
  min-width: 0;
  max-width: 242px;
  overflow-x: auto;
  scrollbar-width: none;
}
.swarmlab-canvas-launch-machines::-webkit-scrollbar {
  display: none;
}
.swarmlab-canvas-launch-title,
.swarmlab-canvas-launch-machine {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  border: 1px solid rgba(232, 222, 206, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
}
.swarmlab-canvas-launch-title {
  gap: 6px;
  padding: 0 8px;
  color: var(--canvas-muted);
  font-size: 10px;
  font-weight: 760;
}
.swarmlab-canvas-launch-machine {
  gap: 6px;
  max-width: 112px;
  padding: 0 7px;
  color: var(--canvas-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.swarmlab-canvas-launch-machine.is-active {
  border-color: color-mix(in srgb, var(--machine-accent, var(--canvas-accent)) 42%, rgba(232, 222, 206, 0.18));
  background: color-mix(in srgb, var(--machine-accent, var(--canvas-accent)) 14%, rgba(255, 255, 255, 0.035));
  color: var(--canvas-text);
}
.swarmlab-canvas-launch-machine:hover {
  border-color: color-mix(in srgb, var(--machine-accent, var(--canvas-accent)) 52%, rgba(232, 222, 206, 0.18));
}
.swarmlab-canvas-launch-machine-text {
  min-width: 0;
}
.swarmlab-canvas-launch-machine-text strong,
.swarmlab-canvas-launch-machine-text span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-canvas-launch-machine-text strong {
  font-size: 10px;
  font-weight: 720;
  line-height: 1.15;
}
.swarmlab-canvas-launch-machine-text span {
  display: none;
}
.swarmlab-canvas-launch-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  min-width: 0;
  overflow: visible;
}
.swarmlab-canvas-launch-machine-label {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  color: var(--canvas-muted);
  font-size: 10px;
  font-weight: 680;
  text-transform: uppercase;
  white-space: nowrap;
}
.swarmlab-canvas-launch-machine-label span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.swarmlab-canvas-launch-chip {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 3px;
  background: var(--machine-accent, var(--canvas-accent));
  box-shadow: 0 0 14px color-mix(in srgb, var(--machine-accent, var(--canvas-accent)) 48%, transparent);
}
.swarmlab-canvas-launch-items {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: visible;
  scrollbar-width: none;
}
.swarmlab-canvas-launch-items::-webkit-scrollbar {
  display: none;
}
.swarmlab-canvas-launch-item {
  display: grid;
  flex: 0 0 54px;
  grid-template-rows: 17px 1fr;
  gap: 3px;
  place-items: center;
  align-items: center;
  width: 54px;
  min-height: 36px;
  border: 1px solid rgba(232, 222, 206, 0.13);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.055);
  color: var(--canvas-text);
  padding: 4px 5px;
  font: inherit;
  text-align: center;
  cursor: pointer;
}
.swarmlab-canvas-launch-item:hover {
  border-color: rgba(116, 199, 184, 0.42);
  background: rgba(116, 199, 184, 0.08);
}
.swarmlab-canvas-launch-item svg {
  color: var(--canvas-accent-2);
}
.swarmlab-canvas-launch-item strong,
.swarmlab-canvas-launch-item span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-canvas-launch-item strong {
  font-size: 10px;
  font-weight: 720;
  line-height: 1.05;
}
.swarmlab-canvas-launch-item span {
  color: var(--canvas-faint);
  font-size: 9px;
}
.swarmlab-canvas-launch-item > span > span {
  display: none;
}
.swarmlab-canvas-launch-more {
  position: relative;
  flex: 0 0 auto;
}
.swarmlab-canvas-launch-more > summary {
  list-style: none;
}
.swarmlab-canvas-launch-more > summary::-webkit-details-marker {
  display: none;
}
.swarmlab-canvas-launch-more-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 58px;
  min-height: 36px;
  border: 1px solid rgba(232, 222, 206, 0.13);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
  color: var(--canvas-muted);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
.swarmlab-canvas-launch-more-panel {
  position: absolute;
  left: auto;
  right: 0;
  bottom: calc(100% + 9px);
  z-index: 45;
  display: grid;
  grid-template-columns: repeat(3, 54px);
  gap: 6px;
  width: max-content;
  max-width: calc(100vw - 52px);
  max-height: 240px;
  padding: 8px;
  border: 1px solid rgba(232, 222, 206, 0.14);
  border-radius: 9px;
  background: rgba(29, 28, 25, 0.98);
  box-shadow: 0 20px 58px rgba(0, 0, 0, 0.42);
  overflow: auto;
}
.swarmlab-canvas-launch-more-panel .swarmlab-canvas-launch-item {
  width: 54px;
  flex-basis: 54px;
}
.swarmlab-canvas-stage {
  position: relative;
  height: calc(100vh - 116px);
  min-height: 540px;
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
.swarmlab-canvas-stage.is-card-dragging {
  cursor: grabbing;
}
.swarmlab-canvas-stage.is-region-resizing {
  cursor: nwse-resize;
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
.swarmlab-canvas-region.is-resizing {
  border-color: color-mix(in srgb, var(--region-accent) 78%, white 10%);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--region-accent) 15%, transparent), transparent 40%),
    color-mix(in srgb, var(--region-accent) 8%, transparent);
}
.swarmlab-canvas-region-drop-label {
  position: absolute;
  right: 18px;
  top: 15px;
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--region-accent) 32%, rgba(232, 222, 206, 0.2));
  border-radius: 7px;
  background: rgba(18, 17, 15, 0.62);
  color: var(--canvas-muted);
  font-size: 10px;
  font-weight: 720;
  opacity: 0;
  pointer-events: none;
  text-transform: uppercase;
  transform: translateY(-3px);
  transition: opacity 120ms ease, transform 120ms ease, border-color 120ms ease, background 120ms ease;
}
.swarmlab-canvas-stage.is-card-dragging .swarmlab-canvas-region-drop-label {
  opacity: 0.72;
  transform: translateY(0);
}
.swarmlab-canvas-region.is-drop-target .swarmlab-canvas-region-drop-label {
  border-color: color-mix(in srgb, var(--region-accent) 76%, white 8%);
  background: color-mix(in srgb, var(--region-accent) 16%, rgba(18, 17, 15, 0.88));
  color: var(--canvas-text);
  opacity: 1;
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
.swarmlab-canvas-region-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.swarmlab-canvas-region-title-row .swarmlab-canvas-region-resize {
  position: static;
  width: 21px;
  height: 21px;
  min-height: 21px;
  flex: 0 0 auto;
  border-radius: 6px;
  opacity: 0.64;
}
.swarmlab-canvas-region-name,
.swarmlab-canvas-region-summary {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-canvas-region-name {
  font-size: 12px;
  font-weight: 760;
}
.swarmlab-canvas-region-badges {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 5px;
}
.swarmlab-canvas-region-badge {
  border: 1px solid color-mix(in srgb, var(--region-accent) 28%, rgba(232, 222, 206, 0.2));
  border-radius: 5px;
  padding: 2px 5px;
  background: rgba(17, 16, 14, 0.46);
  color: color-mix(in srgb, var(--region-accent) 42%, var(--canvas-muted));
  font-size: 9px;
  font-weight: 680;
  letter-spacing: 0;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
}
.swarmlab-canvas-region-summary {
  margin-top: 2px;
  color: var(--canvas-muted);
  font-size: 10px;
}
.swarmlab-canvas-region-resize {
  position: absolute;
  right: 9px;
  bottom: 9px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--region-accent) 26%, rgba(232, 222, 206, 0.16));
  border-radius: 7px;
  background: rgba(18, 17, 15, 0.56);
  color: color-mix(in srgb, var(--region-accent) 34%, var(--canvas-muted));
  cursor: nwse-resize;
  opacity: 0.56;
  pointer-events: auto;
  touch-action: none;
  transition: opacity 120ms ease, border-color 120ms ease, background 120ms ease, color 120ms ease;
}
.swarmlab-canvas-region-resize.is-corner {
  right: -8px;
  bottom: -8px;
  width: 36px;
  height: 36px;
  min-height: 36px;
  border-radius: 10px;
  background:
    linear-gradient(135deg, transparent 47%, color-mix(in srgb, var(--region-accent) 22%, transparent) 48% 52%, transparent 53%),
    rgba(18, 17, 15, 0.78);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
  opacity: 0.78;
}
.swarmlab-canvas-region-resize.is-corner::after {
  content: "";
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 11px;
  height: 11px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  opacity: 0.72;
}
.swarmlab-canvas-region-resize:hover,
.swarmlab-canvas-region.is-resizing .swarmlab-canvas-region-resize {
  border-color: color-mix(in srgb, var(--region-accent) 58%, rgba(232, 222, 206, 0.22));
  background: color-mix(in srgb, var(--region-accent) 12%, rgba(18, 17, 15, 0.72));
  color: var(--canvas-text);
  opacity: 1;
}
.swarmlab-canvas-region-size {
  position: absolute;
  right: 36px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--region-accent) 26%, rgba(232, 222, 206, 0.14));
  border-radius: 6px;
  background: rgba(18, 17, 15, 0.68);
  color: var(--canvas-muted);
  font-size: 10px;
  font-weight: 680;
  opacity: 0;
  pointer-events: none;
  transform: translateY(3px);
  transition: opacity 120ms ease, transform 120ms ease;
}
.swarmlab-canvas-region:hover .swarmlab-canvas-region-size,
.swarmlab-canvas-region.is-resizing .swarmlab-canvas-region-size {
  opacity: 0.86;
  transform: translateY(0);
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
.swarmlab-canvas-pipe.is-resource {
  stroke: rgba(246, 193, 119, 0.72);
  stroke-width: 2.25;
  stroke-dasharray: 4 7;
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
  border-color: rgba(232, 222, 206, 0.16);
}
.swarmlab-canvas-card.is-agent .swarmlab-canvas-card-head {
  grid-template-columns: 26px minmax(0, 1fr) auto;
  padding: 16px 18px 13px;
}
.swarmlab-canvas-card.is-agent .swarmlab-canvas-card-icon {
  width: 26px;
  height: 26px;
}
.swarmlab-canvas-card.is-agent .swarmlab-canvas-card-title strong {
  font-size: 15px;
}
.swarmlab-canvas-card.is-agent .swarmlab-canvas-card-title span {
  font-size: 12px;
}
.swarmlab-canvas-card-tools {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.swarmlab-canvas-card.is-remote {
  border-color: rgba(116, 199, 184, 0.24);
}
.swarmlab-canvas-card.is-cross-region {
  border-color: rgba(249, 115, 22, 0.55);
}
.swarmlab-canvas-card.is-lifecycle {
  border-color: rgba(249, 115, 22, 0.38);
  background:
    linear-gradient(180deg, rgba(249, 115, 22, 0.07), transparent 46%),
    var(--canvas-panel);
}
.swarmlab-canvas-card.is-lifecycle .swarmlab-canvas-card-icon {
  color: var(--canvas-accent);
}
.swarmlab-canvas-card.is-monitor {
  border-color: rgba(246, 193, 119, 0.24);
  background:
    linear-gradient(180deg, rgba(246, 193, 119, 0.055), transparent 44%),
    var(--canvas-panel);
}
.swarmlab-canvas-card.is-monitor .swarmlab-canvas-card-icon {
  color: #f6c177;
}
.swarmlab-canvas-drag-grip {
  color: var(--canvas-faint);
}
.swarmlab-canvas-card-control {
  display: grid;
  place-items: center;
  width: 23px;
  height: 23px;
  min-height: 23px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--canvas-muted);
  cursor: pointer;
  opacity: 0.72;
}
.swarmlab-canvas-card-control:hover {
  border-color: rgba(232, 222, 206, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: var(--canvas-text);
  opacity: 1;
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
.swarmlab-canvas-lifecycle-body {
  display: grid;
  align-content: start;
  gap: 10px;
}
.swarmlab-canvas-lifecycle-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.swarmlab-canvas-lifecycle-status strong {
  color: var(--canvas-text);
  font-size: 12px;
}
.swarmlab-canvas-lifecycle-status span {
  flex: 0 0 auto;
  border: 1px solid rgba(249, 115, 22, 0.28);
  border-radius: 5px;
  padding: 3px 6px;
  background: rgba(249, 115, 22, 0.09);
  color: #f6d5be;
  font-size: 10px;
  text-transform: uppercase;
}
.swarmlab-canvas-lifecycle-detail {
  color: #cfc6bb;
  overflow-wrap: anywhere;
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
  height: 100%;
  background:
    radial-gradient(circle at 18px 18px, rgba(232, 222, 206, 0.055) 1px, transparent 1px) 0 0 / 28px 28px,
    rgba(12, 12, 10, 0.64);
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
  background: rgba(12, 12, 10, 0.28);
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
  gap: 12px;
  min-height: 0;
  padding: 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.swarmlab-agent-history-meta {
  display: flex;
  position: sticky;
  top: -1px;
  z-index: 1;
  justify-content: space-between;
  gap: 12px;
  margin: -2px -2px 2px;
  padding: 7px 8px;
  border: 1px solid rgba(232, 222, 206, 0.08);
  border-radius: 7px;
  background: rgba(14, 14, 12, 0.92);
  color: var(--canvas-faint);
  font-size: 11px;
  line-height: 1.3;
}
.swarmlab-agent-history-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.swarmlab-agent-message {
  max-width: min(92%, 560px);
  border: 1px solid rgba(232, 222, 206, 0.09);
  border-radius: 8px;
  padding: 11px 13px;
  background: rgba(255, 255, 255, 0.06);
  color: #ddd5cb;
  font-size: 13px;
  line-height: 1.48;
  overflow-wrap: anywhere;
}
.swarmlab-agent-message-text {
  white-space: pre-wrap;
}
.swarmlab-agent-message span {
  display: block;
  margin-bottom: 5px;
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
  max-width: min(100%, 610px);
  background: rgba(116, 199, 184, 0.055);
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
  align-self: end;
  margin: 0 16px 16px;
  min-height: 44px;
  max-height: 112px;
  padding: 7px 8px 7px 12px;
  border: 1px solid rgba(232, 222, 206, 0.16);
  border-radius: 8px;
  background: rgba(13, 13, 12, 0.94);
  color: var(--canvas-muted);
  font-size: 12px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
}
.swarmlab-agent-composer textarea {
  width: 100%;
  min-width: 0;
  min-height: 24px;
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
  min-width: 32px;
  height: 32px;
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
  align-content: center;
  gap: 8px;
  min-height: 130px;
  border: 1px dashed rgba(232, 222, 206, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--canvas-faint);
}
.swarmlab-canvas-browser-preview strong {
  color: #d9d0c4;
  font-size: 12px;
  font-weight: 650;
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
  background:
    linear-gradient(135deg, rgba(116, 199, 184, 0.08), transparent 45%),
    rgba(9, 10, 9, 0.88);
}
.swarmlab-canvas-app-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #0b0d0c;
}
.swarmlab-canvas-app-preview-placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 132px;
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
  right: 18px;
  bottom: 72px;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--canvas-line);
  border-radius: 8px;
  background: rgba(37, 35, 32, 0.92);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(14px);
}
.swarmlab-canvas-control-button {
  width: 34px;
  height: 32px;
  min-height: 32px;
  padding: 0;
}
.swarmlab-canvas-zoom-readout {
  min-width: 42px;
  color: var(--canvas-muted);
  font-size: 11px;
  text-align: center;
}
.swarmlab-canvas-hint {
  position: absolute;
  left: 18px;
  bottom: 72px;
  z-index: 24;
  color: var(--canvas-faint);
  font-size: 11px;
  pointer-events: none;
}
.swarmlab-canvas-notice {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 27;
  max-width: min(440px, calc(100% - 36px));
  padding: 9px 11px;
  border: 1px solid rgba(249, 115, 22, 0.36);
  border-radius: 8px;
  background: rgba(31, 24, 19, 0.94);
  color: #f6d5be;
  font-size: 12px;
  line-height: 1.35;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.34);
  pointer-events: none;
}
.swarmlab-canvas-notice[hidden] {
  display: none;
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
  .swarmlab-canvas-button span {
    max-width: 112px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .swarmlab-canvas-actions {
    justify-content: flex-start;
  }
  .swarmlab-canvas-hint {
    display: none;
  }
  .swarmlab-canvas-launch-dock {
    grid-template-columns: minmax(0, 1fr);
    bottom: 12px;
    max-width: calc(100% - 24px);
  }
  .swarmlab-canvas-launch-dock.is-single-machine {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .swarmlab-canvas-launch-machines {
    max-width: none;
  }
  .swarmlab-canvas-launch-item {
    flex-basis: 62px;
    width: 62px;
  }
  .swarmlab-canvas-launch-more-button {
    width: 64px;
  }
  .swarmlab-canvas-floating-controls {
    right: 12px;
    bottom: 72px;
  }
}
@media (max-width: 760px) {
  .swarmlab-canvas-toolbar {
    gap: 8px;
  }
  .swarmlab-canvas-actions {
    flex-wrap: nowrap;
    gap: 5px;
  }
  .swarmlab-canvas-actions > .swarmlab-canvas-button,
  .swarmlab-canvas-advanced > summary {
    width: 34px;
    min-width: 34px;
    padding: 0;
  }
  .swarmlab-canvas-actions > .swarmlab-canvas-button > span,
  .swarmlab-canvas-advanced > summary > span {
    display: none;
  }
  .swarmlab-canvas-title {
    gap: 8px;
  }
  .swarmlab-canvas-title span[data-swarmlab-canvas-meta] {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
          <button class="swarmlab-canvas-button is-primary" type="button" data-swarmlab-canvas-account-login aria-label="Vibe account" title="Vibe account">
            ${renderIcon(HardDrive)}
            <span data-swarmlab-canvas-account-label>Vibe account</span>
          </button>
          <button class="swarmlab-canvas-button" type="button" data-swarmlab-canvas-new-handoff aria-label="New handoff" title="New handoff">
            ${renderIcon(Send)}
            <span>Handoff</span>
          </button>
          <button class="swarmlab-canvas-button" type="button" data-swarmlab-canvas-refresh aria-label="Refresh canvas" title="Refresh canvas">
            ${renderIcon(RefreshCw)}
            <span>Refresh</span>
          </button>
          <details class="swarmlab-canvas-advanced">
            <summary class="swarmlab-canvas-button swarmlab-canvas-icon-button" aria-label="Advanced machine options" title="Advanced machine options">
              ${renderIcon(Plus)}
            </summary>
            <div class="swarmlab-canvas-advanced-panel">
              <p>Machines normally appear after you log in to Vibe Research on each curl-installed node.</p>
              <button class="swarmlab-canvas-button" type="button" data-swarmlab-canvas-add-node>
                ${renderIcon(HardDrive)}
                <span>Manual URL fallback</span>
              </button>
            </div>
          </details>
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

function canvasAccountStatus(payload = {}) {
  const status = payload?.account && typeof payload.account === "object" ? payload.account : payload;
  return status && typeof status === "object" ? status : {};
}

function canvasAccountName(status = {}) {
  const account = status.account && typeof status.account === "object" ? status.account : {};
  const label = account.login && account.login !== "local"
    ? `@${account.login}`
    : account.name || account.email || "";
  return compactText(label, 22);
}

function setCanvasAccountButtonState(button, { label = "", connected = false, busy = false, error = "" } = {}) {
  if (!(button instanceof HTMLElement)) return;
  const labelElement = button.querySelector("[data-swarmlab-canvas-account-label]");
  if (labelElement) {
    labelElement.textContent = label || (connected ? "Account linked" : "Vibe account");
  }
  button.classList.toggle("is-primary", !connected && !error);
  button.classList.toggle("is-connected", connected && !error);
  button.toggleAttribute("disabled", busy);
  button.dataset.swarmlabCanvasAccountConnected = connected ? "true" : "false";
  button.title = error
    ? error
    : connected
      ? "This machine is linked to your Vibe Research account. Other logged-in machines appear automatically."
      : "Log in to Vibe Research to link this machine and sync the fleet canvas.";
}

function applyCanvasAccountStatus(documentRef, payload = {}) {
  const status = canvasAccountStatus(payload);
  const connected = Boolean(status.connected || status.configured);
  const name = canvasAccountName(status);
  documentRef.querySelectorAll("[data-swarmlab-canvas-account-login]").forEach((button) => {
    setCanvasAccountButtonState(button, {
      connected,
      label: connected ? (name || "Account linked") : "Vibe account",
    });
  });
}

async function refreshCanvasAccountStatus(documentRef, { fetchImpl = fetch, signal } = {}) {
  try {
    const payload = await fetchJson("/api/node/account/status", { fetchImpl, signal });
    applyCanvasAccountStatus(documentRef, payload);
  } catch {
    documentRef.querySelectorAll("[data-swarmlab-canvas-account-login]").forEach((button) => {
      setCanvasAccountButtonState(button, { connected: false, label: "Vibe account" });
    });
  }
}

function currentCanvasAccountBaseUrl() {
  try {
    return globalThis.location?.origin || "";
  } catch {
    return "";
  }
}

function pairingGrantFromApproval(approval, accountBaseUrl) {
  const directGrant = String(approval?.grant || approval?.vibe_grant || "").trim();
  if (directGrant) return directGrant;
  const redirectUri = String(approval?.redirectUri || approval?.redirect_uri || "").trim();
  if (!redirectUri) return "";
  try {
    const parsed = new URL(redirectUri, accountBaseUrl || currentCanvasAccountBaseUrl() || undefined);
    return parsed.searchParams.get("grant") || parsed.searchParams.get("vibe_grant") || "";
  } catch {
    return "";
  }
}

async function postRemoteNodeJson(baseUrl, remotePath, { fetchImpl, signal, body = {} } = {}) {
  const remote = String(baseUrl || "").trim();
  if (!remote) {
    throw new Error("Remote node URL is required.");
  }
  const url = new URL(remotePath, remote).toString();
  return fetchJson(url, {
    fetchImpl,
    signal,
    method: "POST",
    body,
  });
}

async function pairCanvasRegionFromBrowser(region, { fetchImpl, signal } = {}) {
  const remoteUrl = String(region?.remoteUrl || "").trim();
  const label = regionDisplayName(region, region?.id || "") || "Swarmlab node";
  const accountBaseUrl = currentCanvasAccountBaseUrl();
  if (!accountBaseUrl) {
    throw new Error("Account URL is required to pair this machine.");
  }

  const startPayload = await postRemoteNodeJson(remoteUrl, "/api/node/account/pair/start", {
    fetchImpl,
    signal,
    body: {
      accountBaseUrl,
      appBaseUrl: accountBaseUrl,
      label,
      redirectUri: "",
    },
  });
  const pairing = startPayload?.pairing || startPayload || {};
  const pairingId = String(pairing?.pairingId || pairing?.id || "").trim();
  const pairingCode = String(pairing?.pairingCode || pairing?.code || "").trim();
  if (!pairingId) {
    throw new Error("Remote node did not create a pairing request.");
  }

  const approval = await fetchJson("/api/account/nodes/pairing/approve", {
    fetchImpl,
    signal,
    method: "POST",
    body: {
      pairingId,
      pairingCode,
    },
  });
  const grant = pairingGrantFromApproval(approval, accountBaseUrl);
  if (!grant) {
    throw new Error("Account did not approve a pairing grant.");
  }

  const completePayload = await postRemoteNodeJson(remoteUrl, "/api/node/account/pair/complete", {
    fetchImpl,
    signal,
    body: {
      accountBaseUrl,
      appBaseUrl: accountBaseUrl,
      grant,
      pairingId,
      label,
      redirectUri: "",
    },
  });

  let heartbeatPayload = null;
  try {
    heartbeatPayload = await postRemoteNodeJson(remoteUrl, "/api/node/account/heartbeat", {
      fetchImpl,
      signal,
      body: {
        reason: "browser-remote-pair",
        forceRegister: true,
      },
    });
  } catch {
    heartbeatPayload = null;
  }

  return {
    ok: true,
    baseUrl: remoteUrl,
    accountBaseUrl,
    pairing: { pairingId, status: "approved" },
    remote: {
      record: completePayload?.record || null,
      heartbeat: heartbeatPayload?.heartbeat || heartbeatPayload || null,
    },
  };
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

function snapshotFromRegistryNode(registryNode = {}, baseUrl = "", error = "") {
  const hasUsefulSummary = registryNode.nodeId ||
    registryNode.id ||
    registryNode.displayName ||
    registryNode.launchers?.length ||
    Object.keys(registryNode.counts || {}).length ||
    Object.keys(registryNode.capabilities || {}).length;
  if (!hasUsefulSummary) return null;
  const host = remoteNodeHost(baseUrl);
  const nodeId = registryNode.nodeId || registryNode.id || slugPart(host, "remote-node");
  return normalizeNodeSnapshot({
    schemaVersion: 1,
    mode: "redacted",
    generatedAt: registryNode.lastSeenAt || new Date(0).toISOString(),
    node: {
      id: nodeId,
      nodeId,
      name: registryNode.displayName || registryNode.label || host,
      displayName: registryNode.displayName || registryNode.label || host,
      status: registryNode.status || "offline",
      os: registryNode.os || "",
      version: registryNode.swarmlabVersion || "",
      lastSeenAt: registryNode.lastSeenAt || "",
    },
    status: registryNode.status || "offline",
    counts: registryNode.counts || {},
    capabilities: registryNode.capabilities || {},
    launchers: registryNode.launchers || [],
    sessions: [],
    ports: [],
    handoffJobs: [],
    degraded: error ? [{ source: "remoteSnapshot", error }] : [],
  });
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
      if (!proxyError?.proxyUnavailable && !proxyError?.directFallbackAllowed) {
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
    const errorText = error?.name === "AbortError" ? "timed out fetching redacted snapshot" : (error?.message || "unreachable");
    const fallbackSnapshot = snapshotFromRegistryNode(registryNode, normalizedBaseUrl, errorText);
    return {
      baseUrl: normalizedBaseUrl,
      host: remoteNodeHost(normalizedBaseUrl),
      registryNode,
      snapshot: fallbackSnapshot,
      error: errorText,
    };
  } finally {
    timeout.clear();
  }
}

async function fetchRemoteNodeSnapshotViaProxy(normalizedBaseUrl, { fetchImpl, signal }) {
  const response = await fetchImpl(`${REMOTE_NODE_SNAPSHOT_PROXY_URL}?baseUrl=${encodeURIComponent(normalizedBaseUrl)}&allowDirectFallback=1`, {
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
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    const error = new Error(payload?.error || "remote snapshot proxy could not reach node");
    error.directFallbackAllowed = true;
    throw error;
  }
  if (!response.ok) {
    throw new Error(payload?.error || `Remote snapshot proxy failed with status ${response.status}`);
  }
  if (payload?.directFallbackAllowed) {
    const error = new Error(payload?.error || "remote snapshot proxy could not reach node");
    error.directFallbackAllowed = true;
    throw error;
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
    launchers: Array.isArray(node?.launchers) ? node.launchers : [],
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

function isLocalNodeAlias(node, localNodeId = "") {
  const normalizedLocalNodeId = String(localNodeId || "").trim();
  if (!normalizedLocalNodeId) return false;
  const normalized = normalizeRegistryFleetNode(node);
  return Boolean(normalized.nodeId && normalized.nodeId === normalizedLocalNodeId);
}

function isLocalSnapshotAlias(record, localNodeId = "") {
  const normalizedLocalNodeId = String(localNodeId || "").trim();
  if (!normalizedLocalNodeId || !record) return false;
  const snapshotNodeId = String(record.snapshot?.node?.id || record.snapshot?.node?.nodeId || "").trim();
  const registryNodeId = String(record.registryNode?.nodeId || "").trim();
  return snapshotNodeId === normalizedLocalNodeId || registryNodeId === normalizedLocalNodeId;
}

async function fetchRemoteNodeRecords({ fetchImpl, signal, storage, currentOrigin, localNodeId = "" }) {
  const nodesByUrl = new Map();
  const addNode = (node) => {
    const normalized = normalizeRegistryFleetNode(node);
    if (!normalized.baseUrl || normalized.baseUrl === currentOrigin) return;
    if (isLocalNodeAlias(normalized, localNodeId)) return;
    const existing = nodesByUrl.get(normalized.baseUrl) || {};
    const counts = Object.keys(normalized.counts || {}).length ? normalized.counts : (existing.counts || {});
    const capabilities = Object.keys(normalized.capabilities || {}).length ? normalized.capabilities : (existing.capabilities || {});
    const launchers = normalized.launchers?.length ? normalized.launchers : (existing.launchers || []);
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
      launchers,
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
  const records = (await Promise.all(nodes.map((node) => fetchRemoteNodeRecord(node, { fetchImpl, signal }))))
    .filter((record) => !isLocalSnapshotAlias(record, localNodeId));
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

function readViewportState(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return { hasSavedViewport: false, viewport: { ...DEFAULT_VIEWPORT } };
    }
    const parsed = JSON.parse(raw);
    return {
      hasSavedViewport: Boolean(parsed),
      viewport: parsed ? sanitizeViewport(parsed) : { ...DEFAULT_VIEWPORT },
    };
  } catch {
    return { hasSavedViewport: false, viewport: { ...DEFAULT_VIEWPORT } };
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

function getLaunchLifecycleStorageKey(boardId) {
  return `${LAUNCH_LIFECYCLE_STORAGE_PREFIX}:${slugPart(boardId, "machine:local")}`;
}

function normalizeLaunchLifecycleStatus(value) {
  return String(value || "queued").trim().toLowerCase().replace(/\s+/g, "_") || "queued";
}

function normalizeLaunchLifecycle(item) {
  if (!item || typeof item !== "object") return null;
  const commandId = String(item.commandId || item.id || "").trim();
  const clientCommandId = String(item.clientCommandId || item.client_command_id || "").trim();
  const id = slugPart(item.lifecycleId || clientCommandId || commandId || `launch-${Date.now()}`, "launch");
  const operation = String(item.operation || "").trim();
  const remoteNodeId = String(item.remoteNodeId || item.nodeId || "").trim();
  const machineId = slugPart(item.machineId || item.targetMachineId || remoteNodeId || item.remoteUrl, "remote-node");
  if (!id || !operation || !machineId) return null;
  return {
    lifecycleId: id,
    commandId,
    clientCommandId,
    operation,
    remoteNodeId,
    machineId,
    remoteUrl: normalizeRemoteNodeUrl(item.remoteUrl || ""),
    sourceCardId: String(item.sourceCardId || "").trim(),
    title: compactText(item.title || "", 120),
    subtitle: compactText(item.subtitle || "", 140),
    targetTitle: compactText(item.targetTitle || "", 120),
    providerId: compactText(item.providerId || "", 80),
    appId: compactText(item.appId || "", 80),
    status: normalizeLaunchLifecycleStatus(item.status),
    detail: compactText(item.detail || "", 240),
    error: compactText(item.error || "", 300),
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()),
    completedAt: String(item.completedAt || ""),
    dismissedAt: String(item.dismissedAt || ""),
    result: item.result && typeof item.result === "object" ? item.result : {},
  };
}

function readLaunchLifecycles(storage, key) {
  try {
    const raw = JSON.parse(storage.getItem(key) || "[]");
    const values = Array.isArray(raw) ? raw : [];
    return values.map(normalizeLaunchLifecycle).filter(Boolean);
  } catch {
    return [];
  }
}

function writeLaunchLifecycles(storage, key, lifecycles) {
  try {
    const byId = new Map();
    (lifecycles || []).map(normalizeLaunchLifecycle).filter(Boolean).forEach((item) => {
      byId.set(item.lifecycleId, item);
    });
    const kept = [...byId.values()]
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
      .slice(0, 40);
    storage.setItem(key, JSON.stringify(kept));
  } catch {
    // Launch lifecycle cards are convenience UI state; relay commands remain authoritative.
  }
}

function upsertLaunchLifecycle(storage, key, lifecycle) {
  const normalized = normalizeLaunchLifecycle(lifecycle);
  if (!normalized) return null;
  const current = readLaunchLifecycles(storage, key);
  const next = [
    normalized,
    ...current.filter((item) => item.lifecycleId !== normalized.lifecycleId),
  ];
  writeLaunchLifecycles(storage, key, next);
  return normalized;
}

function isTerminalLaunchStatus(status) {
  return TERMINAL_COMMAND_STATUSES.has(normalizeLaunchLifecycleStatus(status));
}

function isDismissedLaunchLifecycle(lifecycle) {
  return Boolean(lifecycle?.dismissedAt) || normalizeLaunchLifecycleStatus(lifecycle?.status) === "dismissed";
}

function sessionIdFromLifecycle(lifecycle) {
  return String(
    lifecycle?.result?.session?.id ||
    lifecycle?.result?.sessionId ||
    lifecycle?.result?.session_id ||
    "",
  ).trim();
}

function lifecycleResultAppInfo(lifecycle) {
  const result = lifecycle?.result && typeof lifecycle.result === "object" ? lifecycle.result : {};
  const app = result.app && typeof result.app === "object" ? result.app : {};
  const launcher = result.launcher && typeof result.launcher === "object" ? result.launcher : {};
  const url = normalizeRemoteNodeUrl(result.url || result.href || app.url || app.href || result.appUrl || "");
  let port = Number(result.port || app.port || result.localPort || app.localPort || 0);
  if (!Number.isInteger(port) && url) {
    try {
      port = Number(new URL(url).port || 0);
    } catch {
      port = 0;
    }
  }
  const rawAppId = String(
    lifecycle.appId ||
    result.appId ||
    result.applicationId ||
    app.appId ||
    app.id ||
    launcher.appId ||
    launcher.id ||
    "",
  ).trim().replace(/^app:/u, "");
  return {
    appId: rawAppId,
    port: Number.isInteger(port) && port > 0 ? port : null,
    url,
    commandId: String(result.commandId || result.clientCommandId || lifecycle.commandId || lifecycle.clientCommandId || "").trim(),
  };
}

function sameLaunchMachine(card, lifecycle) {
  const cardMachineId = getCanvasCardMachineId(card);
  return cardMachineId === lifecycle.machineId ||
    Boolean(lifecycle.remoteNodeId && card.ref?.remoteNodeId === lifecycle.remoteNodeId) ||
    Boolean(lifecycle.remoteUrl && card.ref?.remoteUrl === lifecycle.remoteUrl);
}

function cardUrlForLaunchMatch(card) {
  return normalizeRemoteNodeUrl(card.href || card.ref?.embedUrl || card.detail || "");
}

function findMaterializedLaunchCard(cards, lifecycle) {
  if (!lifecycle) return null;
  if (lifecycle.operation === "session.create") {
    const sessionId = sessionIdFromLifecycle(lifecycle);
    if (!sessionId) return null;
    return cards.find((card) =>
      card.type === "agent" &&
      sameLaunchMachine(card, lifecycle) &&
      String(card.ref?.sessionId || "") === sessionId,
    ) || null;
  }
  if (lifecycle.operation === "app.launch") {
    const info = lifecycleResultAppInfo(lifecycle);
    if (!info.appId && !info.port && !info.url && !info.commandId) return null;
    return cards.find((card) => {
      if (!sameLaunchMachine(card, lifecycle)) return false;
      if (card.type !== "app" && card.type !== "browser" && card.type !== "monitor") return false;
      const cardAppId = String(card.ref?.appId || card.ref?.launcherId || "").trim().replace(/^app:/u, "");
      const cardPort = Number(card.ref?.port || 0);
      const cardCommandId = String(card.ref?.launchCommandId || card.ref?.commandId || "").trim();
      const cardUrl = cardUrlForLaunchMatch(card);
      if (info.commandId && cardCommandId && info.commandId === cardCommandId) return true;
      if (info.commandId && cardCommandId && info.commandId !== cardCommandId) return false;
      if (info.appId && cardAppId && info.appId === cardAppId) return true;
      if (info.port && Number.isInteger(cardPort) && cardPort === info.port) return true;
      if (info.url && cardUrl && cardUrl === info.url) return true;
      return false;
    }) || null;
  }
  return null;
}

function materializeLaunchLifecycleLinks(cards, lifecycles) {
  if (!lifecycles?.length) return cards;
  const updates = new Map();
  lifecycles.forEach((lifecycle) => {
    const sourceCardId = String(lifecycle.sourceCardId || "").trim();
    const target = findMaterializedLaunchCard(cards, lifecycle);
    if (!target) return;
    const previous = updates.get(target.id) || target;
    updates.set(target.id, {
      ...previous,
      tags: [...new Set(["launched", ...(previous.tags || []).filter(Boolean)])].slice(0, 5),
      ref: {
        ...(previous.ref || {}),
        ...(sourceCardId ? { sourceCardId: previous.ref?.sourceCardId || sourceCardId } : {}),
        launchLifecycleId: lifecycle.lifecycleId,
        launchCommandId: lifecycle.commandId || previous.ref?.launchCommandId || "",
        clientCommandId: lifecycle.clientCommandId || previous.ref?.clientCommandId || "",
      },
    });
  });
  if (!updates.size) return cards;
  return cards.map((card) => updates.get(card.id) || card);
}

function suppressDismissedLaunchCards(cards, lifecycles) {
  const dismissedLaunches = (lifecycles || [])
    .filter((lifecycle) => lifecycle.operation === "app.launch" && isDismissedLaunchLifecycle(lifecycle));
  if (!dismissedLaunches.length) return cards;
  return cards.filter((card) =>
    !dismissedLaunches.some((lifecycle) => findMaterializedLaunchCard([card], lifecycle)?.id === card.id),
  );
}

function launchLifecycleDetail(lifecycle) {
  if (lifecycle.error) return lifecycle.error;
  const target = lifecycle.targetTitle || lifecycle.machineId || "remote machine";
  const status = normalizeLaunchLifecycleStatus(lifecycle.status);
  const sessionId = sessionIdFromLifecycle(lifecycle);
  if (status === "completed" && lifecycle.operation === "session.create" && sessionId) {
    return `Started session ${sessionId} on ${target}.`;
  }
  if (status === "completed" && lifecycle.operation === "app.launch") {
    return `${lifecycle.title || "App"} launched on ${target}.`;
  }
  if (status === "running") {
    return `Claimed by ${target}; waiting for completion.`;
  }
  if (status === "failed") {
    return `Launch failed on ${target}.`;
  }
  return lifecycle.detail || `Waiting for ${target} to claim the command.`;
}

function launchLifecycleCard(lifecycle) {
  const isAgent = lifecycle.operation === "session.create";
  const isCompletedApp = lifecycle.operation === "app.launch" && normalizeLaunchLifecycleStatus(lifecycle.status) === "completed";
  const sessionId = sessionIdFromLifecycle(lifecycle);
  const title = lifecycle.title || (isAgent ? "Starting agent" : "Starting app");
  const href = isAgent && sessionId && lifecycle.remoteUrl
    ? absoluteRemoteHref(`/?view=shell&sessionId=${encodeURIComponent(sessionId)}`, lifecycle.remoteUrl)
    : "";
  return {
    id: `lifecycle:${lifecycle.lifecycleId}`,
    type: isAgent ? "agent" : "app",
    title,
    subtitle: lifecycle.subtitle || (isAgent ? "remote agent launch" : isCompletedApp ? "desktop app / launched" : "remote app launch"),
    status: normalizeLaunchLifecycleStatus(lifecycle.status).replace(/_/g, " "),
    detail: launchLifecycleDetail(lifecycle),
    meta: lifecycle.updatedAt || lifecycle.createdAt,
    tags: [lifecycle.remoteUrl ? "remote" : "", isCompletedApp ? "launched" : lifecycle.status, lifecycle.providerId || lifecycle.appId].filter(Boolean),
    href,
    ref: {
      machineId: lifecycle.machineId,
      remoteNodeId: lifecycle.remoteNodeId,
      remoteUrl: lifecycle.remoteUrl,
      sourceCardId: lifecycle.sourceCardId,
      lifecycle: !isCompletedApp,
      launchedApp: isCompletedApp,
      launchLifecycleId: lifecycle.lifecycleId,
      commandId: lifecycle.commandId,
      clientCommandId: lifecycle.clientCommandId,
      sessionId,
      appId: lifecycle.appId || lifecycleResultAppInfo(lifecycle).appId || "",
      actionLabel: href ? "Open agent" : "",
    },
    width: isAgent ? 420 : 360,
    height: isAgent ? 260 : 190,
  };
}

function mergeLaunchLifecycleCards(cards, lifecycles) {
  const normalizedLifecycles = (lifecycles || []).map(normalizeLaunchLifecycle).filter(Boolean);
  const visibleCards = suppressDismissedLaunchCards(cards, normalizedLifecycles);
  const activeLifecycles = normalizedLifecycles.filter((lifecycle) => !isDismissedLaunchLifecycle(lifecycle));
  const linkedCards = materializeLaunchLifecycleLinks(visibleCards, activeLifecycles);
  const lifecycleCards = activeLifecycles
    .filter((lifecycle) => !findMaterializedLaunchCard(linkedCards, lifecycle))
    .map(launchLifecycleCard);
  return [...linkedCards, ...lifecycleCards];
}

function launchLifecycleFromCommand(command, lifecycle) {
  return normalizeLaunchLifecycle({
    ...lifecycle,
    commandId: command?.id || lifecycle.commandId,
    nodeId: command?.nodeId || lifecycle.remoteNodeId,
    operation: command?.operation || lifecycle.operation,
    clientCommandId: command?.clientCommandId || lifecycle.clientCommandId,
    status: command?.status || lifecycle.status,
    createdAt: command?.createdAt || lifecycle.createdAt,
    updatedAt: command?.updatedAt || lifecycle.updatedAt,
    completedAt: command?.completedAt || lifecycle.completedAt,
    result: command?.result || lifecycle.result,
    error: command?.error || lifecycle.error,
  });
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
  const system = [region.subtitle, region.status].filter(Boolean).join(" / ");
  return [system, region.detail].filter(Boolean).join(" · ") || "machine region";
}

function regionConnectionBadges(region) {
  const connection = region.remoteNodeId ? "account" : region.remoteUrl ? "view only" : "local";
  const capabilityBadges = Array.isArray(region.tags)
    ? region.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 2)
    : [];
  return [connection, ...capabilityBadges];
}

function regionDropLabel(region, localMachineId = "") {
  if (region?.id === localMachineId) return "Move here";
  if (region?.remoteNodeId) return "Copy here";
  if (region?.remoteUrl) return "Pair first";
  return "Move here";
}

function renderRegionBadges(region) {
  const badges = regionConnectionBadges(region);
  return `
    <span class="swarmlab-canvas-region-badges">
      ${badges.map((badge) => `<span class="swarmlab-canvas-region-badge">${escapeHtml(badge)}</span>`).join("")}
    </span>
  `;
}

function renderRegionResizeButton(region, placement) {
  const isHeader = placement === "header";
  return `
    <button
      class="swarmlab-canvas-region-resize is-${escapeHtml(placement)}"
      type="button"
      title="Drag to resize machine region"
      aria-label="Resize ${escapeHtml(region.title || region.id)} region"
      data-swarmlab-canvas-region-resize="${escapeHtml(region.id)}"
    >
      ${renderIcon(Maximize2, { width: isHeader ? 12 : 14, height: isHeader ? 12 : 14 })}
    </button>
  `;
}

function renderCanvasRegion(region, localMachineId = "") {
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
          <span class="swarmlab-canvas-region-title-row">
            <strong class="swarmlab-canvas-region-name">${escapeHtml(region.title || region.id)}</strong>
            ${renderRegionBadges(region)}
            ${renderRegionResizeButton(region, "header")}
          </span>
          <span class="swarmlab-canvas-region-summary">${escapeHtml(regionSummary(region))}</span>
        </span>
      </div>
      <span class="swarmlab-canvas-region-drop-label">${escapeHtml(regionDropLabel(region, localMachineId))}</span>
      <span class="swarmlab-canvas-region-size" data-swarmlab-canvas-region-size="${escapeHtml(region.id)}">${Math.round(Number(region.width) || 0)} x ${Math.round(Number(region.height) || 0)}</span>
      ${renderRegionResizeButton(region, "corner")}
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
  const cardsById = new Map(cards.map((card) => [card.id, card]));
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
    const sourceCardId = String(card.ref?.sourceCardId || "").trim();
    const sourceItem = sourceCardId ? layout[sourceCardId] : null;
    if (sourceCardId && sourceItem && sourceCardId !== card.id) {
      const sourceCard = cardsById.get(sourceCardId);
      const sourceRegionId = sourceCard
        ? getCanvasCardRegionId(sourceCard, sourceItem)
        : getCanvasCardRegionId(card, sourceItem);
      pipes.push({
        kind: "resource",
        cardId: card.id,
        sourceCardId,
        sourceRegionId,
        targetRegionId: assignedRegionId,
        path: pipePath(cardCenter(sourceItem), cardPoint),
      });
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
      data-swarmlab-canvas-pipe-source-card-id="${escapeHtml(pipe.sourceCardId || "")}"
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

function regionDisplayName(region, fallback = "") {
  return String(region?.title || fallback || "")
    .replace(/\s+\([^)]*\)\s*$/u, "")
    .trim() || String(fallback || "");
}

function renderAgentTransferBarContent(card, layout, targetRegion, localMachineId, sourceRegion = null) {
  if (!targetRegion) return "";
  const homeRegionId = getCanvasCardMachineId(card);
  const targetRegionId = getCanvasCardRegionId(card, layout);
  if (homeRegionId === targetRegionId) return "";
  const targetName = regionDisplayName(targetRegion, targetRegionId);
  const sourceName = regionDisplayName(sourceRegion, homeRegionId);
  if (!isRegionCommandable(targetRegion, localMachineId)) {
    const pairAction = targetRegion.remoteUrl
      ? `
        <button class="swarmlab-canvas-button" type="button" data-swarmlab-canvas-pair-region="${escapeHtml(targetRegion.id)}">
          ${renderIcon(HardDrive)}
          <span>Pair</span>
        </button>
      `
      : "";
    return `
      <span>View relocated to ${escapeHtml(targetName)}. Agent keeps running on ${escapeHtml(sourceName)}. Pair this machine to start a copy there.</span>
      ${pairAction}
    `;
  }
  return `
    <span>View relocated to ${escapeHtml(targetName)}. Agent keeps running on ${escapeHtml(sourceName)}.</span>
    <button class="swarmlab-canvas-button" type="button" data-swarmlab-canvas-agent-capsule="${escapeHtml(card.id)}">
      ${renderIcon(Send)}
      <span>Start copy</span>
    </button>
  `;
}

function renderCardAction(card) {
  if (card.type === "launcher") {
    if (card.ref?.remoteUrl && !card.ref?.remoteNodeId) {
      return `
        <button class="swarmlab-canvas-open swarmlab-canvas-button" type="button" data-swarmlab-canvas-pair-region="${escapeHtml(card.ref?.machineId || "")}">
          ${renderIcon(HardDrive)}
          <span>Pair</span>
        </button>
      `;
    }
    return `
      <button class="swarmlab-canvas-open swarmlab-canvas-button" type="button" data-swarmlab-canvas-launcher="${escapeHtml(card.id)}">
        ${renderIcon(Send)}
        <span>${escapeHtml(card.ref?.actionLabel || "Launch")}</span>
      </button>
    `;
  }
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

function renderCardTools(card) {
  const launchLifecycleId = String(card.ref?.launchLifecycleId || "").trim();
  const dismissLaunch = card.ref?.launchedApp && launchLifecycleId
    ? `
      <button
        class="swarmlab-canvas-card-control"
        type="button"
        title="Dismiss from canvas"
        aria-label="Dismiss ${escapeHtml(card.title || "app")} from canvas"
        data-swarmlab-canvas-dismiss-launch="${escapeHtml(launchLifecycleId)}"
      >
        ${renderIcon(X, { width: 13, height: 13 })}
      </button>
    `
    : "";
  return `
    <span class="swarmlab-canvas-card-tools">
      ${dismissLaunch}
      <span class="swarmlab-canvas-drag-grip" aria-hidden="true">${renderIcon(Grip, { width: 16, height: 16 })}</span>
    </span>
  `;
}

function cardFrame(card, layout, body, footer = "") {
  const icon = CARD_TYPE_ICONS[card.type] || Box;
  const sessionId = card.ref?.sessionId ? ` data-swarmlab-canvas-session-id="${escapeHtml(card.ref.sessionId)}"` : "";
  const remoteNodeId = card.ref?.remoteNodeId ? ` data-swarmlab-canvas-remote-node-id="${escapeHtml(card.ref.remoteNodeId)}"` : "";
  const remoteClass = card.ref?.remoteUrl ? " is-remote" : "";
  const lifecycleClass = card.ref?.lifecycle ? " is-lifecycle" : "";
  const launchedAppClass = card.ref?.launchedApp ? " is-launched-app" : "";
  const machineId = getCanvasCardMachineId(card);
  const regionId = getCanvasCardRegionId(card, layout);
  const crossRegionClass = machineId !== regionId ? " is-cross-region" : "";
  return `
    <article
      class="swarmlab-canvas-card is-${escapeHtml(card.type)}${remoteClass}${crossRegionClass}${lifecycleClass}${launchedAppClass}"
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
        ${renderCardTools(card)}
      </div>
      ${body}
      ${footer}
    </article>
  `;
}

function renderLifecycleCard(card, layout) {
  const action = renderCardAction(card);
  const status = [card.subtitle, card.status].filter(Boolean).join(" / ") || "remote launch";
  const body = `
    <div class="swarmlab-canvas-card-body swarmlab-canvas-lifecycle-body">
      <div class="swarmlab-canvas-lifecycle-status">
        <strong>${escapeHtml(card.ref?.commandId || card.ref?.clientCommandId || "remote command")}</strong>
        <span>${escapeHtml(card.status || "queued")}</span>
      </div>
      <div class="swarmlab-canvas-lifecycle-detail">${escapeHtml(card.detail || status)}</div>
      ${renderTags(card, { limit: 4 })}
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || status)}</span>${action}</div>`;
  return cardFrame(card, layout, body, footer);
}

function renderAgentCard(card, layout) {
  if (card.ref?.lifecycle) {
    return renderLifecycleCard(card, layout);
  }
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
            <div class="swarmlab-agent-message-text">${escapeHtml(cwd || "default project")}</div>
          </div>
          <div class="swarmlab-agent-message is-agent">
            <span>${escapeHtml(status)}</span>
            <div class="swarmlab-agent-message-text">${escapeHtml(card.meta ? `Last activity ${card.meta}` : "Ready on this machine.")}</div>
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
            <div class="swarmlab-agent-message-text">${escapeHtml(card.meta || card.ref?.remoteUrl || "Ready")}</div>
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

function narrativeEntryText(entry, max = 1_800) {
  return compactText(
    [
      entry?.text,
      entry?.summary,
      entry?.outputPreview,
      entry?.statusText,
    ].filter(Boolean).join(" "),
    max,
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
    .slice(-18);
  if (!visible.length) {
    return `
      <div class="swarmlab-agent-message is-loading">
        <span>Native chat</span>
        <div class="swarmlab-agent-message-text">No messages yet.</div>
      </div>
    `;
  }
  const source = [narrative?.sourceLabel, narrative?.updatedAt ? `updated ${narrative.updatedAt}` : ""].filter(Boolean).join(" / ");
  const meta = `
    <div class="swarmlab-agent-history-meta">
      <span>${escapeHtml(source || "session history")}</span>
      <span>${escapeHtml(`${visible.length}${entries.length > visible.length ? ` of ${entries.length}` : ""} messages`)}</span>
    </div>
  `;
  return `${meta}${visible.map((entry) => `
    <div class="swarmlab-agent-message ${narrativeEntryClass(entry)}" data-swarmlab-agent-entry-id="${escapeHtml(entry?.id || "")}">
      <span>${escapeHtml(narrativeEntryLabel(entry))}</span>
      <div class="swarmlab-agent-message-text">${escapeHtml(narrativeEntryText(entry))}</div>
    </div>
  `).join("")}`;
}

function updateAgentFeed(card, html) {
  const feed = card.querySelector("[data-swarmlab-agent-chat-feed]");
  if (!(feed instanceof HTMLElement)) return;
  feed.innerHTML = html;
  feed.scrollTop = feed.scrollHeight;
}

function showCanvasNotice(root, message) {
  const notice = root.querySelector("[data-swarmlab-canvas-notice]");
  if (!(notice instanceof HTMLElement)) return;
  notice.textContent = message;
  notice.hidden = false;
  if (root.__swarmlabCanvasNoticeTimer) {
    clearTimeout(root.__swarmlabCanvasNoticeTimer);
  }
  root.__swarmlabCanvasNoticeTimer = setTimeout(() => {
    notice.hidden = true;
    root.__swarmlabCanvasNoticeTimer = null;
  }, 5_500);
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
        <div class="swarmlab-agent-message-text">${escapeHtml(error?.message || "Could not load session narrative.")}</div>
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

async function refreshLaunchLifecycles(root, { fetchImpl, abortController, storage, refresh }) {
  const key = root.dataset.swarmlabCanvasLaunchStorageKey || "";
  if (!key) return;
  const lifecycles = readLaunchLifecycles(storage, key);
  const active = lifecycles.filter((item) => item.remoteNodeId && item.commandId && !isTerminalLaunchStatus(item.status));
  if (!active.length) return;
  let changed = false;
  const next = await Promise.all(lifecycles.map(async (item) => {
    if (!active.some((candidate) => candidate.lifecycleId === item.lifecycleId)) {
      return item;
    }
    try {
      const payload = await fetchJson(`/api/account/nodes/${encodeURIComponent(item.remoteNodeId)}/commands/${encodeURIComponent(item.commandId)}`, {
        fetchImpl,
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) return item;
      const updated = launchLifecycleFromCommand(payload?.command || {}, item) || item;
      if (JSON.stringify(updated) !== JSON.stringify(item)) {
        changed = true;
      }
      return updated;
    } catch {
      return item;
    }
  }));
  if (abortController.signal.aborted || !changed) return;
  writeLaunchLifecycles(storage, key, next);
  if (typeof refresh === "function") {
    refresh();
  }
}

function renderBrowserCard(card, layout) {
  const action = renderCardAction(card);
  const isMonitor = card.type === "monitor";
  const previewLabel = isMonitor
    ? [card.title, card.subtitle].filter(Boolean).join(" / ")
    : "";
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
        ${previewLabel ? `<strong>${escapeHtml(previewLabel)}</strong>` : ""}
      </div>
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || (isMonitor ? "monitor tab" : "browser window"))}</span>${action}</div>`;
  return cardFrame(card, layout, body, footer);
}

function renderAppCard(card, layout) {
  const ports = Array.isArray(card.ref?.ports) ? card.ref.ports : [];
  const embedUrl = String(card.ref?.embedUrl || "").trim();
  const previewTrusted = card.ref?.previewTrusted !== false;
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
        ${renderTags(card, { limit: 5 })}
        <div class="swarmlab-canvas-app-frame-shell">
          ${previewTrusted
            ? `<iframe
                class="swarmlab-canvas-app-frame"
                title="${escapeHtml(`${card.title} preview`)}"
                src="${escapeHtml(embedUrl)}"
                loading="lazy"
                referrerpolicy="no-referrer"
                sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
              ></iframe>`
            : `<div class="swarmlab-canvas-app-preview-placeholder">${renderIcon(AppWindow, { width: 28, height: 28 })}</div>`}
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

function renderLauncherCard(card, layout) {
  const action = renderCardAction(card);
  const body = `
    <div class="swarmlab-canvas-card-body">
      ${card.detail ? `<div>${escapeHtml(card.detail)}</div>` : ""}
      ${renderTags(card, { limit: 4 })}
    </div>
  `;
  const footer = `<div class="swarmlab-canvas-card-footer"><span>${escapeHtml(card.meta || card.status || "available")}</span>${action}</div>`;
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
  if (card.ref?.lifecycle) return renderLifecycleCard(card, layout);
  if (card.type === "agent") return renderAgentCard(card, layout);
  if (card.type === "monitor") return renderBrowserCard(card, layout);
  if (card.type === "browser") return renderBrowserCard(card, layout);
  if (card.type === "app") return renderAppCard(card, layout);
  if (card.type === "launcher") return renderLauncherCard(card, layout);
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
  if (card.type === "launcher") {
    return "";
  }
  return absoluteRemoteHref(card.href, baseUrl);
}

function remoteCardActionLabel(card) {
  if (card.type === "machine") return "Open canvas";
  if (card.type === "agent") return "Open agent";
  if (card.type === "handoff" && card.ref?.launchedSessionId) return "Open agent";
  if (card.type === "handoff") return "Open canvas";
  if (card.type === "launcher") return "Launch";
  return card.ref?.actionLabel || "Open";
}

function withRemoteCardContext(card, record, remoteIndex) {
  const baseId = slugPart(record.snapshot.node.id || record.host, `remote-${remoteIndex + 1}`);
  const remoteNodeId = record.registryNode?.commandable
    ? (record.registryNode?.nodeId || record.snapshot.node.id || record.registryNode?.id || "")
    : "";
  const sourceId = card.id;
  const isMachine = card.type === "machine";
  const href = remoteCardHref(card, record.baseUrl);
  const linkedSourceCardId = card.ref?.sourceCardId
    ? `remote:${baseId}:${card.ref.sourceCardId}`
    : "";
  return {
    ...card,
    id: `remote:${baseId}:${sourceId}`,
    title: isMachine ? `${card.title} (${record.host})` : card.title,
    subtitle: [card.subtitle, isMachine ? "remote canvas" : "remote"].filter(Boolean).join(" / "),
    tags: ["remote", ...card.tags],
    href,
    ref: {
      ...(card.ref || {}),
      remoteSourceCardId: sourceId,
      ...(linkedSourceCardId ? { sourceCardId: linkedSourceCardId } : {}),
      remoteNodeId,
      remoteUrl: record.baseUrl,
      actionLabel: remoteCardActionLabel(card),
    },
  };
}

function remoteCardsForRecord(record, remoteIndex) {
  if (!record.snapshot) {
    return [makeRemoteOfflineCard(record)];
  }
  return buildCanvasCards(record.snapshot).map((card) => withRemoteCardContext(card, record, remoteIndex));
}

function remoteLauncherCardsForRecord(record, remoteIndex) {
  if (!record.snapshot) {
    return [];
  }
  return buildCanvasLauncherCards(record.snapshot).map((card) => withRemoteCardContext(card, record, remoteIndex));
}

function combineCanvasCards(localPayload, remoteRecords) {
  const snapshot = normalizeNodeSnapshot(localPayload);
  const cards = buildCanvasCards(snapshot);
  const launcherCards = [
    ...buildCanvasLauncherCards(snapshot),
    ...remoteRecords.flatMap((record, index) => remoteLauncherCardsForRecord(record, index)),
  ];
  const remoteCards = remoteRecords.flatMap((record, index) => remoteCardsForRecord(record, index));
  return {
    snapshot,
    cards: [...cards, ...remoteCards],
    launcherCards,
    remoteRecords,
  };
}

function launcherKindLabel(card) {
  const isAgentProvider = String(card.ref?.launcherKind || "") === "agent-provider" || Boolean(card.ref?.providerId);
  if (isAgentProvider) return "agent";
  return card.ref?.category || "app";
}

function launcherDockStorageKey(boardId) {
  return `swarmlab.canvas.launchDock.v1:${boardId}`;
}

function launcherMachineId(card) {
  return getCanvasCardMachineId(card);
}

function groupLauncherCards(launcherCards, regions = []) {
  const groups = new Map();
  launcherCards.forEach((card) => {
    const machineId = launcherMachineId(card);
    if (!groups.has(machineId)) {
      groups.set(machineId, []);
    }
    groups.get(machineId).push(card);
  });
  regions.forEach((region) => {
    if (region?.id && !groups.has(region.id)) {
      groups.set(region.id, []);
    }
  });
  return groups;
}

function sortedLauncherMachineIds(groups, regions = [], localMachineId = "") {
  const regionOrder = new Map(regions.map((region, index) => [region.id, index]));
  return [...groups.keys()].sort((leftId, rightId) => {
    if (leftId === localMachineId) return -1;
    if (rightId === localMachineId) return 1;
    return (regionOrder.get(leftId) ?? 10_000) - (regionOrder.get(rightId) ?? 10_000) || leftId.localeCompare(rightId);
  });
}

function readLauncherDockMachineId(storage, key, groups, regions = [], localMachineId = "") {
  const machineIds = sortedLauncherMachineIds(groups, regions, localMachineId);
  if (!machineIds.length) return "";
  try {
    const stored = String(storage.getItem(key) || "").trim();
    if (stored && groups.has(stored)) return stored;
  } catch {
    // Dock selection is ephemeral UI state.
  }
  if (localMachineId && groups.has(localMachineId)) return localMachineId;
  return machineIds[0];
}

function launcherDockLabel(card) {
  const title = String(card.title || "Launcher").trim();
  const normalized = title.toLowerCase();
  if (normalized.includes("ollama")) return "Ollama";
  if (normalized === "claude code" || normalized.startsWith("claude code ")) return "Claude";
  if (normalized === "visual studio code") return "VS Code";
  return compactText(title, 12);
}

function renderLauncherDockItem(card) {
  const isAgentProvider = String(card.ref?.launcherKind || "") === "agent-provider" || Boolean(card.ref?.providerId);
  const icon = isAgentProvider ? Bot : AppWindow;
  const label = launcherDockLabel(card);
  const meta = compactText([launcherKindLabel(card), card.status || ""].filter(Boolean).join(" / "), 34);
  return `
    <button
      class="swarmlab-canvas-launch-item"
      type="button"
      data-swarmlab-canvas-launcher="${escapeHtml(card.id)}"
      title="${escapeHtml(`Launch ${card.title || "app"}`)}"
    >
      ${renderIcon(icon, { width: 17, height: 17 })}
      <span>
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(meta)}</span>
      </span>
    </button>
  `;
}

function renderLauncherDockItems(cards) {
  const visible = cards.slice(0, MAX_VISIBLE_DOCK_LAUNCHERS);
  return visible.map(renderLauncherDockItem).join("");
}

function renderLauncherDockMore(cards) {
  const overflow = cards.slice(MAX_VISIBLE_DOCK_LAUNCHERS);
  if (!overflow.length) return "";
  return `
    <details class="swarmlab-canvas-launch-more">
      <summary class="swarmlab-canvas-launch-more-button">
        ${renderIcon(Plus, { width: 15, height: 15 })}
        <span>${escapeHtml(`${overflow.length} more`)}</span>
      </summary>
      <div class="swarmlab-canvas-launch-more-panel">
        ${overflow.map(renderLauncherDockItem).join("")}
      </div>
    </details>
  `;
}

function renderLauncherDock(launcherCards, regions = [], localMachineId = "", selectedMachineId = "") {
  if (!launcherCards.length) return "";
  const regionsById = new Map(regions.map((region) => [region.id, region]));
  const groups = groupLauncherCards(launcherCards, regions);
  const machineIds = sortedLauncherMachineIds(groups, regions, localMachineId);
  const activeMachineId = groups.has(selectedMachineId) ? selectedMachineId : machineIds[0];
  const activeCards = groups.get(activeMachineId) || [];
  const activeRegion = regionsById.get(activeMachineId);
  const activeTitle = regionDisplayName(activeRegion, activeMachineId) || activeMachineId;
  const singleMachine = machineIds.length <= 1;
  return `
    <nav class="swarmlab-canvas-launch-dock${singleMachine ? " is-single-machine" : ""}" data-swarmlab-canvas-launch-dock aria-label="Launch apps">
      ${singleMachine
        ? `<div class="swarmlab-canvas-launch-title">${renderIcon(AppWindow, { width: 16, height: 16 })}<span>Apps</span></div>`
        : `
          <div class="swarmlab-canvas-launch-machines" role="tablist" aria-label="Launch target machine">
            <div class="swarmlab-canvas-launch-title">${renderIcon(AppWindow, { width: 16, height: 16 })}<span>Apps</span></div>
            ${machineIds.map((machineId) => {
              const region = regionsById.get(machineId);
              const accent = region ? regionAccent(region) : REGION_COLORS[0];
              const title = regionDisplayName(region, machineId) || machineId;
              const count = groups.get(machineId)?.length || 0;
              const active = machineId === activeMachineId;
              return `
                <button
                  class="swarmlab-canvas-launch-machine${active ? " is-active" : ""}"
                  type="button"
                  role="tab"
                  aria-selected="${active ? "true" : "false"}"
                  data-swarmlab-canvas-launch-machine="${escapeHtml(machineId)}"
                  style="--machine-accent: ${escapeHtml(accent)};"
                  title="${escapeHtml(`${title} · ${count} app${count === 1 ? "" : "s"}`)}"
                  aria-label="${escapeHtml(`Launch apps on ${title}`)}"
                >
                  <span class="swarmlab-canvas-launch-chip" aria-hidden="true"></span>
                  <span class="swarmlab-canvas-launch-machine-text">
                    <strong>${escapeHtml(title)}</strong>
                    <span>${escapeHtml(`${count} app${count === 1 ? "" : "s"}`)}</span>
                  </span>
                </button>
              `;
            }).join("")}
          </div>
        `}
      <section class="swarmlab-canvas-launch-panel" aria-label="${escapeHtml(`Launch apps on ${activeTitle}`)}">
        <div class="swarmlab-canvas-launch-items">
          ${renderLauncherDockItems(activeCards)}
        </div>
        ${renderLauncherDockMore(activeCards)}
      </section>
    </nav>
  `;
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

function renderCanvasNotice() {
  return `<div class="swarmlab-canvas-notice" data-swarmlab-canvas-notice hidden></div>`;
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

function isInitialViewportFocusCard(card) {
  return String(card?.type || "") === "agent";
}

function getCardsBounds(root, { machineId = "", initialFocus = false } = {}) {
  const layout = root.__swarmlabCanvasLayout || {};
  const cardsById = root.__swarmlabCanvasCardsById || {};
  const renderCardIds = root.__swarmlabCanvasRenderCardIds instanceof Set
    ? root.__swarmlabCanvasRenderCardIds
    : null;
  let entries = Object.entries(layout)
    .filter(([id]) => !renderCardIds || renderCardIds.has(id));
  if (machineId) {
    const filtered = entries.filter(([id, item]) => {
      const card = cardsById[id];
      return card && getCanvasCardMachineId(card) === machineId && !item.hidden;
    });
    if (filtered.length) {
      entries = filtered;
    }
  }
  if (initialFocus) {
    const focused = entries.filter(([id]) => isInitialViewportFocusCard(cardsById[id]));
    if (focused.length) {
      entries = focused;
    }
  }
  if (!entries.length) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [, item] of entries) {
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

function getViewportSafeInsets(root) {
  const rect = root.getBoundingClientRect();
  const insets = { top: 24, right: 24, bottom: 24, left: 24 };
  if (rect.width <= 0 || rect.height <= 0) return insets;
  root.querySelectorAll("[data-swarmlab-canvas-launch-dock], [data-swarmlab-canvas-controls]").forEach((element) => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    if (box.top >= rect.top && box.top <= rect.bottom) {
      insets.bottom = Math.max(insets.bottom, Math.round(rect.bottom - box.top + 18));
    }
    if (box.left >= rect.left && box.left <= rect.right && box.width > rect.width * 0.4) {
      insets.left = Math.max(insets.left, 28);
      insets.right = Math.max(insets.right, 28);
    }
  });
  return insets;
}

function fitViewportToBounds(root, bounds) {
  const rect = root.getBoundingClientRect();
  if (!bounds || rect.width <= 0 || rect.height <= 0) {
    return { ...DEFAULT_VIEWPORT };
  }
  const insets = getViewportSafeInsets(root);
  const usableWidth = Math.max(260, rect.width - insets.left - insets.right);
  const usableHeight = Math.max(260, rect.height - insets.top - insets.bottom);
  const zoom = clamp(Math.min(usableWidth / Math.max(1, bounds.width), usableHeight / Math.max(1, bounds.height)), 0.42, 1.12);
  return sanitizeViewport({
    x: insets.left + (usableWidth - bounds.width * zoom) / 2 - bounds.minX * zoom,
    y: insets.top + (usableHeight - bounds.height * zoom) / 2 - bounds.minY * zoom,
    zoom,
  });
}

function fitViewportToCards(root, options = {}) {
  return fitViewportToBounds(root, getCardsBounds(root, options));
}

function fitViewportToMachine(root, machineId) {
  const cardBounds = getCardsBounds(root, { machineId, initialFocus: true });
  if (cardBounds) {
    return fitViewportToBounds(root, cardBounds);
  }
  const region = root.__swarmlabCanvasRegionsById?.[machineId] || null;
  if (!region) {
    return fitViewportToCards(root);
  }
  return fitViewportToBounds(root, {
    minX: Number(region.x) || 0,
    minY: Number(region.y) || 0,
    maxX: (Number(region.x) || 0) + (Number(region.width) || 0),
    maxY: (Number(region.y) || 0) + Math.min(720, Number(region.height) || 0),
    width: Number(region.width) || 0,
    height: Math.min(720, Number(region.height) || 0),
  });
}

function getVisibleBoardBounds(root, viewport) {
  const rect = root.getBoundingClientRect();
  const safeViewport = sanitizeViewport(viewport);
  if (rect.width <= 0 || rect.height <= 0 || safeViewport.zoom <= 0) {
    return null;
  }
  const insets = getViewportSafeInsets(root);
  const left = insets.left;
  const top = insets.top;
  const right = Math.max(left, rect.width - insets.right);
  const bottom = Math.max(top, rect.height - insets.bottom);
  return {
    minX: (left - safeViewport.x) / safeViewport.zoom,
    minY: (top - safeViewport.y) / safeViewport.zoom,
    maxX: (right - safeViewport.x) / safeViewport.zoom,
    maxY: (bottom - safeViewport.y) / safeViewport.zoom,
    minVisibleBoardSize: 80 / safeViewport.zoom,
  };
}

function viewportIntersectsBounds(viewportBounds, contentBounds) {
  const visibleWidth = Math.min(viewportBounds.maxX, contentBounds.maxX) - Math.max(viewportBounds.minX, contentBounds.minX);
  const visibleHeight = Math.min(viewportBounds.maxY, contentBounds.maxY) - Math.max(viewportBounds.minY, contentBounds.minY);
  return visibleWidth >= viewportBounds.minVisibleBoardSize && visibleHeight >= viewportBounds.minVisibleBoardSize;
}

function getCanvasContentBounds(root) {
  const bounds = [];
  const layout = root.__swarmlabCanvasLayout || {};
  const renderCardIds = root.__swarmlabCanvasRenderCardIds instanceof Set
    ? root.__swarmlabCanvasRenderCardIds
    : null;
  Object.entries(layout).forEach(([id, item]) => {
    if (!item || item.hidden || (renderCardIds && !renderCardIds.has(id))) return;
    const x = Number(item.x);
    const y = Number(item.y);
    const width = Number(item.width) || 260;
    const height = Number(item.height) || 180;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    bounds.push({ minX: x, minY: y, maxX: x + width, maxY: y + height });
  });
  const regions = Array.isArray(root.__swarmlabCanvasRegions) ? root.__swarmlabCanvasRegions : [];
  regions.forEach((region) => {
    const x = Number(region?.x);
    const y = Number(region?.y);
    const width = Number(region?.width);
    const height = Number(region?.height);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return;
    bounds.push({ minX: x, minY: y, maxX: x + width, maxY: y + height });
  });
  return bounds;
}

function viewportShowsCanvasContent(root, viewport) {
  const viewportBounds = getVisibleBoardBounds(root, viewport);
  if (!viewportBounds) return true;
  const contentBounds = getCanvasContentBounds(root);
  if (!contentBounds.length) return true;
  return contentBounds.some((bounds) => viewportIntersectsBounds(viewportBounds, bounds));
}

function renderSnapshot(root, payload, { storage, remoteRecords = [] } = {}) {
  const { snapshot, cards: baseCards, launcherCards } = combineCanvasCards(payload, remoteRecords);
  const boardId = remoteRecords.length
    ? `fleet:${slugPart(snapshot.node.id, "local")}`
    : getCanvasBoardId(snapshot);
  const storageKey = getCanvasLayoutStorageKey(boardId);
  const viewportKey = getCanvasViewportStorageKey(boardId);
  const launchStorageKey = getLaunchLifecycleStorageKey(boardId);
  const dockStorageKey = launcherDockStorageKey(boardId);
  const launchLifecycles = readLaunchLifecycles(storage, launchStorageKey);
  const cards = mergeLaunchLifecycleCards(baseCards, launchLifecycles);
  const renderCards = getRenderableCanvasCards(cards);
  const renderCardIds = getRenderableCanvasCardIds(cards);
  const savedLayout = readLayout(storage, storageKey);
  const viewportState = readViewportState(storage, viewportKey);
  const viewport = viewportState.viewport;
  const layout = mergeCanvasLayout(cards, savedLayout);
  const regions = buildCanvasRegions(cards, layout);
  const regionsById = Object.fromEntries(regions.map((region) => [region.id, region]));
  const cardsById = Object.fromEntries([...cards, ...launcherCards].map((card) => [card.id, card]));
  const localMachineId = snapshot.node.id;
  const launcherGroups = groupLauncherCards(launcherCards, regions);
  const selectedLauncherMachineId = readLauncherDockMachineId(storage, dockStorageKey, launcherGroups, regions, localMachineId);
  const meta = root.closest(".swarmlab-canvas-view")?.querySelector("[data-swarmlab-canvas-meta]");
  if (meta) {
    const onlineRemotes = remoteRecords.filter((record) => record.snapshot).length;
    const offlineRemotes = remoteRecords.length - onlineRemotes;
    const remoteText = remoteRecords.length
      ? ` / ${onlineRemotes} remote online${offlineRemotes ? `, ${offlineRemotes} unreachable` : ""}`
      : "";
    meta.textContent = `${snapshot.node.name}${remoteText} / ${renderCards.length} windows / ${snapshot.generatedAt}`;
  }

  root.dataset.swarmlabCanvasBoardId = boardId;
  root.dataset.swarmlabCanvasStorageKey = storageKey;
  root.dataset.swarmlabCanvasViewportStorageKey = viewportKey;
  root.dataset.swarmlabCanvasLaunchStorageKey = launchStorageKey;
  root.dataset.swarmlabCanvasLaunchDockStorageKey = dockStorageKey;
  root.__swarmlabCanvasLayout = layout;
  root.__swarmlabCanvasViewport = viewport;
  root.__swarmlabCanvasCards = renderCards;
  root.__swarmlabCanvasAllCards = cards;
  root.__swarmlabCanvasRenderCardIds = renderCardIds;
  root.__swarmlabCanvasLaunchers = launcherCards;
  root.__swarmlabCanvasCardsById = cardsById;
  root.__swarmlabCanvasRegions = regions;
  root.__swarmlabCanvasRegionsById = regionsById;
  root.__swarmlabCanvasLocalMachineId = localMachineId;

  if (!renderCards.length && !regions.length) {
    root.innerHTML = renderCanvasShell({ status: "empty" });
    return;
  }

  root.innerHTML = `
    <div
      class="swarmlab-canvas-plane"
      data-swarmlab-canvas-plane
      style="--canvas-pan-x: ${viewport.x}px; --canvas-pan-y: ${viewport.y}px; --canvas-zoom: ${viewport.zoom};"
    >
      ${regions.map((region) => renderCanvasRegion(region, localMachineId)).join("")}
      ${renderCanvasPipeLayer(renderCards, layout, regions, localMachineId)}
      ${renderCards.map((card) => renderCanvasCard(card, layout[card.id])).join("")}
    </div>
    ${renderLauncherDock(launcherCards, regions, localMachineId, selectedLauncherMachineId)}
    ${renderFloatingControls(viewport)}
    ${renderCanvasNotice()}
  `;
  if (!viewportState.hasSavedViewport || !viewportShowsCanvasContent(root, viewport)) {
    setViewport(root, storage, fitViewportToCards(root, { machineId: localMachineId, initialFocus: true }));
  }
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
    const targetRegion = root.__swarmlabCanvasRegionsById?.[regionId] || null;
    const sourceRegion = root.__swarmlabCanvasRegionsById?.[machineId] || null;
    transferBar.innerHTML = renderAgentTransferBarContent(
      model,
      layout,
      targetRegion,
      root.__swarmlabCanvasLocalMachineId || "",
      sourceRegion,
    );
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
  const model = root.__swarmlabCanvasCardsById?.[cardId];
  const previousRegionId = getCanvasCardRegionId(model, layout);
  const center = cardCenter(layout);
  const region = findRegionAtPoint(root, center.x, center.y);
  if (region) {
    layout.regionId = region.id;
  }
  refreshCardRegionState(root, cardElement);
  refreshCanvasPipes(root);
  const nextRegionId = getCanvasCardRegionId(model, layout);
  if (model?.type === "agent" && previousRegionId !== nextRegionId) {
    const sourceRegionId = getCanvasCardMachineId(model);
    const sourceRegion = root.__swarmlabCanvasRegionsById?.[sourceRegionId] || null;
    const targetRegion = root.__swarmlabCanvasRegionsById?.[nextRegionId] || null;
    const targetName = regionDisplayName(targetRegion, nextRegionId);
    const sourceName = regionDisplayName(sourceRegion, sourceRegionId);
    updateAgentFeed(cardElement, `
      <div class="swarmlab-agent-message is-loading">
        <span>Relocated view</span>
        <div class="swarmlab-agent-message-text">This card is displayed in ${escapeHtml(targetName)}. The agent keeps running on ${escapeHtml(sourceName)}; no session was stopped or restarted.</div>
      </div>
    `);
    showCanvasNotice(root, `${model.title || "Agent"} view moved to ${targetName}. Source keeps running on ${sourceName}.`);
  }
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
      root.classList.add("is-card-dragging");
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
      root.classList.remove("is-card-dragging");
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

function regionContentMinimum(root, regionId, region) {
  const regionX = Number(region?.x) || 0;
  const regionY = Number(region?.y) || 0;
  let minWidth = REGION_RESIZE_MIN_WIDTH;
  let minHeight = REGION_RESIZE_MIN_HEIGHT;
  canvasCardRegionEntries(root, regionId).forEach(({ card, item }) => {
    const itemX = Number(item.x);
    const itemY = Number(item.y);
    const itemWidth = Number(item.width) || Number(card.width) || 0;
    const itemHeight = Number(item.height) || Number(card.height) || 0;
    if (!Number.isFinite(itemX) || !Number.isFinite(itemY)) return;
    minWidth = Math.max(minWidth, Math.ceil(itemX + itemWidth + 34 - regionX));
    minHeight = Math.max(minHeight, Math.ceil(itemY + itemHeight + 46 - regionY));
  });
  return {
    width: clamp(minWidth, REGION_RESIZE_MIN_WIDTH, REGION_RESIZE_MAX_WIDTH),
    height: clamp(minHeight, REGION_RESIZE_MIN_HEIGHT, REGION_RESIZE_MAX_HEIGHT),
  };
}

function canvasCardsForRoot(root, { includeMetadata = false } = {}) {
  const cards = includeMetadata && Array.isArray(root.__swarmlabCanvasAllCards)
    ? root.__swarmlabCanvasAllCards
    : Array.isArray(root.__swarmlabCanvasCards)
      ? root.__swarmlabCanvasCards
      : [];
  return cards;
}

function canvasCardRegionEntries(root, regionId, { includeMetadata = false, includeHomeRegion = false } = {}) {
  const layout = root.__swarmlabCanvasLayout || {};
  return canvasCardsForRoot(root, { includeMetadata })
    .map((card) => ({ card, item: layout[card.id] }))
    .filter(({ card, item }) => {
      if (!item) return false;
      const displayedRegionId = getCanvasCardRegionId(card, item);
      return displayedRegionId === regionId || (includeHomeRegion && getCanvasCardMachineId(card) === regionId);
    });
}

function persistRegionBoundsInLayout(root, regionId, bounds) {
  canvasCardRegionEntries(root, regionId, { includeMetadata: true, includeHomeRegion: true }).forEach(({ card, item }) => {
    const displayedRegionId = getCanvasCardRegionId(card, item);
    item.regionId = displayedRegionId || item.regionId || getCanvasCardMachineId(card);
    item.regionX = bounds.x;
    item.regionY = bounds.y;
    item.regionWidth = bounds.width;
    item.regionHeight = bounds.height;
  });
}

function updateRegionSizeLabel(regionElement, width, height) {
  const label = regionElement?.querySelector?.("[data-swarmlab-canvas-region-size]");
  if (!(label instanceof HTMLElement)) return;
  label.textContent = `${Math.round(width)} x ${Math.round(height)}`;
}

function bindRegionResize(root, { storage }) {
  const active = {
    button: null,
    regionElement: null,
    regionId: "",
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startWidth: 0,
    startHeight: 0,
    minWidth: REGION_RESIZE_MIN_WIDTH,
    minHeight: REGION_RESIZE_MIN_HEIGHT,
  };

  root.querySelectorAll("[data-swarmlab-canvas-region-resize]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      if (!(button instanceof HTMLElement)) return;
      const regionId = button.getAttribute("data-swarmlab-canvas-region-resize") || "";
      const region = root.__swarmlabCanvasRegionsById?.[regionId];
      const regionElement = button.closest("[data-swarmlab-canvas-region-id]");
      if (!regionId || !region || !(regionElement instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      const minimum = regionContentMinimum(root, regionId, region);
      active.button = button;
      active.regionElement = regionElement;
      active.regionId = regionId;
      active.pointerId = event.pointerId;
      active.startClientX = event.clientX;
      active.startClientY = event.clientY;
      active.startWidth = Number(region.width) || REGION_RESIZE_MIN_WIDTH;
      active.startHeight = Number(region.height) || REGION_RESIZE_MIN_HEIGHT;
      active.minWidth = minimum.width;
      active.minHeight = minimum.height;
      updateRegionSizeLabel(regionElement, active.startWidth, active.startHeight);
      root.classList.add("is-region-resizing");
      regionElement.classList.add("is-resizing");
      button.setPointerCapture?.(event.pointerId);
    });

    button.addEventListener("pointermove", (event) => {
      if (active.button !== button || !active.regionId) return;
      const region = root.__swarmlabCanvasRegionsById?.[active.regionId];
      if (!region || !(active.regionElement instanceof HTMLElement)) return;
      const viewport = sanitizeViewport(root.__swarmlabCanvasViewport || DEFAULT_VIEWPORT);
      const dx = (event.clientX - active.startClientX) / viewport.zoom;
      const dy = (event.clientY - active.startClientY) / viewport.zoom;
      const width = Math.round(clamp(active.startWidth + dx, active.minWidth, REGION_RESIZE_MAX_WIDTH));
      const height = Math.round(clamp(active.startHeight + dy, active.minHeight, REGION_RESIZE_MAX_HEIGHT));
      region.width = width;
      region.height = height;
      active.regionElement.style.setProperty("--region-width", `${width}px`);
      active.regionElement.style.setProperty("--region-height", `${height}px`);
      updateRegionSizeLabel(active.regionElement, width, height);
      persistRegionBoundsInLayout(root, active.regionId, {
        x: Number(region.x) || 0,
        y: Number(region.y) || 0,
        width,
        height,
      });
      refreshCanvasPipes(root);
    });

    const finish = (event) => {
      if (active.button !== button) return;
      active.regionElement?.classList?.remove("is-resizing");
      root.classList.remove("is-region-resizing");
      if (active.pointerId != null) {
        button.releasePointerCapture?.(active.pointerId);
      } else if (event?.pointerId != null) {
        button.releasePointerCapture?.(event.pointerId);
      }
      const storageKey = root.dataset.swarmlabCanvasStorageKey || "";
      if (storageKey) {
        writeLayout(storage, storageKey, root.__swarmlabCanvasLayout || {});
      }
      active.button = null;
      active.regionElement = null;
      active.regionId = "";
      active.pointerId = null;
    };

    button.addEventListener("pointerup", finish);
    button.addEventListener("pointercancel", finish);
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
    if (event.target.closest("[data-swarmlab-canvas-card-id], [data-swarmlab-canvas-controls], [data-swarmlab-canvas-launch-dock], a, button, input, textarea, select")) {
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
    "You are a Swarmlab agent capsule started from a relocated fleet-canvas card.",
    "The source agent is still running; this is a copy, not a transfer.",
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
    "Continue the work from the source agent as faithfully as possible without assuming the source session stopped. First reconstruct the likely state from this capsule, then inspect local files or services on this machine before making changes. If an artifact or model must move from another machine, ask for or use the available handoff path instead of pretending the bytes are already present.",
  ].join("\n");
}

function buildAgentCapsulePayload(card, { sourceRegion, targetRegion, targetIsLocal }) {
  const sourceMachineId = getCanvasCardMachineId(card);
  const providerId = inferAgentProviderId(card);
  const canReuseWorkspace = targetRegion?.id === sourceMachineId || targetIsLocal;
  return {
    ...(providerId ? { providerId } : {}),
    name: `Copy: ${card.title || "Agent"}`,
    cwd: canReuseWorkspace ? String(card.ref?.cwd || card.detail || "").trim() : "",
    initialPrompt: buildAgentCapsulePrompt(card, { sourceRegion, targetRegion, targetIsLocal }),
    initialPromptDelayMs: 800,
  };
}

async function launchAgentCapsule(button, root, { fetchImpl, abortController, onOpenSession, refresh, storage }) {
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
      button.textContent = "Copied";
      if (sessionId && typeof onOpenSession === "function") {
        onOpenSession(sessionId);
      } else if (typeof refresh === "function") {
        refresh();
      }
      return;
    }
    const clientCommandId = `capsule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const commandPayload = await fetchJson(`/api/account/nodes/${encodeURIComponent(targetRegion.remoteNodeId)}/commands`, {
      fetchImpl,
      signal: abortController.signal,
      method: "POST",
      body: {
        operation: "session.create",
        clientCommandId,
        payload,
      },
    });
    button.textContent = "Queued copy";
    const cardElement = root.querySelector(`[data-swarmlab-canvas-card-id="${CSS.escape(cardId)}"]`);
    if (cardElement) {
      updateAgentFeed(cardElement, `
        <div class="swarmlab-agent-message is-loading">
          <span>Copy queued</span>
          Starting a copy of ${escapeHtml(card.title || "agent")} on ${escapeHtml(targetRegion.title || targetRegion.id)}. The source agent keeps running.
        </div>
      `);
    }
    queueLaunchLifecycle(root, { storage, refresh }, launchLifecycleFromCommand(commandPayload?.command || {}, {
      lifecycleId: clientCommandId,
      clientCommandId,
      operation: "session.create",
      remoteNodeId: targetRegion.remoteNodeId,
      machineId: targetRegionId,
      remoteUrl: targetRegion.remoteUrl,
      sourceCardId: card.id,
      title: `Copy: ${card.title || "Agent"}`,
      subtitle: "remote agent copy",
      targetTitle: lifecycleTargetTitle(root, targetRegionId),
      providerId: payload.providerId || inferAgentProviderId(card),
      status: "queued",
      detail: "The source agent keeps running while this copy starts.",
    }));
  } catch (error) {
    button.removeAttribute("disabled");
    button.textContent = error?.message || "Copy failed";
  }
}

function launcherAppId(card) {
  const explicit = String(card?.ref?.appId || "").trim();
  if (explicit) return explicit;
  return String(card?.ref?.launcherId || "").replace(/^app:/u, "").trim();
}

function launcherSessionPayload(card) {
  const providerId = String(card?.ref?.providerId || "").trim();
  return {
    ...(providerId ? { providerId } : {}),
    name: String(card?.ref?.defaultName || card?.title || "Agent").trim() || "Agent",
  };
}

function lifecycleTargetTitle(root, machineId) {
  const region = root.__swarmlabCanvasRegionsById?.[machineId] || null;
  return regionDisplayName(region, machineId) || machineId;
}

function queueLaunchLifecycle(root, { storage, refresh }, lifecycle) {
  const key = root.dataset.swarmlabCanvasLaunchStorageKey || "";
  if (!key) return null;
  const stored = upsertLaunchLifecycle(storage, key, lifecycle);
  if (stored && typeof refresh === "function") {
    refresh();
  }
  return stored;
}

function dismissLaunchLifecycle(button, root, { storage, refresh } = {}) {
  const lifecycleId = String(button?.getAttribute("data-swarmlab-canvas-dismiss-launch") || "").trim();
  const key = root?.dataset?.swarmlabCanvasLaunchStorageKey || "";
  if (!lifecycleId || !key) return;
  const current = readLaunchLifecycles(storage, key);
  const now = new Date().toISOString();
  const next = current.map((item) => item.lifecycleId === lifecycleId
    ? {
        ...item,
        status: "dismissed",
        dismissedAt: now,
        updatedAt: now,
      }
    : item);
  writeLaunchLifecycles(storage, key, next);
  const layoutKey = root.dataset.swarmlabCanvasStorageKey || "";
  if (layoutKey) {
    const layout = readLayout(storage, layoutKey);
    const cardId = button.closest("[data-swarmlab-canvas-card-id]")?.getAttribute("data-swarmlab-canvas-card-id") || "";
    delete layout[`lifecycle:${lifecycleId}`];
    if (cardId) delete layout[cardId];
    writeLayout(storage, layoutKey, layout);
  }
  if (typeof refresh === "function") {
    refresh();
  }
}

async function launchCanvasLauncher(button, root, { fetchImpl, abortController, onOpenSession, refresh, storage }) {
  const cardId = button.getAttribute("data-swarmlab-canvas-launcher") || "";
  const card = root.__swarmlabCanvasCardsById?.[cardId];
  if (!card) return;
  const remoteNodeId = String(card.ref?.remoteNodeId || "").trim();
  const isRemote = Boolean(card.ref?.remoteUrl);
  const launcherKind = String(card.ref?.launcherKind || "").trim();
  const isAgentProvider = launcherKind === "agent-provider" || Boolean(card.ref?.providerId);
  if (isRemote && !remoteNodeId) {
    button.textContent = "Pair first";
    return;
  }
  button.setAttribute("disabled", "true");
  const previousText = button.textContent;
  button.textContent = isRemote ? "Queueing..." : "Launching...";
  try {
    if (isAgentProvider) {
      const payload = launcherSessionPayload(card);
      if (isRemote) {
        const clientCommandId = `launcher-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const commandPayload = await fetchJson(`/api/account/nodes/${encodeURIComponent(remoteNodeId)}/commands`, {
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
        queueLaunchLifecycle(root, { storage, refresh }, launchLifecycleFromCommand(commandPayload?.command || {}, {
          lifecycleId: clientCommandId,
          clientCommandId,
          operation: "session.create",
          remoteNodeId,
          machineId: getCanvasCardMachineId(card),
          remoteUrl: card.ref?.remoteUrl || "",
          sourceCardId: card.id,
          title: `Starting ${payload.name || card.title || "agent"}`,
          subtitle: "remote agent launch",
          targetTitle: lifecycleTargetTitle(root, getCanvasCardMachineId(card)),
          providerId: payload.providerId || card.ref?.providerId || "",
          status: "queued",
        }));
        return;
      }
      const result = await fetchJson("/api/sessions", {
        fetchImpl,
        signal: abortController.signal,
        method: "POST",
        body: payload,
      });
      const sessionId = result?.session?.id || "";
      button.textContent = "Launched";
      if (sessionId && typeof onOpenSession === "function") {
        onOpenSession(sessionId);
      } else if (typeof refresh === "function") {
        refresh();
      }
      return;
    }

    const appId = launcherAppId(card);
    if (!appId) {
      throw new Error("Launcher is missing an app id.");
    }
    if (isRemote) {
      const clientCommandId = `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const commandPayload = await fetchJson(`/api/account/nodes/${encodeURIComponent(remoteNodeId)}/commands`, {
        fetchImpl,
        signal: abortController.signal,
        method: "POST",
        body: {
          operation: "app.launch",
          clientCommandId,
          payload: { appId },
        },
      });
      button.textContent = "Queued";
      queueLaunchLifecycle(root, { storage, refresh }, launchLifecycleFromCommand(commandPayload?.command || {}, {
        lifecycleId: clientCommandId,
        clientCommandId,
        operation: "app.launch",
        remoteNodeId,
        machineId: getCanvasCardMachineId(card),
        remoteUrl: card.ref?.remoteUrl || "",
        sourceCardId: card.id,
        title: card.title || appId,
        subtitle: "remote app launch",
        targetTitle: lifecycleTargetTitle(root, getCanvasCardMachineId(card)),
        appId,
        status: "queued",
      }));
      return;
    }
    const clientCommandId = `local-app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await fetchJson("/api/node/apps/launch", {
      fetchImpl,
      signal: abortController.signal,
      method: "POST",
      body: { appId, clientCommandId },
    });
    button.textContent = "Launched";
    const launcher = result?.launcher && typeof result.launcher === "object" ? result.launcher : {};
    const now = new Date().toISOString();
    queueLaunchLifecycle(root, { storage, refresh }, {
      lifecycleId: clientCommandId,
      clientCommandId,
      operation: "app.launch",
      machineId: getCanvasCardMachineId(card),
      sourceCardId: card.id,
      title: launcher.label || card.title || appId,
      subtitle: "desktop app / launched",
      targetTitle: lifecycleTargetTitle(root, getCanvasCardMachineId(card)),
      appId: launcher.id || appId,
      status: "completed",
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      result: {
        ...((result && typeof result === "object") ? result : {}),
        appId: launcher.id || appId,
      },
    });
  } catch (error) {
    button.removeAttribute("disabled");
    button.textContent = compactText(error?.message || previousText || "Launch failed", 32);
  }
}

async function pairCanvasRegion(button, root, { fetchImpl, abortController, refresh }) {
  const regionId = button.getAttribute("data-swarmlab-canvas-pair-region") || "";
  const region = root.__swarmlabCanvasRegionsById?.[regionId] || null;
  const remoteUrl = String(region?.remoteUrl || "").trim();
  if (!remoteUrl) {
    button.textContent = "No node URL";
    return;
  }
  button.setAttribute("disabled", "true");
  const previousHtml = button.innerHTML;
  button.textContent = "Pairing...";
  try {
    try {
      await fetchJson(REMOTE_NODE_PAIR_URL, {
        fetchImpl,
        signal: abortController.signal,
        method: "POST",
        body: {
          baseUrl: remoteUrl,
          label: regionDisplayName(region, regionId) || "Swarmlab node",
        },
      });
    } catch (serverError) {
      button.textContent = "Pairing from here...";
      try {
        await pairCanvasRegionFromBrowser(region, {
          fetchImpl,
          signal: abortController.signal,
        });
      } catch (browserError) {
        const error = new Error(browserError?.message || serverError?.message || "Could not pair this machine.");
        error.cause = browserError || serverError;
        throw error;
      }
    }
    button.textContent = "Paired";
    if (typeof refresh === "function") {
      refresh();
    }
  } catch (error) {
    button.removeAttribute("disabled");
    button.innerHTML = previousHtml;
    const card = button.closest(".swarmlab-canvas-card.is-agent");
    if (card) {
      updateAgentFeed(card, `
        <div class="swarmlab-agent-message is-error">
          <span>Pair failed</span>
          ${escapeHtml(error?.message || "Could not pair this machine.")}
        </div>
      `);
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
  const { onOpenSession, storage, fetchImpl, abortController, refresh } = options;
  root.__swarmlabCanvasActionOptions = options;
  bindViewportPanAndZoom(root, { storage });
  bindCardDrag(root, { storage });
  bindRegionResize(root, { storage });
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

  if (!root.__swarmlabCanvasPairRegionBound) {
    root.__swarmlabCanvasPairRegionBound = true;
    root.addEventListener("click", (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("[data-swarmlab-canvas-pair-region]")
        : null;
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      void pairCanvasRegion(button, root, root.__swarmlabCanvasActionOptions || {});
    });
  }

  if (!root.__swarmlabCanvasLauncherBound) {
    root.__swarmlabCanvasLauncherBound = true;
    root.addEventListener("click", (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("[data-swarmlab-canvas-launcher]")
        : null;
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      void launchCanvasLauncher(button, root, root.__swarmlabCanvasActionOptions || {});
    });
  }

  if (!root.__swarmlabCanvasDismissLaunchBound) {
    root.__swarmlabCanvasDismissLaunchBound = true;
    root.addEventListener("click", (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("[data-swarmlab-canvas-dismiss-launch]")
        : null;
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      dismissLaunchLifecycle(button, root, root.__swarmlabCanvasActionOptions || {});
    });
  }

  if (!root.__swarmlabCanvasLaunchMachineBound) {
    root.__swarmlabCanvasLaunchMachineBound = true;
    root.addEventListener("click", (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("[data-swarmlab-canvas-launch-machine]")
        : null;
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      const machineId = button.getAttribute("data-swarmlab-canvas-launch-machine") || "";
      const key = root.dataset.swarmlabCanvasLaunchDockStorageKey || "";
      if (machineId && key) {
        try {
          storage.setItem(key, machineId);
        } catch {
          // Dock machine selection is convenience UI state.
        }
      }
      if (machineId) {
        setViewport(root, storage, fitViewportToMachine(root, machineId));
      }
      if (typeof refresh === "function") {
        refresh();
      }
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
    const payload = await fetchJson(SNAPSHOT_URL, {
      fetchImpl,
      signal: abortController.signal,
    });
    const localSnapshot = normalizeNodeSnapshot(payload);
    const remoteRecords = await fetchRemoteNodeRecords({
      fetchImpl,
      signal: abortController.signal,
      storage,
      currentOrigin,
      localNodeId: localSnapshot.node.id,
    });
    if (abortController.signal.aborted) {
      return;
    }
    renderSnapshot(root, payload, { storage, remoteRecords });
    bindCanvasActions(root, options);
    refreshAgentNarratives(root, options);
    void refreshLaunchLifecycles(root, options);
    const windowRef = root.ownerDocument?.defaultView || globalThis.window;
    root.__swarmlabCanvasNarrativePoll = windowRef.setInterval(() => {
      if (!abortController.signal.aborted) {
        refreshAgentNarratives(root, options);
        void refreshLaunchLifecycles(root, options);
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
    void refreshCanvasAccountStatus(documentRef, {
      fetchImpl,
      signal: currentController.signal,
    });
    void loadCanvas(root, {
      ...options,
      abortController: currentController,
    });
  };
  options.refresh = refresh;
  void refreshCanvasAccountStatus(documentRef, {
    fetchImpl,
    signal: currentController.signal,
  });

  documentRef.querySelectorAll("[data-swarmlab-canvas-refresh]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      refresh();
    });
  });

  documentRef.querySelectorAll("[data-swarmlab-canvas-account-login]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const wasConnected = button.dataset.swarmlabCanvasAccountConnected === "true";
      setCanvasAccountButtonState(button, {
        connected: wasConnected,
        busy: true,
        label: wasConnected ? "Refreshing..." : "Opening login...",
      });
      if (wasConnected) {
        windowRef?.setTimeout?.(() => {
          button.removeAttribute("disabled");
          refresh();
        }, 400);
        return;
      }
      try {
        const payload = await fetchJson("/api/node/account/pair/start", {
          fetchImpl,
          signal: currentController.signal,
          method: "POST",
          body: {
            label: "Swarmlab",
            redirectUri: `${locationRef?.origin || ""}/account/auth/complete`,
          },
        });
        const pairingUrl = payload?.pairing?.pairingUrl || payload?.pairingUrl || "";
        if (!pairingUrl) {
          throw new Error("Vibe account did not return a login URL.");
        }
        windowRef?.open?.(pairingUrl, "_blank", "noopener,noreferrer");
        setCanvasAccountButtonState(button, { busy: true, label: "Check browser" });
      } catch (error) {
        setCanvasAccountButtonState(button, {
          label: "Login failed",
          error: error?.message || "Login failed",
        });
      } finally {
        windowRef?.setTimeout?.(() => {
          button.removeAttribute("disabled");
          refresh();
        }, 2_800);
      }
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
