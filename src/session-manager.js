import { execFile } from "node:child_process";
import os from "node:os";
import { statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pty from "node-pty";
import { SessionStore } from "./session-store.js";

const MAX_BUFFER_LENGTH = 200_000;
const STARTUP_DELAY_MS = 180;
const SESSION_META_THROTTLE_MS = 180;
const SESSION_PERSIST_THROTTLE_MS = 180;
const OPENCODE_SESSION_LIST_LIMIT = 50;
const OPENCODE_SESSION_CAPTURE_ATTEMPTS = 16;
const OPENCODE_SESSION_CAPTURE_INTERVAL_MS = 250;
const OPENCODE_SESSION_LOOKBACK_MS = 4_000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRootDir = path.resolve(__dirname, "..");
const helperBinDir = path.join(appRootDir, "bin");
const preferredCliBinDirs = [helperBinDir, "/opt/homebrew/bin", "/usr/local/bin"];
const execFileAsync = promisify(execFile);

function getShellArgs(shellPath) {
  const shellName = path.basename(shellPath);

  if (shellName === "fish") {
    return ["-i", "-l"];
  }

  return ["-i", "-l"];
}

function trimBuffer(buffer) {
  if (buffer.length <= MAX_BUFFER_LENGTH) {
    return buffer;
  }

  return buffer.slice(buffer.length - MAX_BUFFER_LENGTH);
}

export function prependPathEntries(existingPath, entries) {
  const currentEntries = String(existingPath || "")
    .split(path.delimiter)
    .filter(Boolean);

  const nextEntries = Array.isArray(entries) ? entries : [entries];
  const uniqueEntries = nextEntries.filter(
    (entry, index) => entry && nextEntries.indexOf(entry) === index,
  );

  return [...uniqueEntries, ...currentEntries.filter((candidate) => !uniqueEntries.includes(candidate))].join(
    path.delimiter,
  );
}

function getResolvedProviderCommand(providers, providerId) {
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider?.available) {
    return null;
  }

  return provider.launchCommand || provider.command || null;
}

export function buildSessionEnv(sessionId, providerId, providers = []) {
  return {
    ...process.env,
    COLORTERM: "truecolor",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    PATH: prependPathEntries(process.env.PATH, preferredCliBinDirs),
    REMOTE_VIBES_APP_ROOT: appRootDir,
    REMOTE_VIBES_BROWSER_COMMAND: "rv-browser",
    REMOTE_VIBES_BROWSER_DESCRIBE:
      "rv-browser describe 4173 --prompt \"What visual issues stand out in the rendered UI?\"",
    REMOTE_VIBES_BROWSER_HELP: "rv-browser screenshot 4173",
    REMOTE_VIBES_BROWSER_RUN_HELP:
      "rv-browser run 4173 --steps '[{\"action\":\"type\",\"selector\":\"textarea\",\"text\":\"hello\"},{\"action\":\"click\",\"selector\":\"text=Generate\"},{\"action\":\"wait\",\"text\":\"Done\"},{\"action\":\"screenshot\",\"path\":\"final.png\"}]'",
    REMOTE_VIBES_BROWSER_IMAGE_HELP:
      "rv-browser describe-file results/chart.png --prompt \"What does this output show and what should improve?\"",
    REMOTE_VIBES_REAL_CLAUDE_COMMAND: getResolvedProviderCommand(providers, "claude") || "",
    REMOTE_VIBES_REAL_CODEX_COMMAND: getResolvedProviderCommand(providers, "codex") || "",
    REMOTE_VIBES_PROVIDER: providerId,
    REMOTE_VIBES_SESSION_ID: sessionId,
    TERM: "xterm-256color",
  };
}

export function resolveCwd(inputCwd, fallbackCwd) {
  const nextCwd = path.resolve(inputCwd || fallbackCwd);
  const stats = statSync(nextCwd, { throwIfNoEntry: false });

  if (!stats || !stats.isDirectory()) {
    throw new Error(`Working directory does not exist: ${nextCwd}`);
  }

  return nextCwd;
}

function buildPersistedExitMessage(message) {
  return `\r\n\u001b[1;31m[remote-vibes]\u001b[0m ${message}\r\n`;
}

function shellQuote(value) {
  const text = String(value ?? "");

  if (!text) {
    return "''";
  }

  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function buildShellCommand(command, args = []) {
  return [command, ...args].map((part) => shellQuote(part)).join(" ");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSessionPath(targetPath) {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    return null;
  }

  return path.resolve(targetPath);
}

function matchOpenCodeSessionsByCwd(sessions, cwd) {
  const normalizedCwd = normalizeSessionPath(cwd);

  return sessions
    .filter((entry) => normalizeSessionPath(entry?.directory) === normalizedCwd)
    .sort((left, right) => Number(right?.updated || 0) - Number(left?.updated || 0));
}

function pickTrackedOpenCodeSession(sessions, baselineSessionIds, launchedAt) {
  const freshSession = sessions.find((entry) => !baselineSessionIds.has(entry.id));

  if (freshSession) {
    return freshSession;
  }

  return (
    sessions.find((entry) => Number(entry?.updated || 0) >= launchedAt - OPENCODE_SESSION_LOOKBACK_MS)
    ?? null
  );
}

async function listOpenCodeSessions(command, cwd, env = process.env) {
  if (!command) {
    return [];
  }

  try {
    const { stdout } = await execFileAsync(
      command,
      ["session", "list", "--format", "json", "-n", String(OPENCODE_SESSION_LIST_LIMIT)],
      {
        cwd,
        env,
        maxBuffer: 1024 * 1024,
      },
    );
    const payload = JSON.parse(stdout);

    return Array.isArray(payload) ? payload.filter((entry) => typeof entry?.id === "string") : [];
  } catch {
    return [];
  }
}

export class SessionManager {
  constructor({
    cwd,
    providers,
    persistSessions = true,
    stateDir = path.join(cwd, ".remote-vibes"),
  }) {
    this.cwd = cwd;
    this.providers = providers;
    this.persistSessions = persistSessions;
    this.sessionStore = new SessionStore({
      enabled: persistSessions,
      stateDir,
    });
    this.sessions = new Map();
    this.persistTimer = null;
    this.persistPromise = Promise.resolve();
    this.isShuttingDown = false;
  }

  async initialize() {
    const persistedSessions = await this.sessionStore.load();

    for (const snapshot of persistedSessions) {
      this.restoreSession(snapshot);
    }

    await this.flushPersistedSessions();
  }

  listSessions() {
    return Array.from(this.sessions.values())
      .map((session) => this.serializeSession(session))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) ?? null;
  }

  createSession({ providerId, name, cwd }) {
    const provider = this.getProvider(providerId);

    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    if (!provider.available) {
      throw new Error(`${provider.label} is not installed on this host.`);
    }

    const createdAt = new Date().toISOString();
    const session = this.buildSessionRecord({
      cwd: resolveCwd(cwd, this.cwd),
      name: name?.trim() || this.makeDefaultName(provider),
      providerId: provider.id,
      providerLabel: provider.label,
      createdAt,
      updatedAt: createdAt,
      restoreOnStartup: true,
    });

    this.sessions.set(session.id, session);

    try {
      this.startSession(session, provider);
    } catch (error) {
      this.sessions.delete(session.id);
      this.schedulePersist({ immediate: true });
      throw error;
    }

    this.schedulePersist({ immediate: true });
    return this.serializeSession(session);
  }

  renameSession(sessionId, name) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    const nextName = String(name ?? "").trim();
    if (!nextName) {
      throw new Error("Session name cannot be empty.");
    }

    if (nextName === session.name) {
      return this.serializeSession(session);
    }

    session.name = nextName;
    session.updatedAt = new Date().toISOString();
    this.scheduleSessionMetaBroadcast(session, { immediate: true });
    this.schedulePersist({ immediate: true });
    return this.serializeSession(session);
  }

  forkSession(sessionId) {
    const sourceSession = this.sessions.get(sessionId);

    if (!sourceSession) {
      return null;
    }

    const provider = this.getProvider(sourceSession.providerId);

    if (!provider) {
      throw new Error(`${sourceSession.providerLabel} is no longer configured on this host.`);
    }

    if (!provider.available) {
      throw new Error(`${provider.label} is not installed on this host.`);
    }

    const createdAt = new Date().toISOString();
    const forkSession = this.buildSessionRecord({
      cwd: sourceSession.cwd,
      name: this.makeForkName(sourceSession.name),
      providerId: sourceSession.providerId,
      providerLabel: sourceSession.providerLabel,
      createdAt,
      updatedAt: createdAt,
      cols: sourceSession.cols,
      rows: sourceSession.rows,
      restoreOnStartup: true,
      buffer: [
        `\u001b[1;36m[remote-vibes]\u001b[0m forked from: ${sourceSession.name}`,
        `\u001b[1;36m[remote-vibes]\u001b[0m this is a fresh sibling session in the same cwd`,
        "",
      ].join("\r\n"),
    });

    this.sessions.set(forkSession.id, forkSession);

    try {
      this.startSession(forkSession, provider);
    } catch (error) {
      this.sessions.delete(forkSession.id);
      this.schedulePersist({ immediate: true });
      throw error;
    }

    this.schedulePersist({ immediate: true });
    return this.serializeSession(forkSession);
  }

  deleteSession(sessionId) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    for (const client of session.clients) {
      client.send(JSON.stringify({ type: "session-deleted", sessionId }));
      client.close();
    }

    session.skipExitHandling = true;
    session.restoreOnStartup = false;
    this.clearPendingMetaBroadcast(session);
    session.clients.clear();

    if (session.status !== "exited" && session.pty) {
      session.pty.kill();
    }

    this.sessions.delete(sessionId);
    this.schedulePersist({ immediate: true });
    return true;
  }

  attachClient(sessionId, socket) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      socket.send(JSON.stringify({ type: "error", message: "Session not found." }));
      socket.close();
      return null;
    }

    session.clients.add(socket);
    socket.send(
      JSON.stringify({
        type: "snapshot",
        session: this.serializeSession(session),
        data: session.buffer,
      }),
    );

    socket.on("close", () => {
      session.clients.delete(socket);
    });

    return session;
  }

  write(sessionId, input) {
    const session = this.sessions.get(sessionId);

    if (!session || session.status === "exited" || !session.pty) {
      return false;
    }

    session.pty.write(input);
    session.updatedAt = new Date().toISOString();
    this.schedulePersist();
    return true;
  }

  resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);

    if (!session || session.status === "exited" || !session.pty) {
      return false;
    }

    session.cols = Math.max(20, cols);
    session.rows = Math.max(5, rows);
    session.pty.resize(session.cols, session.rows);
    session.updatedAt = new Date().toISOString();
    this.schedulePersist();
    return true;
  }

  closeAll() {
    for (const sessionId of Array.from(this.sessions.keys())) {
      this.deleteSession(sessionId);
    }
  }

  async shutdown({ preserveSessions = this.persistSessions } = {}) {
    this.isShuttingDown = true;

    for (const session of this.sessions.values()) {
      this.clearPendingMetaBroadcast(session);

      for (const client of session.clients) {
        client.close();
      }

      session.clients.clear();

      if (preserveSessions) {
        session.restoreOnStartup = session.status !== "exited";
        session.skipExitHandling = true;
      }
    }

    if (preserveSessions) {
      await this.flushPersistedSessions();

      for (const session of this.sessions.values()) {
        if (session.status !== "exited" && session.pty) {
          session.pty.kill();
        }

        session.pty = null;
      }

      return;
    }

    this.closeAll();
    await this.flushPersistedSessions();
  }

  makeDefaultName(provider) {
    const existingCount = Array.from(this.sessions.values()).filter(
      (session) => session.providerId === provider.id,
    ).length;

    return `${provider.defaultName} ${existingCount + 1}`;
  }

  makeForkName(baseName) {
    const rootName = `${baseName} fork`;
    let suffix = 1;
    let nextName = rootName;

    const existingNames = new Set(Array.from(this.sessions.values()).map((session) => session.name));

    while (existingNames.has(nextName)) {
      suffix += 1;
      nextName = `${rootName} ${suffix}`;
    }

    return nextName;
  }

  pushOutput(session, chunk) {
    session.buffer = trimBuffer(`${session.buffer}${chunk}`);

    for (const client of session.clients) {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: "output", data: chunk }));
      }
    }

    this.schedulePersist();
  }

  clearPendingMetaBroadcast(session) {
    if (!session.metaBroadcastTimer) {
      return;
    }

    clearTimeout(session.metaBroadcastTimer);
    session.metaBroadcastTimer = null;
  }

  scheduleSessionMetaBroadcast(session, { immediate = false } = {}) {
    if (immediate) {
      this.clearPendingMetaBroadcast(session);
      this.broadcastSessionMeta(session);
      return;
    }

    if (session.metaBroadcastTimer) {
      return;
    }

    session.metaBroadcastTimer = setTimeout(() => {
      session.metaBroadcastTimer = null;
      this.broadcastSessionMeta(session);
    }, SESSION_META_THROTTLE_MS);
  }

  broadcastSessionMeta(session) {
    const payload = JSON.stringify({
      type: "session",
      session: this.serializeSession(session),
    });

    for (const client of session.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  serializeSession(session) {
    return {
      id: session.id,
      providerId: session.providerId,
      providerLabel: session.providerLabel,
      name: session.name,
      cwd: session.cwd,
      shell: session.shell,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastOutputAt: session.lastOutputAt,
      status: session.status,
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      cols: session.cols,
      rows: session.rows,
      host: os.hostname(),
    };
  }

  buildSessionRecord({
    id = randomUUID(),
    providerId,
    providerLabel,
    name,
    shell = process.env.SHELL || "/bin/zsh",
    cwd,
    createdAt = new Date().toISOString(),
    updatedAt = createdAt,
    lastOutputAt = null,
    status = "starting",
    exitCode = null,
    exitSignal = null,
    cols = 120,
    rows = 34,
    buffer = "",
    restoreOnStartup = false,
    providerState = null,
  }) {
    return {
      id,
      providerId,
      providerLabel,
      name,
      shell,
      cwd,
      createdAt,
      updatedAt,
      lastOutputAt,
      status,
      exitCode,
      exitSignal,
      cols,
      rows,
      pty: null,
      buffer: trimBuffer(buffer || ""),
      clients: new Set(),
      metaBroadcastTimer: null,
      restoreOnStartup,
      providerState:
        providerState && typeof providerState === "object" ? { ...providerState } : null,
      skipExitHandling: false,
    };
  }

  updateProviderState(session, nextProviderState) {
    const normalizedState =
      nextProviderState && typeof nextProviderState === "object"
        ? { ...(session.providerState || {}), ...nextProviderState }
        : null;

    const currentStateJson = JSON.stringify(session.providerState || null);
    const nextStateJson = JSON.stringify(normalizedState || null);

    if (currentStateJson === nextStateJson) {
      return;
    }

    session.providerState = normalizedState;
    session.updatedAt = new Date().toISOString();
    this.schedulePersist({ immediate: true });
  }

  async prepareProviderLaunch(session, provider, { restored = false } = {}) {
    if (!provider.launchCommand) {
      return {
        commandString: null,
        afterLaunch: null,
      };
    }

    if (provider.id !== "opencode") {
      return {
        commandString: buildShellCommand(provider.launchCommand),
        afterLaunch: null,
      };
    }

    const knownSessions = matchOpenCodeSessionsByCwd(
      await listOpenCodeSessions(provider.launchCommand, session.cwd, buildSessionEnv(session.id, provider.id, this.providers)),
      session.cwd,
    );

    if (restored) {
      const restoreSessionId = session.providerState?.sessionId || knownSessions[0]?.id || null;

      if (restoreSessionId) {
        this.updateProviderState(session, { sessionId: restoreSessionId });
        return {
          commandString: buildShellCommand(provider.launchCommand, ["--session", restoreSessionId]),
          afterLaunch: null,
        };
      }
    }

    const baselineSessionIds = new Set(knownSessions.map((entry) => entry.id));

    return {
      commandString: buildShellCommand(provider.launchCommand),
      afterLaunch: async (ptyProcess, launchedAt) => {
        await this.captureOpenCodeSessionId(session, provider, ptyProcess, baselineSessionIds, launchedAt);
      },
    };
  }

  async launchProvider(session, provider, ptyProcess, launchContextPromise) {
    let launchContext = null;

    try {
      launchContext = await launchContextPromise;
    } catch {
      launchContext = null;
    }

    if (session.status !== "running" || session.pty !== ptyProcess) {
      return;
    }

    const commandString = launchContext?.commandString || buildShellCommand(provider.launchCommand);

    if (!commandString) {
      return;
    }

    const launchedAt = Date.now();
    ptyProcess.write(`${commandString}\r`);

    if (typeof launchContext?.afterLaunch === "function") {
      void launchContext.afterLaunch(ptyProcess, launchedAt);
    }
  }

  async captureOpenCodeSessionId(session, provider, ptyProcess, baselineSessionIds, launchedAt) {
    for (let attempt = 0; attempt < OPENCODE_SESSION_CAPTURE_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await delay(OPENCODE_SESSION_CAPTURE_INTERVAL_MS);
      }

      if (session.status !== "running" || session.pty !== ptyProcess) {
        return;
      }

      const matchingSessions = matchOpenCodeSessionsByCwd(
        await listOpenCodeSessions(provider.launchCommand, session.cwd, buildSessionEnv(session.id, provider.id, this.providers)),
        session.cwd,
      );
      const candidate = pickTrackedOpenCodeSession(matchingSessions, baselineSessionIds, launchedAt);

      if (!candidate?.id) {
        continue;
      }

      this.updateProviderState(session, { sessionId: candidate.id });
      return;
    }
  }

  startSession(session, provider, { restored = false } = {}) {
    const sessionCwd = resolveCwd(session.cwd, this.cwd);
    session.cwd = sessionCwd;

    const ptyProcess = pty.spawn(session.shell, getShellArgs(session.shell), {
      cwd: sessionCwd,
      env: buildSessionEnv(session.id, provider.id, this.providers),
      name: "xterm-256color",
      cols: session.cols,
      rows: session.rows,
    });

    session.pty = ptyProcess;
    session.status = "running";
    session.exitCode = null;
    session.exitSignal = null;
    session.restoreOnStartup = true;
    session.updatedAt = new Date().toISOString();
    const launchContextPromise = this.prepareProviderLaunch(session, provider, { restored });

    const bannerLines = restored
      ? [
          "",
          `\u001b[1;36m[remote-vibes]\u001b[0m session restored after restart`,
          `\u001b[1;36m[remote-vibes]\u001b[0m cwd: ${sessionCwd}`,
          provider.launchCommand
            ? `\u001b[1;36m[remote-vibes]\u001b[0m relaunching: ${provider.launchCommand}`
            : `\u001b[1;36m[remote-vibes]\u001b[0m vanilla shell restored`,
          "",
        ]
      : [
          `\u001b[1;36m[remote-vibes]\u001b[0m ${provider.label} session ready`,
          `\u001b[1;36m[remote-vibes]\u001b[0m cwd: ${sessionCwd}`,
          "\u001b[1;36m[remote-vibes]\u001b[0m localhost browser helper: rv-browser screenshot 4173",
          "\u001b[1;36m[remote-vibes]\u001b[0m simple click/type flow: rv-browser run 4173 --steps-file eval-steps.json --output final.png",
          "\u001b[1;36m[remote-vibes]\u001b[0m recommended run actions: type, click, select, wait, screenshot",
          '\u001b[1;36m[remote-vibes]\u001b[0m qualitative UI feedback: rv-browser describe 4173 --prompt "What visual issues stand out in the rendered UI?"',
          '\u001b[1;36m[remote-vibes]\u001b[0m image and chart feedback: rv-browser describe-file results/chart.png --prompt "What does this output show and what should improve?"',
          provider.launchCommand
            ? `\u001b[1;36m[remote-vibes]\u001b[0m launching: ${provider.launchCommand}`
            : `\u001b[1;36m[remote-vibes]\u001b[0m vanilla shell active`,
          "",
        ];

    this.pushOutput(session, bannerLines.join("\r\n"));

    ptyProcess.onData((chunk) => {
      session.updatedAt = new Date().toISOString();
      session.lastOutputAt = session.updatedAt;
      this.pushOutput(session, chunk);
      this.scheduleSessionMetaBroadcast(session);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      session.pty = null;

      if (session.skipExitHandling) {
        return;
      }

      session.status = "exited";
      session.exitCode = exitCode;
      session.exitSignal = signal ?? null;
      session.restoreOnStartup = false;
      session.updatedAt = new Date().toISOString();

      this.pushOutput(
        session,
        `\r\n\u001b[1;31m[remote-vibes]\u001b[0m session exited (code ${exitCode}${signal ? `, signal ${signal}` : ""})\r\n`,
      );
      this.scheduleSessionMetaBroadcast(session, { immediate: true });
      this.schedulePersist({ immediate: true });
    });

    if (provider.launchCommand) {
      setTimeout(() => {
        if (session.status === "running" && session.pty === ptyProcess) {
          void this.launchProvider(session, provider, ptyProcess, launchContextPromise);
        }
      }, STARTUP_DELAY_MS);
    }
  }

  restoreSession(snapshot) {
    const session = this.buildSessionRecord({
      id: snapshot.id || randomUUID(),
      providerId: snapshot.providerId,
      providerLabel: snapshot.providerLabel || snapshot.providerId || "Unknown Provider",
      name: snapshot.name?.trim() || snapshot.providerLabel || "Restored Session",
      shell: snapshot.shell || process.env.SHELL || "/bin/zsh",
      cwd: snapshot.cwd || this.cwd,
      createdAt: snapshot.createdAt || new Date().toISOString(),
      updatedAt: snapshot.updatedAt || snapshot.createdAt || new Date().toISOString(),
      lastOutputAt: snapshot.lastOutputAt || null,
      status: snapshot.status || "exited",
      exitCode: snapshot.exitCode ?? null,
      exitSignal: snapshot.exitSignal ?? null,
      cols: Number(snapshot.cols) > 0 ? Number(snapshot.cols) : 120,
      rows: Number(snapshot.rows) > 0 ? Number(snapshot.rows) : 34,
      buffer: snapshot.buffer || "",
      restoreOnStartup: Boolean(snapshot.restoreOnStartup),
      providerState: snapshot.providerState || null,
    });

    this.sessions.set(session.id, session);

    if (!session.restoreOnStartup) {
      return;
    }

    const provider = this.getProvider(session.providerId);
    if (!provider) {
      this.markSessionRestoreFailure(
        session,
        `${session.providerLabel} is no longer configured on this host.`,
      );
      return;
    }

    if (!provider.available) {
      this.markSessionRestoreFailure(
        session,
        `${provider.label} is not available on this host, so this session could not be relaunched.`,
      );
      return;
    }

    try {
      this.startSession(session, provider, { restored: true });
    } catch (error) {
      this.markSessionRestoreFailure(
        session,
        `could not restore the session: ${error.message}`,
      );
    }
  }

  markSessionRestoreFailure(session, message) {
    session.status = "exited";
    session.exitCode = null;
    session.exitSignal = null;
    session.restoreOnStartup = false;
    session.updatedAt = new Date().toISOString();
    session.pty = null;
    this.pushOutput(session, buildPersistedExitMessage(message));
  }

  getProvider(providerId) {
    return this.providers.find((entry) => entry.id === providerId) ?? null;
  }

  serializePersistedSession(session) {
    return {
      ...this.serializeSession(session),
      buffer: session.buffer,
      providerState: session.providerState,
      restoreOnStartup: session.restoreOnStartup,
    };
  }

  schedulePersist({ immediate = false } = {}) {
    if (!this.persistSessions) {
      return;
    }

    if (immediate) {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }

      void this.persistNow();
      return;
    }

    if (this.persistTimer) {
      return;
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, SESSION_PERSIST_THROTTLE_MS);
  }

  async persistNow() {
    if (!this.persistSessions) {
      return;
    }

    const sessions = Array.from(this.sessions.values())
      .map((session) => this.serializePersistedSession(session))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    this.persistPromise = this.persistPromise
      .catch(() => {})
      .then(() => this.sessionStore.save(sessions))
      .catch((error) => {
        console.warn("[remote-vibes] failed to persist sessions", error);
      });

    await this.persistPromise;
  }

  async flushPersistedSessions() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    await this.persistNow();
  }
}
