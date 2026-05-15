import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibeResearchApp } from "../src/create-app.js";
import { SleepPreventionService } from "../src/sleep-prevention.js";

const shellProvider = {
  id: "shell",
  label: "Shell",
  command: null,
  launchCommand: null,
  defaultName: "Shell",
  available: true,
};

const testAgentProvider = {
  id: "test-agent",
  label: "Test Agent",
  command: null,
  launchCommand: null,
  defaultName: "Test Agent",
  available: true,
};

function createNoopService(status = {}) {
  return {
    replyToken: "",
    requestToken: "",
    webhookToken: "",
    async initialize() {},
    async shutdown() {},
    start() {},
    stop() {},
    restart() {},
    stopLaunchedProcess() {},
    getStatus() { return status; },
    getWebhookUrl() { return ""; },
    setServerBaseUrl() {},
    listSubagentsForSession() { return []; },
  };
}

function createBuildingHubService() {
  return {
    async refresh() {},
    restart() {},
    listBuildings() { return []; },
    listLayouts() { return []; },
    listRecipes() { return []; },
    getStatus() { return { sources: [], lastRefreshAt: 0 }; },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProbe(probe, { timeoutMs = 8_000, intervalMs = 75, label = "condition" } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function startSwarmlabNode(label, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), `swarmlab-two-node-${label}-`));
  const app = await createVibeResearchApp({
    host: "127.0.0.1",
    port: 0,
    cwd: root,
    stateDir: path.join(root, ".swarmlab"),
    persistSessions: false,
    persistentTerminals: false,
    providers: [shellProvider, testAgentProvider],
    systemMetricsSampleIntervalMs: 0,
    accessUrlsProvider: async (_host, port) => [{ label: "Local", url: `http://127.0.0.1:${port}` }],
    listPorts: async () => [],
    systemMetricsProvider: async () => ({
      cameras: [],
      gpus: [],
      memory: { total: 100, used: 10, free: 90 },
    }),
    buildingHubServiceFactory: createBuildingHubService,
    browserUseServiceFactory: () => ({
      ...createNoopService({ enabled: false }),
      listSessions() { return []; },
    }),
    ottoAuthServiceFactory: () => createNoopService({ enabled: false }),
    telegramServiceFactory: () => createNoopService({ enabled: false }),
    twilioServiceFactory: () => createNoopService({ enabled: false }),
    videoMemoryServiceFactory: () => createNoopService({ enabled: false }),
    wikiBackupServiceFactory: () => ({
      start() {},
      stop() {},
      setConfig() {},
      getStatus() { return { enabled: false }; },
      async runBackup() {},
    }),
    sleepPreventionFactory: (settings) =>
      new SleepPreventionService({ enabled: settings.preventSleepEnabled, platform: "test" }),
    ...overrides,
  });

  return {
    app,
    root,
    baseUrl: `http://127.0.0.1:${app.config.port}`,
    async cleanup() {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function enqueueCommand({ accountBaseUrl, nodeId, operation, payload }) {
  const response = await fetch(`${accountBaseUrl}/api/account/nodes/${encodeURIComponent(nodeId)}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, payload }),
  });
  const body = await readJson(response);
  return body.command;
}

async function pollRemoteCommands(remote, reason) {
  const response = await fetch(`${remote.baseUrl}/api/node/account/commands/poll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return readJson(response);
}

async function waitForCommand({ accountBaseUrl, nodeId, commandId, status = "completed" }) {
  return waitForProbe(async () => {
    const response = await fetch(`${accountBaseUrl}/api/account/nodes/${encodeURIComponent(nodeId)}/commands/${encodeURIComponent(commandId)}`);
    const body = await readJson(response);
    const command = body.command;
    if (command?.status === "failed") {
      throw new Error(command.error || "Remote command failed.");
    }
    return command?.status === status ? command : null;
  }, { label: `command ${commandId} to reach ${status}` });
}

function narrativeText(narrative = {}) {
  return (Array.isArray(narrative.entries) ? narrative.entries : [])
    .map((entry) => [entry.label, entry.text, entry.summary, entry.outputPreview, entry.meta].filter(Boolean).join("\n"))
    .join("\n");
}

test("two live Swarmlab nodes pair, launch a remote agent, route input, and proxy native chat", async () => {
  const hub = await startSwarmlabNode("hub");
  const remote = await startSwarmlabNode("remote");
  try {
    const pairResponse = await fetch(`${hub.baseUrl}/api/node/remote-pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: remote.baseUrl,
        accountBaseUrl: hub.baseUrl,
        label: "Remote shell node",
      }),
    });
    const pairBody = await readJson(pairResponse);
    assert.equal(pairBody.ok, true);
    assert.equal(pairBody.accountBaseUrl, hub.baseUrl);
    assert.doesNotMatch(JSON.stringify(pairBody), /slnode_|grant_/);

    const nodesBody = await readJson(await fetch(`${hub.baseUrl}/api/account/nodes`));
    const remoteNode = nodesBody.nodes.find((node) => node.baseUrl === remote.baseUrl);
    assert.ok(remoteNode, "remote node should be registered in the hub account registry");
    assert.ok(remoteNode.displayName);
    assert.match(remoteNode.status, /^(online|idle|busy)$/u);
    assert.doesNotMatch(JSON.stringify(nodesBody), /slnode_|grant_/);

    const createCommand = await enqueueCommand({
      accountBaseUrl: hub.baseUrl,
      nodeId: remoteNode.nodeId,
      operation: "session.create",
      payload: {
        providerId: "test-agent",
        name: "Remote E2E Agent",
        cwd: remote.root,
      },
    });
    await pollRemoteCommands(remote, "two-node-create-session");
    const createdCommand = await waitForCommand({
      accountBaseUrl: hub.baseUrl,
      nodeId: remoteNode.nodeId,
      commandId: createCommand.id,
    });
    const remoteSessionId = createdCommand.result?.session?.id;
    assert.ok(remoteSessionId, "session.create should return a remote session id");

    const writeCommand = await enqueueCommand({
      accountBaseUrl: hub.baseUrl,
      nodeId: remoteNode.nodeId,
      operation: "session.input.write",
      payload: {
        sessionId: remoteSessionId,
        input: "echo swarmlab_two_node_remote_chat",
      },
    });
    await pollRemoteCommands(remote, "two-node-write-input");
    const completedWrite = await waitForCommand({
      accountBaseUrl: hub.baseUrl,
      nodeId: remoteNode.nodeId,
      commandId: writeCommand.id,
    });
    assert.equal(completedWrite.result?.accepted, true);

    const proxied = await waitForProbe(async () => {
      const response = await fetch(
        `${hub.baseUrl}/api/node/remote-session-narrative?nodeId=${encodeURIComponent(remoteNode.nodeId)}&sessionId=${encodeURIComponent(remoteSessionId)}`,
      );
      const body = await readJson(response);
      return narrativeText(body.narrative).includes("swarmlab_two_node_remote_chat") ? body : null;
    }, { label: "remote native chat to include routed input" });

    assert.equal(proxied.node.nodeId, remoteNode.nodeId);
    assert.equal(proxied.baseUrl, remote.baseUrl);
    assert.equal(proxied.sessionId, remoteSessionId);
    assert.ok(proxied.narrative.entries.length >= 2);
  } finally {
    await remote.cleanup();
    await hub.cleanup();
  }
});
