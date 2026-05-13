import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildNodeRegistrationPayload } from "../src/account/account-service.js";
import { AccountNodeRegistryService } from "../src/account/account-node-registry-service.js";
import { AccountTokenStore } from "../src/account/account-token-store.js";
import { NodeCommandRelayService } from "../src/account/node-command-relay-service.js";
import { NodeIdentityStore } from "../src/node/identity-store.js";

function snapshot(nodeId, installId) {
  return {
    schemaVersion: 1,
    mode: "redacted",
    node: {
      nodeId,
      installId,
      displayName: "Relay Mac",
      os: "darwin",
      arch: "arm64",
    },
    counts: { sessions: 1, runningSessions: 1 },
    capabilities: { providerCount: 1, roles: ["agent-host"] },
    generatedAt: "2026-05-12T21:00:00.000Z",
  };
}

test("NodeCommandRelayService executes signed session input commands and acks with node signature", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-command-relay-"));
  try {
    const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "node") });
    await nodeIdentityStore.initialize();
    const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
    const registry = new AccountNodeRegistryService({ stateDir: path.join(stateDir, "account") });
    await registry.initialize();
    const pairing = await registry.createPairing({ identity, ownerAccountId: "acct_mark" });
    const approval = await registry.approvePairing({ pairingId: pairing.id, ownerAccountId: "acct_mark" });
    const completed = await registry.completePairing({ grant: approval.grant, identity });
    const registration = buildNodeRegistrationPayload({
      identity,
      snapshot: snapshot(identity.nodeId, identity.installId),
    });
    await registry.registerNode({
      authorization: `Bearer ${completed.accessToken}`,
      body: {
        type: "node.registration",
        registration,
        signature: nodeIdentityStore.signPayload({ type: "node.registration", registration }),
      },
    });
    await registry.enqueueCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      body: {
        operation: "session.input.write",
        payload: { sessionId: "session-1", input: "continue remotely" },
      },
    });
    const leased = await registry.leaseCommandsForNode({
      authorization: `Bearer ${completed.accessToken}`,
      nodeId: identity.nodeId,
    });

    const tokenStore = new AccountTokenStore({ stateDir: path.join(stateDir, "local") });
    await tokenStore.load();
    await tokenStore.setRecord({
      accessToken: completed.accessToken,
      appBaseUrl: "https://account.example.test",
      accountPublicKey: completed.commandPublicKey,
      account: completed.account,
      node: completed.node,
    });

    const writes = [];
    const session = { id: "session-1", name: "Worker", providerId: "codex", status: "running" };
    const accountService = {
      async listCommands() {
        return { commands: leased, accountPublicKey: completed.commandPublicKey };
      },
      async acknowledgeCommand({ commandId, ack }) {
        return registry.acknowledgeCommandFromNode({
          authorization: `Bearer ${completed.accessToken}`,
          nodeId: identity.nodeId,
          commandId,
          body: ack,
        });
      },
    };
    const sessionManager = {
      getSession(id) {
        return id === session.id ? session : null;
      },
      write(id, input, options) {
        writes.push({ id, input, options });
        return true;
      },
      serializeSession(value) {
        return value;
      },
    };
    const relay = new NodeCommandRelayService({
      accountService,
      tokenStore,
      nodeIdentityStore,
      sessionManager,
      settingsProvider: () => ({}),
    });

    const result = await relay.tick({ reason: "test" });
    assert.equal(result.commandCount, 1);
    assert.deepEqual(writes, [{
      id: "session-1",
      input: "continue remotely\n",
      options: { clientMessageId: null },
    }]);
    const command = registry.getCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      commandId: leased[0].id,
    });
    assert.equal(command.status, "completed");
    assert.equal(command.result.accepted, true);
    assert.equal(relay.getStatus().executedCount, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("NodeCommandRelayService executes signed session create commands", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-command-relay-create-"));
  try {
    const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "node") });
    await nodeIdentityStore.initialize();
    const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
    const registry = new AccountNodeRegistryService({ stateDir: path.join(stateDir, "account") });
    await registry.initialize();
    const pairing = await registry.createPairing({ identity, ownerAccountId: "acct_mark" });
    const approval = await registry.approvePairing({ pairingId: pairing.id, ownerAccountId: "acct_mark" });
    const completed = await registry.completePairing({ grant: approval.grant, identity });
    const registration = buildNodeRegistrationPayload({
      identity,
      snapshot: snapshot(identity.nodeId, identity.installId),
    });
    await registry.registerNode({
      authorization: `Bearer ${completed.accessToken}`,
      body: {
        type: "node.registration",
        registration,
        signature: nodeIdentityStore.signPayload({ type: "node.registration", registration }),
      },
    });
    await registry.enqueueCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      body: {
        operation: "session.create",
        payload: {
          providerId: "codex",
          name: "Moved: trainer",
          cwd: "/workspace",
          initialPrompt: "resume capsule",
          initialPromptDelayMs: 1200,
        },
      },
    });
    const leased = await registry.leaseCommandsForNode({
      authorization: `Bearer ${completed.accessToken}`,
      nodeId: identity.nodeId,
    });

    const tokenStore = new AccountTokenStore({ stateDir: path.join(stateDir, "local") });
    await tokenStore.load();
    await tokenStore.setRecord({
      accessToken: completed.accessToken,
      appBaseUrl: "https://account.example.test",
      accountPublicKey: completed.commandPublicKey,
      account: completed.account,
      node: completed.node,
    });

    const created = [];
    const accountService = {
      async listCommands() {
        return { commands: leased, accountPublicKey: completed.commandPublicKey };
      },
      async acknowledgeCommand({ commandId, ack }) {
        return registry.acknowledgeCommandFromNode({
          authorization: `Bearer ${completed.accessToken}`,
          nodeId: identity.nodeId,
          commandId,
          body: ack,
        });
      },
    };
    const sessionManager = {
      createSession(input) {
        created.push(input);
        return { id: "session-new", name: input.name, providerId: input.providerId, status: "running" };
      },
    };
    const relay = new NodeCommandRelayService({
      accountService,
      tokenStore,
      nodeIdentityStore,
      sessionManager,
      settingsProvider: () => ({}),
    });

    const result = await relay.tick({ reason: "test" });
    assert.equal(result.commandCount, 1);
    assert.deepEqual(created, [{
      providerId: "codex",
      name: "Moved: trainer",
      cwd: "/workspace",
      initialPrompt: "resume capsule",
      initialPromptDelayMs: 1200,
    }]);
    const command = registry.getCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      commandId: leased[0].id,
    });
    assert.equal(command.status, "completed");
    assert.equal(command.result.created, true);
    assert.equal(command.result.session.id, "session-new");
    assert.equal(relay.getStatus().executedCount, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("NodeCommandRelayService executes signed app launch commands", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "swarmlab-command-relay-app-"));
  try {
    const nodeIdentityStore = new NodeIdentityStore({ stateDir: path.join(stateDir, "node") });
    await nodeIdentityStore.initialize();
    const identity = nodeIdentityStore.getPublicIdentity({ includeHostname: false });
    const registry = new AccountNodeRegistryService({ stateDir: path.join(stateDir, "account") });
    await registry.initialize();
    const pairing = await registry.createPairing({ identity, ownerAccountId: "acct_mark" });
    const approval = await registry.approvePairing({ pairingId: pairing.id, ownerAccountId: "acct_mark" });
    const completed = await registry.completePairing({ grant: approval.grant, identity });
    const registration = buildNodeRegistrationPayload({
      identity,
      snapshot: snapshot(identity.nodeId, identity.installId),
    });
    await registry.registerNode({
      authorization: `Bearer ${completed.accessToken}`,
      body: {
        type: "node.registration",
        registration,
        signature: nodeIdentityStore.signPayload({ type: "node.registration", registration }),
      },
    });
    await registry.enqueueCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      body: {
        operation: "app.launch",
        payload: { appId: "cursor" },
      },
    });
    const leased = await registry.leaseCommandsForNode({
      authorization: `Bearer ${completed.accessToken}`,
      nodeId: identity.nodeId,
    });

    const tokenStore = new AccountTokenStore({ stateDir: path.join(stateDir, "local") });
    await tokenStore.load();
    await tokenStore.setRecord({
      accessToken: completed.accessToken,
      appBaseUrl: "https://account.example.test",
      accountPublicKey: completed.commandPublicKey,
      account: completed.account,
      node: completed.node,
    });

    const launched = [];
    const accountService = {
      async listCommands() {
        return { commands: leased, accountPublicKey: completed.commandPublicKey };
      },
      async acknowledgeCommand({ commandId, ack }) {
        return registry.acknowledgeCommandFromNode({
          authorization: `Bearer ${completed.accessToken}`,
          nodeId: identity.nodeId,
          commandId,
          body: ack,
        });
      },
    };
    const relay = new NodeCommandRelayService({
      accountService,
      tokenStore,
      nodeIdentityStore,
      sessionManager: { getSession() {} },
      appLaunchersProvider: () => [{ id: "cursor", label: "Cursor", available: true }],
      appLauncher: async (launcherId, launchers, options) => {
        launched.push({ launcherId, launchers, options });
        return { launched: true, launcher: { id: launcherId } };
      },
      settingsProvider: () => ({}),
    });

    const result = await relay.tick({ reason: "test" });
    assert.equal(result.commandCount, 1);
    assert.equal(launched.length, 1);
    assert.equal(launched[0].launcherId, "cursor");
    assert.equal(launched[0].options.source, "account");
    assert.equal(launched[0].options.clientCommandId, leased[0].id);
    const command = registry.getCommandForOwner({
      ownerAccountId: "acct_mark",
      nodeId: identity.nodeId,
      commandId: leased[0].id,
    });
    assert.equal(command.status, "completed");
    assert.equal(command.result.launched, true);
    assert.equal(command.result.launcher.id, "cursor");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
