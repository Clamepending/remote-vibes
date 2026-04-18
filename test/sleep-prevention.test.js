import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { SleepPreventionService } from "../src/sleep-prevention.js";

class FakeChild extends EventEmitter {
  constructor(pid = 1234) {
    super();
    this.killed = false;
    this.pid = pid;
  }

  kill() {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
  }
}

test("sleep prevention starts caffeinate on macOS and stops it when disabled", () => {
  const calls = [];
  const child = new FakeChild();
  const service = new SleepPreventionService({
    enabled: true,
    platform: "darwin",
    spawnProcess: (command, args, options) => {
      calls.push({ args, command, options });
      return child;
    },
  });

  const started = service.start();
  assert.equal(started.active, true);
  assert.equal(started.lastStatus, "active");
  assert.equal(started.pid, child.pid);
  assert.deepEqual(calls, [
    {
      args: ["-dimsu"],
      command: "caffeinate",
      options: { stdio: "ignore" },
    },
  ]);

  const stopped = service.setConfig({ enabled: false });
  assert.equal(child.killed, true);
  assert.equal(stopped.active, false);
  assert.equal(stopped.lastStatus, "disabled");
});

test("sleep prevention reports unsupported platforms without spawning", () => {
  const service = new SleepPreventionService({
    enabled: true,
    platform: "linux",
    spawnProcess: () => {
      throw new Error("should not spawn");
    },
  });

  const status = service.start();
  assert.equal(status.active, false);
  assert.equal(status.enabled, true);
  assert.equal(status.lastStatus, "unsupported");
  assert.equal(status.supported, false);
});
