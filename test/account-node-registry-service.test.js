import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildNodeRegistrationPayload } from "../src/account/account-service.js";
import { buildNodeHeartbeatPayload } from "../src/account/node-heartbeat-service.js";
import { AccountNodeRegistryService } from "../src/account/account-node-registry-service.js";
import { verifyCommandSignature } from "../src/account/node-command-relay-service.js";
import { NodeIdentityStore } from "../src/node/identity-store.js";

function sampleSnapshot(nodeId, installId) {
  return {
    schemaVersion: 1,
    mode: "redacted",
    node: {
      nodeId,
      installId,
      displayName: "GPU Cluster",
      swarmlabVersion: "1.0.19",
      commit: "de29c11",
      branch: "main",
      os: "linux",
      arch: "x64",
      hostnameHash: "hashed-hostname",
    },
    counts: {
      sessions: 4,
      runningSessions: 2,
      browserSessions: 1,
      openActionItems: 1,
      ports: 3,
      canvases: 1,
      projects: 2,
      handoffJobs: 1,
      brainNotes: 327,
    },
    capabilities: {
      providerCount: 5,
      launcherCount: 2,
      buildingCount: 76,
      gpuCount: 6,
      cameraCount: 0,
      handoffCount: 1,
      brainNoteCount: 327,
      hasTailscale: true,
      roles: ["agent-host", "gpu-worker", "brain-host"],
    },
    system: {
      platform: "linux",
      arch: "x64",
      cpuCount: 64,
      gpuCount: 6,
      cameraCount: 0,
      memory: { total: 1000, used: 300, free: 700 },
    },
    sessions: [{
      id: "session_1",
      name: "Training agent",
      providerId: "codex",
      cwd: "/home/ogata/private",
      command: "OPENAI_API_KEY=sk-secret npm run train --token=secret",
      recentNarrative: [{
        id: "entry_1",
        kind: "assistant",
        label: "Saved /home/ogata/private/model.bin",
        text: "Finished with OPENAI_API_KEY=sk-secret in /home/ogata/private/model.bin",
        timestamp: "2026-05-12T20:00:05.000Z",
      }],
    }],
    launchers: [
      { id: "provider:codex", label: "Codex", kind: "agent-provider", providerId: "codex", available: true },
      { id: "app:cursor", label: "Cursor", kind: "desktop-app", category: "editor", priority: 90, description: "Open Cursor.", appId: "cursor", available: true, platform: "linux" },
    ],
    generatedAt: "2026-05-12T20:00:00.000Z",
  };
}

test("AccountNodeRegistryService pairs, registers, heartbeats, lists, and disconnects sanitized machines", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-account-registry-"));
  try {
    const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "node"), hostname: () => "private-hostname" });
    await nodeIdentityStore.initialize();
    const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
    const snapshot = sampleSnapshot(identity.nodeId, identity.installId);

    const service = new AccountNodeRegistryService({
      stateDir: path.join(stateDir, "account"),
      now: () => new Date("2026-05-12T20:01:00.000Z"),
    });
    await service.initialize();
    const pairing = await service.createPairing({
      label: "GPU box",
      redirectUri: "http://127.0.0.1:4826/account/auth/complete",
      identity,
      connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/private?token=secret" }],
    });
    assert.equal(pairing.connectionHints[0].url, "https://gpu.tailnet.test");

    const approval = await service.approvePairing({ pairingId: pairing.id, pairingCode: pairing.pairingCode });
    assert.ok(approval.grant.startsWith("grant_"));

    const completed = await service.completePairing({
      grant: approval.grant,
      identity,
      connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/canvas?token=secret" }],
      label: "GPU box",
    });
    assert.ok(completed.accessToken.startsWith("slnode_"));
    assert.equal(completed.node.baseUrl, "https://gpu.tailnet.test");

    const registration = buildNodeRegistrationPayload({
      identity,
      snapshot,
      connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/private?token=secret" }],
    });
    const registrationUnsigned = { type: "node.registration", registration };
    const registered = await service.registerNode({
      authorization: `Bearer ${completed.accessToken}`,
      body: {
        ...registrationUnsigned,
        signature: nodeIdentityStore.signPayload(registrationUnsigned),
      },
    });
    assert.equal(registered.displayName, "GPU Cluster");
    assert.equal(registered.capabilities.gpuCount, 6);
    assert.equal(registered.capabilities.launcherCount, 2);
    assert.equal(registered.launchers[0].providerId, "codex");
    assert.equal(registered.launchers[1].appId, "cursor");
    assert.equal(registered.launchers[1].category, "editor");
    assert.equal(registered.launchers[1].priority, 90);
    assert.equal(registered.baseUrl, "https://gpu.tailnet.test");

    const heartbeatUnsigned = buildNodeHeartbeatPayload({
      identity,
      snapshot,
      connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/heartbeat?token=secret" }],
    });
    const heartbeat = {
      ...heartbeatUnsigned,
      signature: nodeIdentityStore.signPayload({ type: "node.heartbeat", heartbeat: heartbeatUnsigned }),
    };
    const heartbeaten = await service.recordHeartbeat({
      authorization: `Bearer ${completed.accessToken}`,
      nodeId: identity.nodeId,
      body: { heartbeat },
    });
    assert.equal(heartbeaten.node.status, "busy");
    assert.equal(heartbeaten.node.counts.sessions, 4);
    assert.equal(heartbeaten.node.capabilities.brainNoteCount, 327);
    assert.equal(heartbeaten.node.launchers.length, 2);

    const nodes = service.listNodesForToken(`Bearer ${completed.accessToken}`);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].nodeId, identity.nodeId);
    assert.equal(nodes[0].launchers[1].label, "Cursor");
    assert.equal(nodes[0].summary.sessions[0].recentNarrative[0].text, "Finished with OPENAI_API_KEY=[redacted] in [path]");
    assert.doesNotMatch(JSON.stringify(nodes), /slnode_|grant_|sk-secret|OPENAI_API_KEY=sk-secret|token=secret|\/private|\/canvas|\/home\/ogata/);

    await service.disconnectToken(`Bearer ${completed.accessToken}`);
    assert.equal(service.listNodesForOwner("local")[0].status, "offline");
    assert.throws(() => service.listNodesForToken(`Bearer ${completed.accessToken}`), /invalid/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("AccountNodeRegistryService signs, leases, and acknowledges scoped node commands", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-account-commands-"));
  try {
    const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "node") });
    await nodeIdentityStore.initialize();
    const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
    const service = new AccountNodeRegistryService({
      stateDir: path.join(stateDir, "account"),
      now: () => new Date("2026-05-12T20:01:00.000Z"),
    });
    await service.initialize();

    const pairing = await service.createPairing({ identity, label: "Remote worker" });
    const approval = await service.approvePairing({ pairingId: pairing.id, ownerAccountId: "acct_mark" });
    const completed = await service.completePairing({ grant: approval.grant, identity });
    const registration = buildNodeRegistrationPayload({
      identity,
      snapshot: sampleSnapshot(identity.nodeId, identity.installId),
    });
    await service.registerNode({
      authorization: `Bearer ${completed.accessToken}`,
      body: {
        type: "node.registration",
        registration,
        signature: nodeIdentityStore.signPayload({ type: "node.registration", registration }),
      },
    });

    const queued = await service.enqueueCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      body: {
        operation: "session.input.write",
        clientCommandId: "client-1",
        payload: {
          sessionId: "session-123",
          input: "continue from web",
        },
      },
    });
    assert.equal(queued.status, "queued");
    assert.equal(queued.operation, "session.input.write");
    assert.equal(queued.target.sessionId, "session-123");
    assert.equal(queued.payload, undefined);

    const leased = await service.leaseCommandsForNode({
      authorization: `Bearer ${completed.accessToken}`,
      nodeId: identity.nodeId,
    });
    assert.equal(leased.length, 1);
    assert.equal(leased[0].payload.input, "continue from web");
    assert.ok(leased[0].leaseId.startsWith("lease_"));
    assert.equal(verifyCommandSignature(leased[0], completed.commandPublicKey), true);

    const ack = {
      commandId: leased[0].id,
      nodeId: identity.nodeId,
      leaseId: leased[0].leaseId,
      status: "completed",
      result: { accepted: true, sessionId: "session-123" },
      error: "",
      generatedAt: "2026-05-12T20:02:00.000Z",
    };
    const acknowledged = await service.acknowledgeCommandFromNode({
      authorization: `Bearer ${completed.accessToken}`,
      nodeId: identity.nodeId,
      commandId: leased[0].id,
      body: {
        ack,
        signature: nodeIdentityStore.signPayload({ type: "node.command.ack", ack }),
      },
    });
    assert.equal(acknowledged.status, "completed");
    assert.equal(acknowledged.result.accepted, true);
    assert.equal(service.countPendingCommandsForNode(identity.nodeId), 0);
    assert.doesNotMatch(JSON.stringify(service.listCommandsForOwner({ ownerAccountId: "acct_mark", nodeId: identity.nodeId })), /continue from web|slnode_|grant_/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("AccountNodeRegistryService queues sanitized session create capsule commands", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-account-create-command-"));
  try {
    const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "node") });
    await nodeIdentityStore.initialize();
    const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
    const service = new AccountNodeRegistryService({ stateDir: path.join(stateDir, "account") });
    await service.initialize();
    const pairing = await service.createPairing({ identity, label: "Remote worker" });
    const approval = await service.approvePairing({ pairingId: pairing.id, ownerAccountId: "acct_mark" });
    const completed = await service.completePairing({ grant: approval.grant, identity });
    const registration = buildNodeRegistrationPayload({
      identity,
      snapshot: sampleSnapshot(identity.nodeId, identity.installId),
    });
    await service.registerNode({
      authorization: `Bearer ${completed.accessToken}`,
      body: {
        type: "node.registration",
        registration,
        signature: nodeIdentityStore.signPayload({ type: "node.registration", registration }),
      },
    });

    const queued = await service.enqueueCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      body: {
        operation: "session.create",
        clientCommandId: "capsule-1",
        payload: {
          providerId: "codex",
          name: "Moved: trainer",
          cwd: "/workspace/model",
          initialPrompt: "Source session id: session-1\nTarget machine id: gpu-box",
          initialPromptDelayMs: 900,
          ignoredField: "drop",
        },
      },
    });

    assert.equal(queued.operation, "session.create");
    assert.equal(queued.status, "queued");
    assert.equal(queued.payload, undefined);
    assert.equal(queued.target.providerId, "codex");
    assert.match(queued.target.cwdHint, /^[a-f0-9]{16}$/u);

    const leased = await service.leaseCommandsForNode({
      authorization: `Bearer ${completed.accessToken}`,
      nodeId: identity.nodeId,
    });
    assert.equal(leased.length, 1);
    assert.equal(leased[0].payload.providerId, "codex");
    assert.equal(leased[0].payload.name, "Moved: trainer");
    assert.equal(leased[0].payload.cwd, "/workspace/model");
    assert.match(leased[0].payload.initialPrompt, /Source session id: session-1/);
    assert.equal(leased[0].payload.initialPromptDelayMs, 900);
    assert.equal(leased[0].payload.ignoredField, undefined);
    assert.equal(verifyCommandSignature(leased[0], completed.commandPublicKey), true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("AccountNodeRegistryService queues sanitized app launch commands", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-account-app-command-"));
  try {
    const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "node") });
    await nodeIdentityStore.initialize();
    const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
    const service = new AccountNodeRegistryService({ stateDir: path.join(stateDir, "account") });
    await service.initialize();
    const pairing = await service.createPairing({ identity, label: "Remote worker" });
    const approval = await service.approvePairing({ pairingId: pairing.id, ownerAccountId: "acct_mark" });
    const completed = await service.completePairing({ grant: approval.grant, identity });
    const registration = buildNodeRegistrationPayload({
      identity,
      snapshot: sampleSnapshot(identity.nodeId, identity.installId),
    });
    await service.registerNode({
      authorization: `Bearer ${completed.accessToken}`,
      body: {
        type: "node.registration",
        registration,
        signature: nodeIdentityStore.signPayload({ type: "node.registration", registration }),
      },
    });

    const queued = await service.enqueueCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      body: {
        operation: "app.launch",
        payload: {
          appId: "cursor",
          ignored: "drop",
        },
      },
    });

    assert.equal(queued.operation, "app.launch");
    assert.equal(queued.payload, undefined);
    assert.equal(queued.target.appId, "cursor");

    const leased = await service.leaseCommandsForNode({
      authorization: `Bearer ${completed.accessToken}`,
      nodeId: identity.nodeId,
    });
    assert.equal(leased.length, 1);
    assert.equal(leased[0].payload.appId, "cursor");
    assert.equal(leased[0].payload.ignored, undefined);
    assert.equal(verifyCommandSignature(leased[0], completed.commandPublicKey), true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("AccountNodeRegistryService queues sanitized app instance dismiss commands", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-account-app-dismiss-command-"));
  try {
    const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "node") });
    await nodeIdentityStore.initialize();
    const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
    const service = new AccountNodeRegistryService({ stateDir: path.join(stateDir, "account") });
    await service.initialize();
    const pairing = await service.createPairing({ identity, label: "Remote worker" });
    const approval = await service.approvePairing({ pairingId: pairing.id, ownerAccountId: "acct_mark" });
    const completed = await service.completePairing({ grant: approval.grant, identity });
    const registration = buildNodeRegistrationPayload({
      identity,
      snapshot: sampleSnapshot(identity.nodeId, identity.installId),
    });
    await service.registerNode({
      authorization: `Bearer ${completed.accessToken}`,
      body: {
        type: "node.registration",
        registration,
        signature: nodeIdentityStore.signPayload({ type: "node.registration", registration }),
      },
    });

    const queued = await service.enqueueCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      body: {
        operation: "app.instance.dismiss",
        payload: {
          instanceId: "appinst_cursor",
          appId: "cursor",
          ignored: "drop",
        },
      },
    });

    assert.equal(queued.operation, "app.instance.dismiss");
    assert.equal(queued.payload, undefined);
    assert.equal(queued.target.instanceId, "appinst_cursor");
    assert.equal(queued.target.appId, "cursor");

    const leased = await service.leaseCommandsForNode({
      authorization: `Bearer ${completed.accessToken}`,
      nodeId: identity.nodeId,
    });
    assert.equal(leased.length, 1);
    assert.equal(leased[0].payload.instanceId, "appinst_cursor");
    assert.equal(leased[0].payload.appId, "cursor");
    assert.equal(leased[0].payload.ignored, undefined);
    assert.equal(verifyCommandSignature(leased[0], completed.commandPublicKey), true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("AccountNodeRegistryService rejects forged registration and heartbeat signatures", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-account-registry-forged-"));
  try {
    const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "node") });
    await nodeIdentityStore.initialize();
    const otherIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "other-node") });
    await otherIdentityStore.initialize();
    const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
    const service = new AccountNodeRegistryService({
      stateDir: path.join(stateDir, "account"),
      now: () => new Date("2026-05-12T20:01:00.000Z"),
    });
    await service.initialize();

    const pairing = await service.createPairing({ identity });
    const approval = await service.approvePairing({ pairingId: pairing.id });
    const completed = await service.completePairing({ grant: approval.grant, identity });
    const snapshot = sampleSnapshot(identity.nodeId, identity.installId);
    const registration = buildNodeRegistrationPayload({ identity, snapshot });
    assert.rejects(
      service.registerNode({
        authorization: `Bearer ${completed.accessToken}`,
        body: {
          type: "node.registration",
          registration,
          signature: otherIdentityStore.signPayload({ type: "node.registration", registration }),
        },
      }),
      /signature/,
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
