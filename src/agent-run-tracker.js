const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const MAX_PENDING_PROMPT_LENGTH = 4_000;

function isTrackableSession(session) {
  return Boolean(session?.id && session?.providerId && session.providerId !== "shell");
}

function stripTerminalInputSequences(input) {
  return String(input ?? "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001bO./g, "");
}

function consumePromptInput(previousBuffer, input) {
  const prompts = [];
  let buffer = previousBuffer;
  let interrupted = false;

  for (const character of stripTerminalInputSequences(input)) {
    if (character === "\u0003") {
      interrupted = true;
      buffer = "";
      continue;
    }

    if (character === "\u0015") {
      buffer = "";
      continue;
    }

    if (character === "\u007f" || character === "\b") {
      buffer = buffer.slice(0, -1);
      continue;
    }

    if (character === "\r" || character === "\n") {
      prompts.push(buffer.trim());
      buffer = "";
      continue;
    }

    if (character === "\t") {
      buffer = `${buffer} `;
      continue;
    }

    if (character < " ") {
      continue;
    }

    buffer = `${buffer}${character}`.slice(-MAX_PENDING_PROMPT_LENGTH);
  }

  return {
    interrupted,
    pendingPrompt: buffer,
    prompts: prompts.filter(Boolean),
  };
}

export class AgentRunTracker {
  constructor({
    store,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    this.store = store;
    this.idleTimeoutMs = idleTimeoutMs;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.sessionState = new Map();
  }

  getSessionState(sessionId) {
    let state = this.sessionState.get(sessionId);

    if (!state) {
      state = {
        pendingPrompt: "",
        activeRun: null,
        idleTimer: null,
      };
      this.sessionState.set(sessionId, state);
    }

    return state;
  }

  clearIdleTimer(state) {
    if (!state?.idleTimer) {
      return;
    }

    this.clearTimeoutFn(state.idleTimer);
    state.idleTimer = null;
  }

  async finishRun(session, state, completionReason, endedAt = this.now()) {
    const activeRun = state?.activeRun;
    if (!activeRun) {
      return false;
    }

    this.clearIdleTimer(state);
    state.activeRun = null;

    if (!Number.isFinite(activeRun.lastOutputAt)) {
      return false;
    }

    const finalEndedAt = Math.max(activeRun.startedAt, Number(endedAt) || activeRun.lastOutputAt);
    return this.store.recordRun({
      sessionId: session.id,
      sessionName: session.name,
      providerId: session.providerId,
      providerLabel: session.providerLabel,
      startedAt: activeRun.startedAt,
      endedAt: finalEndedAt,
      durationMs: Math.max(0, finalEndedAt - activeRun.startedAt),
      completionReason,
    });
  }

  startRun(session, state) {
    state.activeRun = {
      startedAt: this.now(),
      lastOutputAt: null,
    };
    this.clearIdleTimer(state);
  }

  async handleInput(session, input) {
    if (!isTrackableSession(session)) {
      return;
    }

    const state = this.getSessionState(session.id);
    const parsed = consumePromptInput(state.pendingPrompt, input);
    state.pendingPrompt = parsed.pendingPrompt;

    if (parsed.interrupted) {
      await this.finishRun(session, state, "user-interrupt");
    }

    for (const _prompt of parsed.prompts) {
      await this.finishRun(session, state, "user-follow-up");
      this.startRun(session, state);
    }
  }

  handleOutput(session) {
    if (!isTrackableSession(session)) {
      return;
    }

    const state = this.getSessionState(session.id);
    if (!state.activeRun) {
      return;
    }

    state.activeRun.lastOutputAt = this.now();
    this.clearIdleTimer(state);
    const trackedRun = state.activeRun;
    state.idleTimer = this.setTimeoutFn(() => {
      if (state.activeRun !== trackedRun || !trackedRun.lastOutputAt) {
        return;
      }

      void this.finishRun(session, state, "idle", trackedRun.lastOutputAt);
    }, this.idleTimeoutMs);
  }

  async handleSessionExit(session) {
    if (!isTrackableSession(session)) {
      return;
    }

    const state = this.getSessionState(session.id);
    await this.finishRun(session, state, "session-exit", state.activeRun?.lastOutputAt || this.now());
    state.pendingPrompt = "";
    this.forgetSession(session.id);
  }

  async handleSessionDelete(session) {
    if (!isTrackableSession(session)) {
      return;
    }

    const state = this.getSessionState(session.id);
    await this.finishRun(session, state, "session-deleted", state.activeRun?.lastOutputAt || this.now());
    state.pendingPrompt = "";
    this.forgetSession(session.id);
  }

  forgetSession(sessionId) {
    const state = this.sessionState.get(sessionId);
    if (!state) {
      return;
    }

    this.clearIdleTimer(state);
    this.sessionState.delete(sessionId);
  }

  reset() {
    for (const state of this.sessionState.values()) {
      this.clearIdleTimer(state);
    }

    this.sessionState.clear();
  }
}

export {
  consumePromptInput,
  stripTerminalInputSequences,
};
