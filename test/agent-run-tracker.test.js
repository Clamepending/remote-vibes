import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunTracker, consumePromptInput } from "../src/agent-run-tracker.js";

function createFakeClock(start = 0) {
  let now = start;
  let nextTimerId = 1;
  const timers = new Map();

  function flushReadyTimers() {
    let pending = true;

    while (pending) {
      pending = false;
      const readyTimer = [...timers.entries()]
        .sort((left, right) => left[1].target - right[1].target)
        .find(([, timer]) => timer.target <= now);

      if (!readyTimer) {
        continue;
      }

      pending = true;
      const [timerId, timer] = readyTimer;
      timers.delete(timerId);
      timer.callback();
    }
  }

  return {
    now: () => now,
    setTimeout(callback, delay) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, {
        callback,
        target: now + delay,
      });
      return timerId;
    },
    clearTimeout(timerId) {
      timers.delete(timerId);
    },
    advanceBy(durationMs) {
      now += durationMs;
      flushReadyTimers();
    },
  };
}

test("consumePromptInput strips terminal control input and finds submitted prompts", () => {
  const parsed = consumePromptInput("hello", " world\u001b[A\u007f!\r");

  assert.equal(parsed.pendingPrompt, "");
  assert.deepEqual(parsed.prompts, ["hello worl!"]);
  assert.equal(parsed.interrupted, false);
});

test("agent run tracker records quiet runs and multiple runs within one session", async () => {
  const recordedRuns = [];
  const clock = createFakeClock();
  const tracker = new AgentRunTracker({
    store: {
      async recordRun(run) {
        recordedRuns.push(run);
        return true;
      },
    },
    idleTimeoutMs: 5_000,
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });
  const session = {
    id: "session-1",
    name: "codex trainer",
    providerId: "codex",
    providerLabel: "Codex",
  };

  await tracker.handleInput(session, "write tests\r");
  clock.advanceBy(1_000);
  tracker.handleOutput(session);
  clock.advanceBy(3_000);
  tracker.handleOutput(session);
  clock.advanceBy(5_000);

  assert.equal(recordedRuns.length, 1);
  assert.equal(recordedRuns[0].durationMs, 4_000);
  assert.equal(recordedRuns[0].completionReason, "idle");

  clock.advanceBy(1_000);
  await tracker.handleInput(session, "continue\r");
  clock.advanceBy(1_500);
  tracker.handleOutput(session);
  await tracker.handleInput(session, "one more thing\r");
  clock.advanceBy(2_000);
  tracker.handleOutput(session);
  await tracker.handleSessionExit(session);

  assert.equal(recordedRuns.length, 3);
  assert.equal(recordedRuns[1].completionReason, "user-follow-up");
  assert.equal(recordedRuns[1].durationMs, 1_500);
  assert.equal(recordedRuns[2].completionReason, "session-exit");
  assert.equal(recordedRuns[2].durationMs, 2_000);
});

test("agent run tracker ignores shell sessions and interrupted runs with no output", async () => {
  const recordedRuns = [];
  const clock = createFakeClock();
  const tracker = new AgentRunTracker({
    store: {
      async recordRun(run) {
        recordedRuns.push(run);
        return true;
      },
    },
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  await tracker.handleInput({ id: "shell-1", providerId: "shell", providerLabel: "Shell", name: "shell" }, "ls\r");
  await tracker.handleInput({ id: "agent-1", providerId: "claude", providerLabel: "Claude", name: "claude" }, "draft\r");
  await tracker.handleInput({ id: "agent-1", providerId: "claude", providerLabel: "Claude", name: "claude" }, "\u0003");

  assert.deepEqual(recordedRuns, []);
});
