import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_MAX_ENTRIES = 96;
const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_HEALTH_TIMEOUT_MS = 1_500;
const SERVER_READY_TIMEOUT_MS = 30_000;
const SERVER_READY_INTERVAL_MS = 350;
const IMAGE_REF_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg)\b/iu;

function normalizeBaseUrl(value) {
  const rawValue = String(value || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_BASE_URL;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/u, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function normalizeModel(value) {
  return String(value || "").trim();
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function parseBooleanEnv(value, fallback = false) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeTransport(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "api" || normalized === "fastapi" ? "api" : "cli";
}

function providerFromModel(model) {
  const normalized = normalizeModel(model);
  if (!normalized || !normalized.includes("/")) {
    return "openai";
  }
  const withoutPrefix = normalized.startsWith("litellm/") ? normalized.slice("litellm/".length) : normalized;
  return withoutPrefix.split("/", 1)[0].toLowerCase();
}

function buildLitellmKeys(env = process.env) {
  const keys = {};
  const anthropic = String(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || "").trim();
  const google = String(env.GOOGLE_API_KEY || "").trim();
  const openai = String(env.OPENAI_API_KEY || "").trim();
  if (anthropic) keys.anthropic = anthropic;
  if (google) {
    keys.gemini = google;
    keys.google = google;
  }
  if (openai) keys.openai = openai;
  return keys;
}

export function buildOpenSwarmClientConfig({
  env = process.env,
  model = "",
  baseUrl = "",
} = {}) {
  const normalizedModel = normalizeModel(model || env.DEFAULT_MODEL || env.VIBE_RESEARCH_OPENSWARM_MODEL || "");
  const clientConfig = {};
  if (normalizedModel) {
    clientConfig.model = normalizedModel;
  }

  const openAiApiKey = String(env.OPENAI_API_KEY || "").trim();
  const apiBaseUrl = String(
    baseUrl ||
      env.VIBE_RESEARCH_OPENSWARM_OPENAI_BASE_URL ||
      env.REMOTE_VIBES_OPENSWARM_OPENAI_BASE_URL ||
      "",
  ).trim();
  const modelProvider = providerFromModel(normalizedModel);

  if (openAiApiKey && (modelProvider === "openai" || !normalizedModel.includes("/"))) {
    clientConfig.api_key = openAiApiKey;
  }
  if (apiBaseUrl) {
    clientConfig.base_url = apiBaseUrl;
  }

  const litellmKeys = buildLitellmKeys(env);
  if (Object.keys(litellmKeys).length) {
    clientConfig.litellm_keys = litellmKeys;
  }

  return clientConfig;
}

function findOpenSwarmPackageRoot(launchCommand) {
  const command = String(launchCommand || "").trim();
  if (!command || command.includes("/") === false) {
    return "";
  }

  let resolvedCommand = command;
  try {
    resolvedCommand = realpathSync(command);
  } catch {
    resolvedCommand = command;
  }

  const candidates = [
    path.dirname(resolvedCommand),
    path.dirname(path.dirname(resolvedCommand)),
    path.dirname(path.dirname(path.dirname(resolvedCommand))),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(path.join(candidate, "server.py")) && existsSync(path.join(candidate, "swarm.py"))) {
      return candidate;
    }
  }

  return "";
}

export function inferOpenSwarmServerCommand(launchCommand, env = process.env) {
  const explicit = String(
    env.VIBE_RESEARCH_OPENSWARM_SERVER_COMMAND ||
      env.REMOTE_VIBES_OPENSWARM_SERVER_COMMAND ||
      "",
  ).trim();
  if (explicit) {
    return { command: explicit, cwd: "" };
  }

  if (!parseBooleanEnv(env.VIBE_RESEARCH_OPENSWARM_AUTOSTART_SERVER ?? env.REMOTE_VIBES_OPENSWARM_AUTOSTART_SERVER, true)) {
    return { command: "", cwd: "" };
  }

  const packageRoot = findOpenSwarmPackageRoot(launchCommand);
  if (!packageRoot) {
    return { command: "", cwd: "" };
  }

  const python = String(env.PYTHON || env.PYTHON3 || "python3").trim() || "python3";
  return {
    command: `cd ${quoteShellArg(packageRoot)} && ${quoteShellArg(python)} server.py`,
    cwd: packageRoot,
  };
}

export function buildOpenSwarmRunArgs({
  cwd = process.cwd(),
  model = "",
  sessionId = "",
  prompt = "",
  files = [],
  agent = "",
  bypassPermissions = true,
} = {}) {
  const args = ["run", "--format", "json", "--dir", String(cwd || process.cwd())];
  const normalizedModel = normalizeModel(model);
  if (normalizedModel) {
    args.push("--model", normalizedModel);
  }
  const normalizedSessionId = String(sessionId || "").trim();
  if (normalizedSessionId) {
    args.push("--session", normalizedSessionId);
  }
  const normalizedAgent = String(agent || "").trim();
  if (normalizedAgent) {
    args.push("--agent", normalizedAgent);
  }
  if (bypassPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  for (const file of files) {
    const normalizedFile = String(file || "").trim();
    if (normalizedFile) {
      args.push("--file", normalizedFile);
    }
  }
  args.push(String(prompt || ""));
  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function responseTextFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  if (typeof payload.response === "string") {
    return payload.response.trim();
  }
  if (payload.response === null || payload.response === undefined) {
    return "";
  }
  try {
    return JSON.stringify(payload.response, null, 2);
  } catch {
    return String(payload.response || "").trim();
  }
}

function abortSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS));
  return { controller, timeout };
}

function trimTrailingPunct(raw) {
  let trimmed = String(raw || "").trim();
  while (trimmed.length && /[.,;:!?)\]]/u.test(trimmed[trimmed.length - 1])) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function extractImageRefsFromText(text, maxRefs = 8) {
  const source = String(text || "");
  if (!source) return [];
  const refs = [];
  const seen = new Set();
  const push = (raw) => {
    const value = trimTrailingPunct(raw);
    if (!value || !IMAGE_REF_RE.test(value) || seen.has(value)) return;
    seen.add(value);
    refs.push(value);
  };

  for (const match of source.matchAll(/!\[[^\]]*\]\(<([^>]+)>(?:\s+"[^"]*")?\)/gu)) {
    push(match[1]);
    if (refs.length >= maxRefs) return refs;
  }
  for (const match of source.matchAll(/!\[[^\]]*\]\(([^)<>\s]+)(?:\s+"[^"]*")?\)/gu)) {
    push(match[1]);
    if (refs.length >= maxRefs) return refs;
  }
  for (const match of source.matchAll(/<([^<>\n]+\.[A-Za-z0-9]{2,8})>/gu)) {
    push(match[1]);
    if (refs.length >= maxRefs) return refs;
  }
  for (const match of source.matchAll(/"([^"\n]+\.[A-Za-z0-9]{2,8})"/gu)) {
    push(match[1]);
    if (refs.length >= maxRefs) return refs;
  }

  const pathChar = "[\\p{L}\\p{N}_.@~+-]";
  const pathRe = new RegExp(
    `(\\/(?:${pathChar}+\\/)+${pathChar}+\\.[A-Za-z0-9]{2,8}|(?:${pathChar}+\\/)+${pathChar}+\\.[A-Za-z0-9]{2,8})`,
    "gu",
  );
  for (const match of source.matchAll(pathRe)) {
    push(match[1]);
    if (refs.length >= maxRefs) break;
  }
  return refs;
}

function summarizeUsage(tokens) {
  if (!tokens || typeof tokens !== "object") return "";
  const total = Number(tokens.total || 0);
  const input = Number(tokens.input || 0);
  const output = Number(tokens.output || 0);
  const reasoning = Number(tokens.reasoning || 0);
  const parts = [];
  if (input) parts.push(`in ${input.toLocaleString()}`);
  if (output) parts.push(`out ${output.toLocaleString()}`);
  if (reasoning) parts.push(`reasoning ${reasoning.toLocaleString()}`);
  if (!total && !parts.length) return "";
  return `${(total || input + output + reasoning).toLocaleString()} tokens${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

function normalizeAttachmentFiles(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((attachment) => String(attachment?.absolutePath || attachment?.path || attachment || "").trim())
    .filter(Boolean);
}

export class OpenSwarmApiSession extends EventEmitter {
  constructor({
    sessionId = randomUUID(),
    cwd = process.cwd(),
    env = process.env,
    provider = null,
    baseUrl = "",
    model = "",
    maxEntries = DEFAULT_MAX_ENTRIES,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    spawnFn = spawn,
    allocateSeq = null,
    transport = "",
    openswarmBin = "",
  } = {}) {
    super();
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.env = env && typeof env === "object" ? env : process.env;
    this.provider = provider && typeof provider === "object" ? provider : null;
    this.baseUrl = normalizeBaseUrl(baseUrl || this.env.VIBE_RESEARCH_OPENSWARM_API_URL || this.env.REMOTE_VIBES_OPENSWARM_API_URL);
    this.model = normalizeModel(model || this.env.VIBE_RESEARCH_OPENSWARM_MODEL || this.env.DEFAULT_MODEL || "");
    this.agent = String(this.env.VIBE_RESEARCH_OPENSWARM_AGENT || this.env.REMOTE_VIBES_OPENSWARM_AGENT || "").trim();
    this.transport = normalizeTransport(
      transport ||
        this.env.VIBE_RESEARCH_OPENSWARM_TRANSPORT ||
        this.env.REMOTE_VIBES_OPENSWARM_TRANSPORT ||
        "cli",
    );
    this.openswarmBin = String(
      openswarmBin ||
        this.env.VIBE_RESEARCH_OPENSWARM_BIN ||
        this.env.REMOTE_VIBES_OPENSWARM_BIN ||
        this.provider?.launchCommand ||
        "openswarm",
    ).trim() || "openswarm";
    this.bypassPermissions = parseBooleanEnv(
      this.env.VIBE_RESEARCH_OPENSWARM_BYPASS_PERMISSIONS ?? this.env.REMOTE_VIBES_OPENSWARM_BYPASS_PERMISSIONS,
      true,
    );
    this.maxEntries = Math.max(1, Number(maxEntries) || DEFAULT_MAX_ENTRIES);
    this.requestTimeoutMs = Math.max(1_000, Number(requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
    this.fetchImpl = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
    this.spawnFn = typeof spawnFn === "function" ? spawnFn : spawn;
    this.status = "idle";
    this.entries = [];
    this.chatHistory = [];
    this.lastEventAt = "";
    this.openSwarmSessionId = "";
    this._allocateSeq = typeof allocateSeq === "function" ? allocateSeq : (() => 0);
    this._allEntries = [];
    this._pendingThinking = false;
    this._activeTurn = null;
    this._activeChild = null;
    this._stdoutBuffer = "";
    this._turnIndex = 0;
    this._currentAssistantEntryId = "";
    this._serverProcess = null;
    this._serverStartPromise = null;
  }

  start() {
    this.status = "idle";
    return this;
  }

  send(text) {
    return this._sendPrompt(text, []);
  }

  async sendWithImages(text, attachments = []) {
    return this._sendPrompt(text || "Take a look at these files.", normalizeAttachmentFiles(attachments));
  }

  close() {
    if (this._activeChild) {
      try {
        this._activeChild.kill("SIGTERM");
      } catch {
        // already gone
      }
      this._activeChild = null;
    }
    if (this._serverProcess) {
      try {
        this._serverProcess.kill("SIGTERM");
      } catch {
        // already gone
      }
      this._serverProcess = null;
    }
    this.status = "exited";
    this.emit("exit", { code: 0, signal: null });
  }

  _sendPrompt(text, files = []) {
    const value = String(text ?? "").trim();
    if (!value && !files.length) {
      return false;
    }
    if (this._activeTurn || this._activeChild) {
      this.emit("error", new Error("OpenSwarm is busy with a prior turn"));
      return false;
    }

    this._pendingThinking = true;
    this._currentAssistantEntryId = "";
    this._refreshEntries();
    this._activeTurn = this._runTurn(value || "Review the attached files.", files);
    return true;
  }

  async _runTurn(prompt, files) {
    this.status = "running";
    this.emit("event", { type: "turn-started" });

    try {
      if (this.transport === "api") {
        await this._runApiTurn(prompt);
      } else {
        await this._runCliTurn(prompt, files);
      }
      this.status = "idle";
      this._pendingThinking = false;
      this._activeTurn = null;
      this._refreshEntries();
      this.emit("turn-complete", {});
    } catch (error) {
      this.status = "idle";
      this._pendingThinking = false;
      this._activeTurn = null;
      this._appendEntry({
        id: `openswarm-error-${randomUUID()}`,
        kind: "status",
        label: this.transport === "api" ? "OpenSwarm API error" : "OpenSwarm error",
        text: error.message || "OpenSwarm request failed.",
        timestamp: nowIso(),
        status: "error",
        meta: this.transport === "api" ? "fastapi" : "json-cli",
      });
      this._refreshEntries();
      this.emit("error", error);
      this.emit("turn-complete", { error });
    }
  }

  async _runApiTurn(prompt) {
    await this._ensureServer();
    const payload = await this._postPrompt(prompt);
    const text = responseTextFromPayload(payload) || "(OpenSwarm returned no final text.)";
    this._appendEntry({
      id: `openswarm-assistant-${randomUUID()}`,
      kind: "assistant",
      label: "OpenSwarm",
      text,
      timestamp: nowIso(),
      meta: "final",
      imageRefs: extractImageRefsFromText(text),
    });
    if (Array.isArray(payload?.new_messages)) {
      this.chatHistory = [...this.chatHistory, ...payload.new_messages];
    }
  }

  _runCliTurn(prompt, files = []) {
    return new Promise((resolve, reject) => {
      this._turnIndex += 1;
      const turnIndex = this._turnIndex;
      const args = buildOpenSwarmRunArgs({
        cwd: this.cwd,
        model: this.model,
        sessionId: this.openSwarmSessionId,
        prompt,
        files,
        agent: this.agent,
        bypassPermissions: this.bypassPermissions,
      });
      const child = this.spawnFn(this.openswarmBin, args, {
        cwd: this.cwd,
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this._activeChild = child;
      this._stdoutBuffer = "";

      child.stdout?.setEncoding?.("utf8");
      child.stdout?.on?.("data", (chunk) => this._handleCliStdoutChunk(turnIndex, chunk));

      child.stderr?.setEncoding?.("utf8");
      child.stderr?.on?.("data", (chunk) => {
        const text = String(chunk || "");
        if (text.trim()) {
          this.emit("stderr", text);
        }
      });

      child.on?.("error", (error) => {
        this._activeChild = null;
        reject(error);
      });
      child.on?.("close", (code, signal) => {
        this._flushCliStdout(turnIndex);
        this._activeChild = null;
        if (code && code !== 0) {
          this._appendEntry({
            id: `openswarm-exit-${turnIndex}`,
            kind: "status",
            label: "OpenSwarm",
            text: `OpenSwarm exited with code ${code}${signal ? ` (${signal})` : ""}.`,
            timestamp: nowIso(),
            status: "error",
            meta: "json-cli",
          });
        }
        resolve({ code, signal });
      });
    });
  }

  _handleCliStdoutChunk(turnIndex, chunk) {
    this._stdoutBuffer += String(chunk || "");
    let nl = this._stdoutBuffer.indexOf("\n");
    while (nl !== -1) {
      const line = this._stdoutBuffer.slice(0, nl);
      this._stdoutBuffer = this._stdoutBuffer.slice(nl + 1);
      this._handleCliLine(turnIndex, line);
      nl = this._stdoutBuffer.indexOf("\n");
    }
  }

  _flushCliStdout(turnIndex) {
    if (this._stdoutBuffer.trim()) {
      this._handleCliLine(turnIndex, this._stdoutBuffer);
    }
    this._stdoutBuffer = "";
  }

  _handleCliLine(turnIndex, rawLine) {
    const line = String(rawLine || "").replace(/\r$/u, "").trim();
    if (!line) return;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      this.emit("stderr", line);
      return;
    }

    const stamp = nowIso();
    this.lastEventAt = stamp;
    if (typeof event.sessionID === "string" && event.sessionID.trim()) {
      this.openSwarmSessionId = event.sessionID.trim();
    }

    const type = String(event.type || event.part?.type || "").trim();
    if (type === "step_start" || type === "step-start") {
      this._pendingThinking = true;
    } else if (type === "text") {
      const text = String(event.part?.text || event.text || "").trim();
      if (text) {
        this._appendAssistantText(turnIndex, event.part?.messageID || event.messageID || "message", text, stamp);
        this._pendingThinking = false;
      }
    } else if (type === "step_finish" || type === "step-finish") {
      this._pendingThinking = false;
      const usage = summarizeUsage(event.part?.tokens || event.tokens);
      if (usage) {
        this._appendEntry({
          id: `openswarm-usage-${turnIndex}`,
          kind: "status",
          label: "Usage",
          text: usage,
          timestamp: stamp,
          meta: "openswarm-usage",
        });
      }
    } else if (type === "error") {
      this._pendingThinking = false;
      const message = String(
        event.error?.data?.message ||
          event.error?.message ||
          event.message ||
          "OpenSwarm turn failed",
      ).trim();
      this._appendEntry({
        id: `openswarm-error-${turnIndex}-${randomUUID()}`,
        kind: "status",
        label: "OpenSwarm error",
        text: message,
        timestamp: stamp,
        meta: "json-cli",
        status: "error",
      });
    } else if (/tool/iu.test(type) || event.part?.tool || event.part?.name) {
      this._appendGenericToolEvent(turnIndex, event, stamp);
    }

    this._refreshEntries();
    this.emit("event", event);
  }

  _appendAssistantText(turnIndex, messageId, text, timestamp) {
    const id = this._currentAssistantEntryId || `openswarm-assistant-${turnIndex}-${String(messageId || "message")}`;
    this._currentAssistantEntryId = id;
    const existing = this._allEntries.find((entry) => entry.id === id);
    if (existing) {
      if (text.startsWith(existing.text)) {
        existing.text = text;
      } else if (!existing.text.endsWith(text)) {
        existing.text = `${existing.text}${text}`;
      }
      existing.timestamp = timestamp;
      existing.imageRefs = extractImageRefsFromText(existing.text);
      return;
    }
    this._appendEntry({
      id,
      kind: "assistant",
      label: "OpenSwarm",
      text,
      timestamp,
      meta: "final",
      imageRefs: extractImageRefsFromText(text),
    });
  }

  _appendGenericToolEvent(turnIndex, event, timestamp) {
    const part = event.part && typeof event.part === "object" ? event.part : event;
    const label = String(part.name || part.tool || part.type || "Tool").trim() || "Tool";
    let text = "";
    if (typeof part.input === "string") {
      text = part.input;
    } else if (part.input && typeof part.input === "object") {
      text = JSON.stringify(part.input);
    } else if (typeof part.text === "string") {
      text = part.text;
    }
    let outputPreview = "";
    if (typeof part.output === "string") {
      outputPreview = part.output;
    } else if (typeof part.result === "string") {
      outputPreview = part.result;
    } else if (part.output || part.result) {
      outputPreview = JSON.stringify(part.output || part.result);
    }
    this._appendEntry({
      id: `openswarm-tool-${turnIndex}-${String(part.id || event.id || randomUUID())}`,
      kind: "tool",
      label,
      text: text || label,
      outputPreview,
      timestamp,
      meta: String(event.type || "tool"),
      imageRefs: extractImageRefsFromText(`${text}\n${outputPreview}`),
    });
  }

  _appendEntry(entry) {
    const normalized = {
      ...entry,
      seq: this._allocateSeq(),
    };
    if (!Array.isArray(normalized.imageRefs) || !normalized.imageRefs.length) {
      delete normalized.imageRefs;
    }
    this._allEntries.push(normalized);
  }

  async _postPrompt(prompt) {
    const endpoint = `${this.baseUrl}/open-swarm/get_response`;
    const clientConfig = buildOpenSwarmClientConfig({
      env: this.env,
      model: this.model,
    });
    const body = {
      message: prompt,
      chat_history: this.chatHistory,
      client_config: Object.keys(clientConfig).length ? clientConfig : undefined,
    };
    const apiToken = String(
      this.env.VIBE_RESEARCH_OPENSWARM_APP_TOKEN ||
        this.env.REMOTE_VIBES_OPENSWARM_APP_TOKEN ||
        this.env.OPENSWARM_APP_TOKEN ||
        this.env.APP_TOKEN ||
        "",
    ).trim();
    const headers = { "Content-Type": "application/json" };
    if (apiToken) {
      headers.Authorization = `Bearer ${apiToken}`;
    }
    const { controller, timeout } = abortSignal(this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { response: text };
      }
      if (!response.ok || payload?.error) {
        throw new Error(String(payload?.error || `OpenSwarm API failed (${response.status})`));
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async _ensureServer() {
    if (await this._isServerReady(DEFAULT_HEALTH_TIMEOUT_MS)) {
      return true;
    }

    if (!this._serverStartPromise) {
      this._serverStartPromise = this._startServerProcess();
    }

    const started = await this._serverStartPromise;
    if (!started) {
      throw new Error(`OpenSwarm API is not reachable at ${this.baseUrl}. Run openswarm once for setup or configure the OpenSwarm server command in Settings.`);
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
      if (await this._isServerReady(DEFAULT_HEALTH_TIMEOUT_MS)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, SERVER_READY_INTERVAL_MS));
    }

    throw new Error(`OpenSwarm API is not reachable at ${this.baseUrl}. Run openswarm once for setup or configure the OpenSwarm server command in Settings.`);
  }

  async _isServerReady(timeoutMs) {
    if (!this.fetchImpl) {
      return false;
    }
    const { controller, timeout } = abortSignal(timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/openapi.json`, {
        method: "GET",
        signal: controller.signal,
      });
      return Boolean(response?.ok);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async _startServerProcess() {
    const inferred = inferOpenSwarmServerCommand(this.provider?.launchCommand || "", this.env);
    if (!inferred.command) {
      return false;
    }

    const shell = String(this.env.SHELL || "/bin/bash").trim() || "/bin/bash";
    const serverCwd = inferred.cwd || this.cwd;
    const child = this.spawnFn(shell, ["-lc", inferred.command], {
      cwd: serverCwd,
      env: this.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    this._serverProcess = child;
    this._appendEntry({
      id: `openswarm-server-${randomUUID()}`,
      kind: "status",
      label: "OpenSwarm server",
      text: `Starting OpenSwarm API server for native mode at ${this.baseUrl}.`,
      timestamp: nowIso(),
      meta: "fastapi",
    });
    this._refreshEntries();

    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (text) {
        this.emit("stderr", text);
      }
    });
    child.on?.("error", (error) => {
      this.emit("error", error);
    });
    child.on?.("close", (code, signal) => {
      if (this._serverProcess === child) {
        this._serverProcess = null;
      }
      if (code && code !== 0) {
        this.emit("stderr", `OpenSwarm API server exited (code=${code}, signal=${signal || "n/a"}).`);
      }
    });

    return true;
  }

  _refreshEntries() {
    const entries = this._allEntries.slice(-this.maxEntries);
    if (this._pendingThinking) {
      entries.push({
        id: "openswarm-pending-assistant",
        kind: "assistant",
        label: "OpenSwarm",
        text: "",
        timestamp: nowIso(),
        meta: "pending",
        seq: this._allocateSeq(),
      });
    }
    this.entries = entries.slice(-this.maxEntries);
    this.lastEventAt = nowIso();
    this.emit("entries", this.entries);
    this.emit("event", { type: "entries" });
  }
}
