import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HandoffJobStore, buildHandoffLaunchPrompt } from "../src/node/handoff-job-store.js";

test("HandoffJobStore persists normalized SSH and URL handoff jobs", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-handoff-jobs-"));
  try {
    const store = new HandoffJobStore({ stateDir });
    await store.initialize();
    const job = await store.createJob({
      title: "GPU train to Pi deploy",
      objective: "Train on the GPU cluster, copy the model to the Pi, and run a smoke test.",
      target: {
        label: "Home Pi",
        sshTarget: "pi@home-raspi",
        url: "https://pi.example.test/private?token=secret",
      },
      commands: ["python train.py --epochs 1"],
      artifactPaths: ["runs/latest/model.onnx"],
    }, { sourceNodeId: "mac-node" });

    assert.equal(job.sourceNodeId, "mac-node");
    assert.equal(job.target.baseUrl, "https://pi.example.test");
    assert.equal(job.target.sshTarget, "pi@home-raspi");
    assert.equal(job.steps.some((step) => step.id === "transfer"), true);
    assert.equal(job.status, "planned");

    const onDisk = JSON.parse(await readFile(path.join(stateDir, "handoff-jobs.json"), "utf8"));
    assert.equal(onDisk.jobs.length, 1);
    assert.doesNotMatch(JSON.stringify(onDisk), /token=secret|\/private/);

    const second = new HandoffJobStore({ stateDir });
    await second.initialize();
    assert.equal(second.listJobs().length, 1);

    const launched = await second.markLaunched(job.id, "session-1", "codex");
    assert.equal(launched.status, "launched");
    assert.equal(launched.launchedSessionId, "session-1");
    assert.equal(launched.providerId, "codex");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("buildHandoffLaunchPrompt captures the machine-hop execution contract", async () => {
  const prompt = buildHandoffLaunchPrompt({
    title: "GPU to Pi",
    objective: "Train on cthulhu and validate on the Pi.",
    target: { label: "Pi", sshTarget: "pi@home-raspi" },
    commands: ["python train.py"],
    artifactPaths: ["model.onnx"],
  }, { localNodeName: "Mac" });

  assert.match(prompt, /coordinating a Swarmlab machine handoff from Mac/);
  assert.match(prompt, /SSH target: pi@home-raspi/);
  assert.match(prompt, /Package artifacts with a manifest/);
  assert.match(prompt, /python train\.py/);
  assert.match(prompt, /model\.onnx/);
});
