import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AppInstanceStore } from "../src/node/app-instance-store.js";

async function makeStore(now) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-app-instances-"));
  const store = new AppInstanceStore({ stateDir, now });
  await store.initialize();
  return { stateDir, store };
}

test("AppInstanceStore records launches and reloads them from disk", async () => {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 4, 13, 10, 0, tick += 1));
  const { stateDir, store } = await makeStore(now);
  try {
    const instance = await store.recordLaunch({
      launcherId: "cursor",
      launcher: { id: "cursor", label: "Cursor", kind: "desktop-app", category: "editor" },
      result: { launched: true, url: "https://example.test/open" },
      clientCommandId: "cmd_1",
      source: "account",
    });

    assert.equal(instance.appId, "cursor");
    assert.equal(instance.label, "Cursor");
    assert.equal(instance.source, "account");
    assert.equal(instance.clientCommandId, "cmd_1");
    assert.equal(instance.url, "https://example.test/open");
    assert.equal(instance.launchCount, 1);

    await store.recordLaunch({
      launcherId: "cursor",
      launcher: { id: "cursor", label: "Cursor", kind: "desktop-app", category: "editor" },
      result: { launched: true },
      clientCommandId: "cmd_1",
      source: "account",
    });

    const reloaded = new AppInstanceStore({ stateDir, now });
    await reloaded.initialize();
    const [saved] = reloaded.listInstances();
    assert.equal(saved.id, instance.id);
    assert.equal(saved.launchCount, 2);
    assert.equal(reloaded.listInstances().length, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("AppInstanceStore compacts repeat desktop app launches by app and source", async () => {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 4, 13, 10, 2, tick += 1));
  const { stateDir, store } = await makeStore(now);
  try {
    const first = await store.recordLaunch({
      launcherId: "cursor",
      launcher: { id: "cursor", label: "Cursor", kind: "desktop-app", category: "editor" },
      result: { launched: true },
      clientCommandId: "cmd_1",
      source: "local",
    });
    const second = await store.recordLaunch({
      launcherId: "cursor",
      launcher: { id: "cursor", label: "Cursor", kind: "desktop-app", category: "editor" },
      result: { launched: true },
      clientCommandId: "cmd_2",
      source: "local",
    });

    assert.equal(second.id, first.id);
    assert.equal(second.clientCommandId, "cmd_2");
    assert.equal(second.launchCount, 2);
    assert.equal(store.listInstances().length, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("AppInstanceStore dismisses app instances without deleting their record", async () => {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 4, 13, 10, 3, tick += 1));
  const { stateDir, store } = await makeStore(now);
  try {
    const instance = await store.recordLaunch({
      launcherId: "cursor",
      launcher: { id: "cursor", label: "Cursor", kind: "desktop-app", category: "editor" },
      result: { launched: true },
      clientCommandId: "cmd_1",
      source: "local",
    });

    const dismissed = await store.dismissInstance(instance.id);
    assert.equal(dismissed.id, instance.id);
    assert.equal(dismissed.status, "dismissed");
    assert.ok(dismissed.dismissedAt);
    assert.equal(store.listInstances().length, 0);

    const [hidden] = store.listInstances({ includeDismissed: true });
    assert.equal(hidden.id, instance.id);
    assert.equal(hidden.status, "dismissed");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("AppInstanceStore keeps distinct URL-backed app instances separate", async () => {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 4, 13, 10, 4, tick += 1));
  const { stateDir, store } = await makeStore(now);
  try {
    await store.recordLaunch({
      launcherId: "browser",
      launcher: { id: "browser", label: "Browser", kind: "desktop-app", category: "browser" },
      result: { launched: true, url: "https://example.test/one" },
      clientCommandId: "cmd_1",
      source: "local",
    });
    await store.recordLaunch({
      launcherId: "browser",
      launcher: { id: "browser", label: "Browser", kind: "desktop-app", category: "browser" },
      result: { launched: true, url: "https://example.test/two" },
      clientCommandId: "cmd_2",
      source: "local",
    });

    const saved = store.listInstances();
    assert.equal(saved.length, 2);
    assert.deepEqual(saved.map((entry) => entry.url).sort(), ["https://example.test/one", "https://example.test/two"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
