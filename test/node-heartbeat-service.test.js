import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeHeartbeatService, buildNodeHeartbeatPayload } from "../src/account/node-heartbeat-service.js";
import { AccountTokenStore } from "../src/account/account-token-store.js";
import { NodeIdentityStore } from "../src/node/identity-store.js";

function redactedSnapshot(nodeId) {
  return {
    schemaVersion: 1,
    mode: "redacted",
    node: {
      nodeId,
      installId: "install_heartbeat",
      displayName: "Swarmlab node",
      swarmlabVersion: "1.0.19",
      commit: "abc123",
      branch: "main",
      os: "linux",
      arch: "x64",
      hostnameHash: "hashed-hostname",
    },
    counts: {
      sessions: 1,
      runningSessions: 0,
      browserSessions: 0,
      openActionItems: 0,
      ports: 1,
      canvases: 0,
      projects: 1,
    },
    capabilities: {
      providerCount: 1,
      buildingCount: 2,
      gpuCount: 4,
      cameraCount: 0,
      hasTailscale: true,
    },
    system: {
      platform: "linux",
      arch: "x64",
      cpuCount: 16,
      gpuCount: 4,
      cameraCount: 0,
      memory: { total: 100, used: 20, free: 80 },
    },
    sessions: [
      {
        id: "session-secret",
        name: "redacted",
        cwd: "/Users/mark/private/project",
        command: "OPENAI_API_KEY=sk-secret npm run train",
      },
    ],
    generatedAt: "2026-05-12T09:10:00.000Z",
  };
}

test("buildNodeHeartbeatPayload contains fleet summary, not privileged local data", () => {
  const heartbeat = buildNodeHeartbeatPayload({
    identity: { nodeId: "node_heartbeat", installId: "install_heartbeat", publicKey: "public-key" },
    snapshot: redactedSnapshot("node_heartbeat"),
    connectionHints: [{ kind: "tailscale", url: "https://gpu.tailnet.test/private?token=secret" }],
  });
  assert.equal(heartbeat.nodeId, "node_heartbeat");
  assert.equal(heartbeat.counts.sessions, 1);
  assert.equal(heartbeat.capabilities.gpuCount, 4);
  assert.equal(heartbeat.connectionHints[0].url, "https://gpu.tailnet.test");
  assert.doesNotMatch(JSON.stringify(heartbeat), /sk-secret|OPENAI_API_KEY|\/Users\/mark|private|token=secret|localApiToken/);
});

test("NodeHeartbeatService tick registers once and sends signed redacted heartbeat", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-heartbeat-"));
  try {
    const tokenStore = new AccountTokenStore({ stateDir });
    await tokenStore.load();
    await tokenStore.setRecord({
      accessToken: "secret-account-token",
      appBaseUrl: "https://account.example.test",
      account: { id: "acct_1", login: "mark" },
    });

    const nodeIdentityStore = new NodeIdentityStore({ stateDir, hostname: () => "private-host" });
    await nodeIdentityStore.initialize();
    const nodeId = nodeIdentityStore.getRecord().nodeId;
    const calls = [];
    const accountService = {
      async registerNode({ snapshot, connectionHints }) {
        calls.push({ type: "register", snapshotMode: snapshot.mode, connectionHints });
        await tokenStore.updateNode({ nodeId, displayName: "Swarmlab node", status: "online", connectionHints });
        return { node: tokenStore.getStatus().node };
      },
      async sendHeartbeat({ heartbeat }) {
        calls.push({ type: "heartbeat", heartbeat });
        await tokenStore.recordHeartbeat({ ok: true, at: heartbeat.generatedAt, status: "ok" });
        return { ok: true };
      },
    };
    const nodeSnapshotService = {
      async getSnapshot({ mode }) {
        assert.equal(mode, "redacted");
        return redactedSnapshot(nodeId);
      },
    };
    const service = new NodeHeartbeatService({
      accountService,
      tokenStore,
      nodeIdentityStore,
      nodeSnapshotService,
      settingsProvider: () => ({
        swarmlabAccountHeartbeatEnabled: true,
        swarmlabAccountHeartbeatIntervalMs: 15_000,
      }),
      connectionHintsProvider: () => [{ kind: "tailscale", url: "https://gpu.tailnet.test/path?token=secret" }],
    });

    const result = await service.tick({ reason: "test", forceRegister: true });
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => call.type), ["register", "heartbeat"]);
    const heartbeat = calls[1].heartbeat;
    assert.equal(heartbeat.nodeId, nodeId);
    assert.ok(heartbeat.signature);
    assert.equal(
      nodeIdentityStore.verifyPayloadSignature(
        { type: "node.heartbeat", heartbeat: { ...heartbeat, signature: undefined } },
        heartbeat.signature,
      ),
      false,
      "signature must cover the exact unsigned heartbeat shape, not a mutated object",
    );
    const unsigned = { ...heartbeat };
    delete unsigned.signature;
    assert.equal(
      nodeIdentityStore.verifyPayloadSignature({ type: "node.heartbeat", heartbeat: unsigned }, heartbeat.signature),
      true,
    );
    assert.doesNotMatch(JSON.stringify(calls), /secret-account-token|sk-secret|OPENAI_API_KEY|\/Users\/mark|token=secret|privateKey|localApiToken/);

    calls.length = 0;
    await service.tick({ reason: "second" });
    assert.deepEqual(calls.map((call) => call.type), ["heartbeat"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
