import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  customAppLauncherDefinitionsFromEnv,
  detectAppLaunchers,
  getAppLauncherDefinitions,
  launchAppLauncher,
} from "../src/app-launchers.js";

test("custom app launcher definitions can be injected from env JSON", () => {
  const env = {
    SWARMLAB_APP_LAUNCHERS_JSON: JSON.stringify([
      {
        id: "my-tool",
        label: "My Tool",
        category: "research",
        priority: 77,
        description: "Open the custom research tool.",
        macPaths: ["/Applications/My Tool.app"],
      },
    ]),
  };

  const custom = customAppLauncherDefinitionsFromEnv(env);
  assert.equal(custom.length, 1);
  assert.equal(custom[0].id, "my-tool");
  assert.equal(custom[0].category, "research");
  assert.equal(custom[0].priority, 77);

  const definitions = getAppLauncherDefinitions(env, [{ id: "cursor", label: "Cursor" }]);
  assert.deepEqual(definitions.map((definition) => definition.id), ["cursor", "my-tool"]);
});

test("detectAppLaunchers discovers mac apps and sorts by priority", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-launchers-"));
  try {
    const lowPath = path.join(tempDir, "Low.app");
    const highPath = path.join(tempDir, "High.app");
    await mkdir(lowPath);
    await mkdir(highPath);

    const launchers = await detectAppLaunchers([
      { id: "low", label: "Low", macPaths: [lowPath], priority: 1, category: "app" },
      { id: "high", label: "High", macPaths: [highPath], priority: 20, category: "research" },
      { id: "missing", label: "Missing", macPaths: [path.join(tempDir, "Missing.app")], priority: 99 },
    ], { HOME: tempDir }, "darwin");

    assert.deepEqual(launchers.map((launcher) => launcher.id), ["high", "low", "missing"]);
    assert.equal(launchers[0].available, true);
    assert.equal(launchers[0].category, "research");
    assert.equal(launchers[0].launchMode, "mac-app-path");
    assert.equal(launchers[0].appPath, highPath);
    assert.equal(launchers[2].available, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("launchAppLauncher opens mac app paths through an injectable executor", async () => {
  const calls = [];
  const result = await launchAppLauncher("cursor", [
    {
      id: "cursor",
      label: "Cursor",
      category: "editor",
      priority: 90,
      description: "Open Cursor.",
      available: true,
      launchMode: "mac-app-path",
      appPath: "/Applications/Cursor.app",
      platform: "darwin",
    },
  ], {
    execFileImpl: async (...args) => {
      calls.push(args);
    },
  });

  assert.deepEqual(calls, [["open", ["/Applications/Cursor.app"], { timeout: 10_000 }]]);
  assert.equal(result.launched, true);
  assert.equal(result.launcher.category, "editor");
  assert.equal(result.launcher.priority, 90);
  assert.equal(result.launcher.description, "Open Cursor.");
});

test("launchAppLauncher starts command launchers detached without shell execution", async () => {
  const spawned = [];
  await launchAppLauncher("chrome", [
    {
      id: "chrome",
      label: "Chrome",
      available: true,
      launchMode: "command",
      command: "/usr/bin/google-chrome",
    },
  ], {
    spawnImpl: (...args) => {
      spawned.push(args);
      return { unref: () => spawned.push(["unref"]) };
    },
  });

  assert.equal(spawned[0][0], "/usr/bin/google-chrome");
  assert.deepEqual(spawned[0][1], []);
  assert.equal(spawned[0][2].detached, true);
  assert.deepEqual(spawned[1], ["unref"]);
});
