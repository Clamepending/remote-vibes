import { verify as verifySignature } from "node:crypto";
import { launchAppLauncher } from "../app-launchers.js";
import { canonicalizeNodePayload } from "../node/identity-store.js";

const DEFAULT_COMMAND_RELAY_INTERVAL_MS = 5_000;
const MIN_COMMAND_RELAY_INTERVAL_MS = 2_000;
const MAX_COMMAND_RELAY_INTERVAL_MS = 60_000;
const SUPPORTED_COMMAND_OPERATIONS = new Set([
  "session.input.write",
  "session.create",
  "session.narrative.read",
  "app.launch",
  "app.instance.dismiss",
]);
const SECRET_TEXT_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{6,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{6,}\b/g,
  /\b(?:api[_-]?key|token|secret|password|authorization|bearer|ANTHROPIC_API_KEY|OPENAI_API_KEY|HF_TOKEN)=?[A-Za-z0-9_./:=@+-]{4,}\b/gi,
  /([?&](?:token|api_key|key|secret|password|auth|code)=)[^&#\s]+/gi,
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeIntervalMs(value, fallback = DEFAULT_COMMAND_RELAY_INTERVAL_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_COMMAND_RELAY_INTERVAL_MS, Math.min(MAX_COMMAND_RELAY_INTERVAL_MS, Math.round(parsed)));
}

function normalizeBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function compactText(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function compactAccountText(value, max = 700) {
  let text = String(value || "");
  for (const pattern of SECRET_TEXT_PATTERNS) {
    text = text.replace(pattern, (match, prefix = "") => (
      typeof prefix === "string" && prefix.startsWith("?")
        ? `${prefix}[redacted]`
        : "[redacted]"
    ));
  }
  text = text
    .replace(/(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+)(?:\/[^\s"'`)]*)?/g, "[path]")
    .replace(/(?:\/private\/var|\/var\/folders|\/tmp)(?:\/[^\s"'`)]*)?/g, "[path]")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, max);
}

function safeNarrativeEntries(entries = [], maxEntries = 12) {
  const limit = Math.max(1, Math.min(24, Number(maxEntries) || 12));
  return (Array.isArray(entries) ? entries : [])
    .slice(-limit)
    .map((entry, index) => {
      const text = compactAccountText(entry?.text || entry?.outputPreview, 1_200);
      if (!text) return null;
      return {
        id: compactText(entry?.id || `entry-${index}`, 180),
        kind: compactText(entry?.kind || "status", 40),
        label: compactAccountText(entry?.label || entry?.title || entry?.kind || "Session", 80),
        text,
        status: compactText(entry?.status, 40),
        timestamp: compactText(entry?.timestamp || entry?.createdAt, 80),
      };
    })
    .filter(Boolean);
}

function commandSigningEnvelope(command = {}) {
  return {
    schemaVersion: 1,
    id: command.id,
    nodeId: command.nodeId,
    ownerAccountId: command.ownerAccountId,
    operation: command.operation,
    scope: command.scope,
    target: command.target || {},
    payload: command.payload || {},
    clientCommandId: command.clientCommandId || "",
    createdAt: command.createdAt,
    expiresAt: command.expiresAt,
  };
}

function verifyCommandSignature(command = {}, publicKey = "") {
  if (!command?.signature || !publicKey) return false;
  try {
    const signature = Buffer.from(String(command.signature || ""), "base64url");
    return Boolean(signature.length && verifySignature(
      null,
      Buffer.from(canonicalizeNodePayload({ type: "node.command", command: commandSigningEnvelope(command) })),
      publicKey,
      signature,
    ));
  } catch {
    return false;
  }
}

function safeSessionSummary(session = {}) {
  return {
    id: String(session.id || "").trim(),
    name: compactText(session.name || session.title || "", 120),
    providerId: compactText(session.providerId || "", 80),
    status: compactText(session.status || session.activityStatus || "", 80),
  };
}

export class NodeCommandRelayService {
  constructor({
    accountService,
    tokenStore,
    nodeIdentityStore,
    sessionManager,
    appLaunchersProvider = () => [],
    appLauncher = launchAppLauncher,
    appInstanceDismisser = null,
    settingsProvider = () => ({}),
    intervalMs = null,
    log = console,
  } = {}) {
    if (!accountService) {
      throw new Error("NodeCommandRelayService requires an accountService.");
    }
    if (!tokenStore) {
      throw new Error("NodeCommandRelayService requires a tokenStore.");
    }
    if (!nodeIdentityStore) {
      throw new Error("NodeCommandRelayService requires a nodeIdentityStore.");
    }
    if (!sessionManager) {
      throw new Error("NodeCommandRelayService requires a sessionManager.");
    }
    this.accountService = accountService;
    this.tokenStore = tokenStore;
    this.nodeIdentityStore = nodeIdentityStore;
    this.sessionManager = sessionManager;
    this.appLaunchersProvider = appLaunchersProvider;
    this.appLauncher = appLauncher;
    this.appInstanceDismisser = appInstanceDismisser;
    this.settingsProvider = settingsProvider;
    this.intervalOverrideMs = intervalMs;
    this.log = log || console;
    this.timer = null;
    this.inFlight = null;
    this.lastPollAt = "";
    this.lastPollStatus = "";
    this.lastPollError = "";
    this.lastCommandAt = "";
    this.executedCount = 0;
  }

  getSettings() {
    const settings = this.settingsProvider();
    return settings && typeof settings === "object" ? settings : {};
  }

  getIntervalMs() {
    const settings = this.getSettings();
    return normalizeIntervalMs(
      this.intervalOverrideMs ??
        settings.swarmlabAccountCommandRelayIntervalMs ??
        settings.vibeAccountCommandRelayIntervalMs,
    );
  }

  isEnabled() {
    const settings = this.getSettings();
    return normalizeBoolean(
      settings.swarmlabAccountCommandRelayEnabled ??
        settings.vibeAccountCommandRelayEnabled,
      true,
    );
  }

  isConnected() {
    return Boolean(this.tokenStore.getRecord()?.accessToken);
  }

  getAccountPublicKey(polledPublicKey = "") {
    return String(polledPublicKey || this.tokenStore.getRecord()?.accountPublicKey || "").trim();
  }

  verifyCommand(command, accountPublicKey = "") {
    const record = this.tokenStore.getRecord();
    const nodeId = String(record?.node?.nodeId || "").trim();
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new Error("Command is malformed.");
    }
    if (!SUPPORTED_COMMAND_OPERATIONS.has(String(command.operation || ""))) {
      throw new Error(`Unsupported command operation: ${command.operation || "unknown"}.`);
    }
    if (!nodeId || command.nodeId !== nodeId) {
      throw new Error("Command is for a different node.");
    }
    const expiresAtMs = Date.parse(command.expiresAt || "");
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      throw new Error("Command has expired.");
    }
    const publicKey = this.getAccountPublicKey(accountPublicKey);
    if (!verifyCommandSignature(command, publicKey)) {
      throw new Error("Command signature is invalid.");
    }
    return true;
  }

  executeSessionInput(command) {
    const payload = command.payload || {};
    const sessionId = compactText(payload.sessionId || payload.session_id, 180);
    const input = String(payload.input || payload.message || payload.text || "").trim();
    if (!sessionId || !input) {
      throw new Error("Remote session input command is missing sessionId or input.");
    }
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    const submitted = input.endsWith("\n") || input.endsWith("\r") ? input : `${input}\n`;
    const ok = this.sessionManager.write(sessionId, submitted, {
      clientMessageId: compactText(payload.clientMessageId || command.clientCommandId, 180) || null,
    });
    if (!ok) {
      throw new Error("Session input was not accepted.");
    }
    return {
      accepted: true,
      sessionId,
      session: safeSessionSummary(this.sessionManager.serializeSession?.(session) || session),
    };
  }

  executeSessionCreate(command) {
    const payload = command.payload || {};
    const session = this.sessionManager.createSession({
      providerId: compactText(payload.providerId, 80) || undefined,
      name: compactText(payload.name || "Remote agent", 120),
      cwd: String(payload.cwd || "").trim() || undefined,
      initialPrompt: String(payload.initialPrompt || "").trim() || undefined,
      initialPromptDelayMs: Number.isFinite(Number(payload.initialPromptDelayMs)) ? Number(payload.initialPromptDelayMs) : undefined,
    });
    return {
      created: true,
      session: safeSessionSummary(session),
    };
  }

  async executeSessionNarrativeRead(command) {
    const payload = command.payload || {};
    const sessionId = compactText(payload.sessionId || payload.session_id, 180);
    if (!sessionId) {
      throw new Error("Remote session narrative command is missing sessionId.");
    }
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found.");
    }
    if (typeof this.sessionManager.getSessionNarrative !== "function") {
      throw new Error("Session narrative readback is not available.");
    }
    const maxEntries = Math.max(1, Math.min(24, Number(payload.maxEntries || payload.max_entries) || 12));
    const narrative = await this.sessionManager.getSessionNarrative(sessionId, { maxEntries: Math.max(maxEntries, 24) });
    const entries = safeNarrativeEntries(narrative?.entries || [], maxEntries);
    return {
      sessionId,
      session: {
        ...safeSessionSummary(this.sessionManager.serializeSession?.(session) || session),
        recentNarrative: entries.slice(-6),
      },
      narrative: {
        sourceLabel: compactAccountText(narrative?.sourceLabel || "Session narrative", 120),
        providerBacked: Boolean(narrative?.providerBacked),
        entries,
      },
    };
  }

  async executeAppLaunch(command) {
    const payload = command.payload || {};
    const launcherId = compactText(payload.appId || payload.launcherId || payload.id, 80);
    if (!launcherId) {
      throw new Error("Remote app launch command is missing appId.");
    }
    return this.appLauncher(launcherId, this.appLaunchersProvider(), {
      clientCommandId: compactText(payload.clientCommandId || command.clientCommandId || command.id, 180),
      source: "account",
    });
  }

  async executeAppInstanceDismiss(command) {
    const payload = command.payload || {};
    const instanceId = compactText(
      payload.instanceId || payload.instance_id || payload.appInstanceId || payload.app_instance_id || payload.id,
      180,
    );
    if (!instanceId) {
      throw new Error("Remote app instance dismiss command is missing instanceId.");
    }
    if (typeof this.appInstanceDismisser !== "function") {
      throw new Error("Remote app instance dismissal is not available.");
    }
    const instance = await this.appInstanceDismisser(instanceId, {
      clientCommandId: compactText(payload.clientCommandId || command.clientCommandId || command.id, 180),
      source: "account",
    });
    if (!instance) {
      throw new Error("App instance not found.");
    }
    return {
      dismissed: true,
      instance,
    };
  }

  async executeCommand(command) {
    if (command.operation === "session.input.write") {
      return this.executeSessionInput(command);
    }
    if (command.operation === "session.create") {
      return this.executeSessionCreate(command);
    }
    if (command.operation === "session.narrative.read") {
      return this.executeSessionNarrativeRead(command);
    }
    if (command.operation === "app.launch") {
      return this.executeAppLaunch(command);
    }
    if (command.operation === "app.instance.dismiss") {
      return this.executeAppInstanceDismiss(command);
    }
    throw new Error(`Unsupported command operation: ${command.operation || "unknown"}.`);
  }

  buildAck(command, { status = "completed", result = {}, error = "" } = {}) {
    const record = this.tokenStore.getRecord();
    const unsigned = {
      commandId: String(command.id || "").trim(),
      nodeId: String(record?.node?.nodeId || command.nodeId || "").trim(),
      leaseId: String(command.leaseId || "").trim(),
      status,
      result: result && typeof result === "object" && !Array.isArray(result) ? result : {},
      error: compactText(error, 500),
      generatedAt: nowIso(),
    };
    return {
      ack: unsigned,
      signature: this.nodeIdentityStore.signPayload({ type: "node.command.ack", ack: unsigned }),
    };
  }

  async runCommand(command, accountPublicKey = "") {
    let ack;
    try {
      this.verifyCommand(command, accountPublicKey);
      const result = await this.executeCommand(command);
      ack = this.buildAck(command, { status: "completed", result });
      this.executedCount += 1;
      this.lastCommandAt = ack.ack.generatedAt;
    } catch (error) {
      ack = this.buildAck(command, { status: "failed", error: error?.message || String(error) });
    }
    return this.accountService.acknowledgeCommand({
      settings: this.getSettings(),
      commandId: command.id,
      ack,
    });
  }

  async tick({ reason = "manual" } = {}) {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = (async () => {
      if (!this.isEnabled()) {
        return { skipped: true, reason: "command-relay-disabled" };
      }
      if (!this.isConnected()) {
        return { skipped: true, reason: "account-not-connected" };
      }

      try {
        const payload = await this.accountService.listCommands({
          settings: this.getSettings(),
          limit: 10,
        });
        const commands = Array.isArray(payload.commands) ? payload.commands : [];
        for (const command of commands) {
          await this.runCommand(command, payload.accountPublicKey);
        }
        this.lastPollAt = nowIso();
        this.lastPollStatus = commands.length ? "commands-processed" : "ok";
        this.lastPollError = "";
        return { ok: true, reason, commandCount: commands.length };
      } catch (error) {
        this.lastPollAt = nowIso();
        this.lastPollStatus = "failed";
        this.lastPollError = error?.message || String(error);
        throw error;
      }
    })().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  start({ immediate = true } = {}) {
    if (this.timer) {
      return false;
    }
    if (!this.isEnabled() || !this.isConnected()) {
      return false;
    }
    this.timer = setInterval(() => {
      void this.tick({ reason: "timer" }).catch((error) => {
        this.log?.warn?.("[swarmlab] Vibe account command poll failed", error?.message || error);
      });
    }, this.getIntervalMs());
    this.timer.unref?.();
    if (immediate) {
      void this.tick({ reason: "startup" }).catch((error) => {
        this.log?.warn?.("[swarmlab] Vibe account startup command poll failed", error?.message || error);
      });
    }
    return true;
  }

  stop() {
    if (!this.timer) {
      return false;
    }
    clearInterval(this.timer);
    this.timer = null;
    return true;
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      connected: this.isConnected(),
      running: Boolean(this.timer),
      intervalMs: this.getIntervalMs(),
      lastPollAt: this.lastPollAt,
      lastPollStatus: this.lastPollStatus,
      lastPollError: this.lastPollError,
      lastCommandAt: this.lastCommandAt,
      executedCount: this.executedCount,
    };
  }
}

export {
  DEFAULT_COMMAND_RELAY_INTERVAL_MS,
  MAX_COMMAND_RELAY_INTERVAL_MS,
  MIN_COMMAND_RELAY_INTERVAL_MS,
  commandSigningEnvelope,
  verifyCommandSignature,
};
