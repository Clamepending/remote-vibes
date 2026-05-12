import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeIdentityStore } from "../src/node/identity-store.js";

test("node identity persists stable ids, keypair, and local API token", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-node-id-"));
  try {
    const firstStore = new NodeIdentityStore({ stateDir, hostname: () => "first-host" });
    const first = await firstStore.initialize();
    assert.ok(first.nodeId);
    assert.ok(first.installId);
    assert.ok(first.publicKey.includes("BEGIN PUBLIC KEY"));
    assert.ok(first.privateKey.includes("BEGIN PRIVATE KEY"));
    assert.ok(first.localApiToken.length >= 32);
    assert.equal(firstStore.verifyLocalApiToken(first.localApiToken), true);
    assert.equal(firstStore.verifyLocalApiToken("wrong"), false);

    const secondStore = new NodeIdentityStore({ stateDir, hostname: () => "second-host" });
    const second = await secondStore.initialize();
    assert.equal(second.nodeId, first.nodeId);
    assert.equal(second.installId, first.installId);
    assert.equal(second.publicKey, first.publicKey);
    assert.equal(second.localApiToken, first.localApiToken);

    const onDisk = JSON.parse(await readFile(path.join(stateDir, "node.json"), "utf8"));
    assert.equal(onDisk.nodeId, first.nodeId);
    assert.equal(onDisk.localApiToken, first.localApiToken);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

