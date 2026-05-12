import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FleetRegistryStore, normalizeFleetNodeUrl } from "../src/node/fleet-registry.js";

test("normalizeFleetNodeUrl keeps only safe http(s) origins", () => {
  assert.equal(normalizeFleetNodeUrl("cthulhu1.tailnet.test/path?token=secret"), "https://cthulhu1.tailnet.test");
  assert.equal(normalizeFleetNodeUrl("http://127.0.0.1:4826/canvas"), "http://127.0.0.1:4826");
  assert.equal(normalizeFleetNodeUrl("file:///Users/mark/private"), "");
  assert.equal(normalizeFleetNodeUrl("ssh://host"), "");
});

test("FleetRegistryStore persists and dedupes normalized nodes", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-fleet-registry-"));
  try {
    const first = new FleetRegistryStore({ stateDir });
    await first.initialize();
    const added = await first.addNode({
      url: "https://gpu-node.example.test/private?token=secret",
      label: "GPU node",
    });
    assert.equal(added.url, "https://gpu-node.example.test");
    assert.equal(first.listNodes().length, 1);

    await first.addNode({ url: "https://gpu-node.example.test/other?token=second" });
    assert.equal(first.listNodes().length, 1);

    const onDisk = JSON.parse(await readFile(path.join(stateDir, "fleet-registry.json"), "utf8"));
    assert.equal(onDisk.nodes.length, 1);
    assert.equal(onDisk.nodes[0].baseUrl, "https://gpu-node.example.test");
    assert.doesNotMatch(JSON.stringify(onDisk), /secret|second|private|other/);

    const second = new FleetRegistryStore({ stateDir });
    await second.initialize();
    assert.equal(second.listNodes().length, 1);
    assert.equal(second.listNodes()[0].addedAt, added.addedAt);
    assert.equal(await second.removeNode(added.id), true);
    assert.equal(second.listNodes().length, 0);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
