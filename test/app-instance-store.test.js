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
