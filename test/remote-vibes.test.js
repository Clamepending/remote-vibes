import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { WebSocket } from "ws";
import { createRemoteVibesApp } from "../src/create-app.js";

const PNG_FIXTURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92,
  0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

async function startApp(options = {}) {
  const appCwd = options.cwd ?? process.cwd();
  const app = await createRemoteVibesApp({
    host: "127.0.0.1",
    port: 0,
    cwd: appCwd,
    stateDir: options.stateDir ?? path.join(appCwd, ".remote-vibes"),
    persistSessions: false,
    ...options,
  });

  return {
    app,
    baseUrl: `http://127.0.0.1:${app.config.port}`,
  };
}

async function createTempWorkspace(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writePersistedSessions(workspaceDir, sessions) {
  const stateDir = path.join(workspaceDir, ".remote-vibes");
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, "sessions.json"),
    `${JSON.stringify({ version: 1, savedAt: new Date().toISOString(), sessions }, null, 2)}\n`,
    "utf8",
  );
}

async function waitForPort(baseUrl, port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/ports`);
    const payload = await response.json();

    if (payload.ports.some((entry) => entry.port === port)) {
      return payload.ports;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Port ${port} never appeared in /api/ports.`);
}

async function waitForShutdown(baseUrl) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fetch(`${baseUrl}/api/state`);
    } catch {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Remote Vibes never shut down.");
}

async function waitForSessionName(baseUrl, sessionId, expectedName) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/sessions`);
    const payload = await response.json();
    const session = payload.sessions.find((entry) => entry.id === sessionId);

    if (session?.name === expectedName) {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for session ${sessionId} to be renamed to ${expectedName}.`);
}

test("state is available without authentication", async () => {
  const { app, baseUrl } = await startApp();

  try {
    const response = await fetch(`${baseUrl}/api/state`);
    assert.equal(response.status, 200);

    const state = await response.json();
    assert.equal(state.appName, "Remote Vibes");
    const expectedDefaultProviderId = state.providers.some(
      (provider) => provider.id === "claude" && provider.available,
    )
      ? "claude"
      : "shell";
    assert.equal(state.defaultProviderId, expectedDefaultProviderId);
    assert.ok(state.providers.some((provider) => provider.id === "shell" && provider.available));
    assert.ok(Array.isArray(state.urls));
    assert.ok(state.urls.length >= 1);
    assert.equal(typeof state.preferredUrl, "string");
    assert.ok(state.urls.some((entry) => entry.url === state.preferredUrl));
  } finally {
    await app.close();
  }
});

test("update endpoints expose status and schedule restart through the update manager", async () => {
  let statusForce = false;
  let runtimePort = null;
  let scheduleCalls = 0;
  const updateManager = {
    setRuntime({ port }) {
      runtimePort = port;
    },
    async getStatus({ force } = {}) {
      statusForce = Boolean(force);
      return {
        status: "available",
        updateAvailable: true,
        canUpdate: true,
        currentShort: "1111111",
        latestShort: "2222222",
        branch: "main",
      };
    },
    async scheduleUpdateAndRestart() {
      scheduleCalls += 1;
      return {
        ok: true,
        scheduled: true,
        logPath: "/tmp/remote-vibes-update.log",
      };
    },
  };
  const { app, baseUrl } = await startApp({ updateManager });

  try {
    assert.equal(typeof runtimePort, "number");

    const statusResponse = await fetch(`${baseUrl}/api/update/status?force=1`);
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), {
      update: {
        status: "available",
        updateAvailable: true,
        canUpdate: true,
        currentShort: "1111111",
        latestShort: "2222222",
        branch: "main",
      },
    });
    assert.equal(statusForce, true);

    const applyResponse = await fetch(`${baseUrl}/api/update/apply`, {
      method: "POST",
    });
    assert.equal(applyResponse.status, 200);
    assert.deepEqual(await applyResponse.json(), {
      ok: true,
      scheduled: true,
      logPath: "/tmp/remote-vibes-update.log",
    });
    assert.equal(scheduleCalls, 1);
  } finally {
    await app.close();
  }
});

test("agent prompt scaffold is created for the workspace", async () => {
  const workspaceDir = await createTempWorkspace("remote-vibes-agent-prompt-");
  const { app } = await startApp({ cwd: workspaceDir });

  try {
    const prompt = await readFile(path.join(workspaceDir, ".remote-vibes", "agent-prompt.md"), "utf8");
    assert.match(prompt, /Remote Vibes Agent Prompt/);
    assert.match(prompt, /rv-session-name/);
  } finally {
    await app.close();
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("starting on an occupied port fails with EADDRINUSE", async () => {
  const blocker = http.createServer((_request, response) => {
    response.end("busy");
  });

  await new Promise((resolve) => blocker.listen(0, "0.0.0.0", resolve));
  const address = blocker.address();
  const occupiedPort = typeof address === "object" && address ? address.port : null;

  try {
    await assert.rejects(
      () =>
        createRemoteVibesApp({
          host: "0.0.0.0",
          port: occupiedPort,
          cwd: process.cwd(),
          stateDir: path.join(process.cwd(), ".remote-vibes"),
          persistSessions: false,
        }),
      { code: "EADDRINUSE" },
    );
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("rv-session-name can rename the current session from inside a live shell", async () => {
  const { app, baseUrl } = await startApp();

  try {
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        name: "Shell 1",
        cwd: process.cwd(),
      }),
    });

    assert.equal(createResponse.status, 201);
    const { session } = await createResponse.json();

    const websocket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws?sessionId=${session.id}`);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket open.")), 5_000);
      websocket.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    websocket.send(
      JSON.stringify({
        type: "input",
        data: "rv-session-name \"results reviewer\"\r",
      }),
    );

    const renamedSession = await waitForSessionName(baseUrl, session.id, "results reviewer");
    assert.equal(renamedSession.name, "results reviewer");

    websocket.close();
    await once(websocket, "close");
  } finally {
    await app.close();
  }
});

test("shell session streams websocket output and honors custom cwd", async () => {
  const { app, baseUrl } = await startApp();

  try {
    const requestedCwd = path.join(os.tmpdir());
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        name: "Integration Shell",
        cwd: requestedCwd,
      }),
    });

    assert.equal(createResponse.status, 201);
    const { session } = await createResponse.json();
    assert.equal(session.cwd, requestedCwd);

    const websocket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws?sessionId=${session.id}`);
    const marker = "REMOTE_VIBES_AUTOMATED_SMOKE";
    const output = await new Promise((resolve, reject) => {
      let combined = "";
      let sentResize = false;
      let sentMarker = false;
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for terminal output."));
      }, 8_000);

      websocket.on("open", () => {
        websocket.send(
          JSON.stringify({
            type: "resize",
            cols: 100,
            rows: 30,
          }),
        );
        sentResize = true;
      });

      websocket.on("message", (chunk) => {
        const payload = JSON.parse(String(chunk));
        const data = payload.data || "";
        combined += data;

        if (!sentResize) {
          websocket.send(
            JSON.stringify({
              type: "resize",
              cols: 100,
              rows: 30,
            }),
          );
          sentResize = true;
        }

        if (!sentMarker) {
          websocket.send(
            JSON.stringify({
              type: "input",
              data: `printf "${marker}\\n"\r`,
            }),
          );
          sentMarker = true;
        }

        if (combined.includes(marker)) {
          clearTimeout(timeout);
          resolve(combined);
        }
      });
    });

    assert.match(output, new RegExp(marker));
    assert.doesNotMatch(output, /cannot change locale/i);

    websocket.close();
    await once(websocket, "close");

    const deleteResponse = await fetch(`${baseUrl}/api/sessions/${session.id}`, {
      method: "DELETE",
    });

    assert.equal(deleteResponse.status, 200);
  } finally {
    await app.close();
  }
});

test("reloading a live session keeps a large transcript available in the reconnect snapshot", async () => {
  const { app, baseUrl } = await startApp();

  try {
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        name: "Large Transcript",
        cwd: process.cwd(),
      }),
    });

    assert.equal(createResponse.status, 201);
    const { session } = await createResponse.json();

    const firstSocket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws?sessionId=${session.id}`);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket open.")), 5_000);
      firstSocket.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const beginMarker = `BEGIN-${Date.now()}`;
    const endMarker = `END-${Date.now()}`;
    firstSocket.send(
      JSON.stringify({
        type: "input",
        data:
          `python3 - <<'PY'\n` +
          `print(${JSON.stringify(beginMarker)})\n` +
          `print("A" * 260000)\n` +
          `print(${JSON.stringify(endMarker)})\n` +
          `PY\n\r`,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 2_500));
    firstSocket.close();
    await once(firstSocket, "close");

    const restoredSocket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws?sessionId=${session.id}`);
    const snapshot = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for restored snapshot.")), 5_000);

      restoredSocket.on("message", (chunk) => {
        const payload = JSON.parse(String(chunk));
        if (payload.type === "snapshot") {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });

    assert.match(snapshot.data, new RegExp(beginMarker));
    assert.match(snapshot.data, new RegExp(endMarker));

    restoredSocket.close();
    await once(restoredSocket, "close");
  } finally {
    await app.close();
  }
});

test("session names can be updated after creation", async () => {
  const { app, baseUrl } = await startApp();

  try {
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        name: "Original Name",
        cwd: process.cwd(),
      }),
    });

    assert.equal(createResponse.status, 201);
    const { session } = await createResponse.json();

    const renameResponse = await fetch(`${baseUrl}/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Renamed Session",
      }),
    });

    assert.equal(renameResponse.status, 200);
    const renamePayload = await renameResponse.json();
    assert.equal(renamePayload.session.name, "Renamed Session");

    const sessionsResponse = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(sessionsResponse.status, 200);
    const sessionsPayload = await sessionsResponse.json();
    assert.equal(sessionsPayload.sessions[0].name, "Renamed Session");
  } finally {
    await app.close();
  }
});

test("sessions can be forked into fresh sibling sessions", async () => {
  const { app, baseUrl } = await startApp();

  try {
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        name: "Parent Session",
        cwd: process.cwd(),
      }),
    });

    assert.equal(createResponse.status, 201);
    const { session } = await createResponse.json();

    const firstForkResponse = await fetch(`${baseUrl}/api/sessions/${session.id}/fork`, {
      method: "POST",
    });
    assert.equal(firstForkResponse.status, 201);
    const firstForkPayload = await firstForkResponse.json();

    assert.notEqual(firstForkPayload.session.id, session.id);
    assert.equal(firstForkPayload.session.providerId, session.providerId);
    assert.equal(firstForkPayload.session.cwd, session.cwd);
    assert.equal(firstForkPayload.session.name, "Parent Session fork");

    const secondForkResponse = await fetch(`${baseUrl}/api/sessions/${session.id}/fork`, {
      method: "POST",
    });
    assert.equal(secondForkResponse.status, 201);
    const secondForkPayload = await secondForkResponse.json();
    assert.equal(secondForkPayload.session.name, "Parent Session fork 2");

    const sessionsResponse = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(sessionsResponse.status, 200);
    const sessionsPayload = await sessionsResponse.json();
    assert.equal(sessionsPayload.sessions.length, 3);

    const websocket = new WebSocket(
      `${baseUrl.replace("http", "ws")}/ws?sessionId=${firstForkPayload.session.id}`,
    );
    const snapshot = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for forked session snapshot."));
      }, 8_000);

      websocket.on("message", (chunk) => {
        const payload = JSON.parse(String(chunk));

        if (payload.type === "snapshot") {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });

    assert.match(snapshot.data, /forked from: Parent Session/);
    assert.match(snapshot.data, /fresh sibling session/i);

    websocket.close();
    await once(websocket, "close");
  } finally {
    await app.close();
  }
});

test("ports are discoverable and proxy through localhost", async () => {
  const previewServer = http.createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end('<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body>preview</body></html>');
      return;
    }

    if (request.url === "/style.css") {
      response.writeHead(200, { "Content-Type": "text/css" });
      response.end("body{background:rgb(1,2,3)}");
      return;
    }

    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(`preview:${request.url}`);
  });
  const forbiddenServer = http.createServer((_request, response) => {
    response.writeHead(403, { "Content-Type": "text/plain" });
    response.end("forbidden");
  });

  await new Promise((resolve) => previewServer.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => forbiddenServer.listen(0, "127.0.0.1", resolve));
  const previewPort = previewServer.address().port;
  const forbiddenPort = forbiddenServer.address().port;

  const { app, baseUrl } = await startApp();

  try {
    const ports = await waitForPort(baseUrl, previewPort);
    assert.ok(ports.some((entry) => entry.port === previewPort));
    assert.ok(!ports.some((entry) => entry.port === forbiddenPort));

    const rootResponse = await fetch(`${baseUrl}/proxy/${previewPort}/`);
    assert.equal(rootResponse.status, 200);
    assert.match(await rootResponse.text(), /href="\/style\.css"/);

    const stylesheetResponse = await fetch(`${baseUrl}/style.css`, {
      headers: {
        Referer: `${baseUrl}/proxy/${previewPort}/`,
      },
    });
    assert.equal(stylesheetResponse.status, 200);
    assert.equal(await stylesheetResponse.text(), "body{background:rgb(1,2,3)}");

    const proxyResponse = await fetch(`${baseUrl}/proxy/${previewPort}/hello`);
    assert.equal(proxyResponse.status, 200);
    assert.equal(await proxyResponse.text(), "preview:/hello");
  } finally {
    await app.close();
    await new Promise((resolve) => previewServer.close(resolve));
    await new Promise((resolve) => forbiddenServer.close(resolve));
  }
});

test("ports can be renamed and reset", async () => {
  const previewServer = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("preview");
  });

  await new Promise((resolve) => previewServer.listen(0, "127.0.0.1", resolve));
  const previewPort = previewServer.address().port;
  const { app, baseUrl } = await startApp();

  try {
    const ports = await waitForPort(baseUrl, previewPort);
    const initialPort = ports.find((entry) => entry.port === previewPort);
    assert.equal(initialPort?.name, String(previewPort));
    assert.equal(initialPort?.customName, false);

    const renameResponse = await fetch(`${baseUrl}/api/ports/${previewPort}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Model UI",
      }),
    });

    assert.equal(renameResponse.status, 200);
    const renamePayload = await renameResponse.json();
    assert.equal(renamePayload.port.name, "Model UI");
    assert.equal(renamePayload.port.customName, true);

    const stateResponse = await fetch(`${baseUrl}/api/state`);
    assert.equal(stateResponse.status, 200);
    const statePayload = await stateResponse.json();
    const renamedPort = statePayload.ports.find((entry) => entry.port === previewPort);
    assert.equal(renamedPort?.name, "Model UI");
    assert.equal(renamedPort?.customName, true);

    const resetResponse = await fetch(`${baseUrl}/api/ports/${previewPort}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "",
      }),
    });

    assert.equal(resetResponse.status, 200);
    const resetPayload = await resetResponse.json();
    assert.equal(resetPayload.port.name, String(previewPort));
    assert.equal(resetPayload.port.customName, false);
  } finally {
    await app.close();
    await new Promise((resolve) => previewServer.close(resolve));
  }
});

test("rejects an invalid working directory", async () => {
  const { app, baseUrl } = await startApp();

  try {
    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        cwd: "/definitely/not/a/real/path",
      }),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /Working directory does not exist/);
  } finally {
    await app.close();
  }
});

test("terminate endpoint shuts down the app cleanly", async () => {
  let terminateCalls = 0;
  const { app, baseUrl } = await startApp({
    onTerminate: async () => {
      terminateCalls += 1;
    },
  });

  try {
    const response = await fetch(`${baseUrl}/api/terminate`, {
      method: "POST",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, shuttingDown: true });

    await waitForShutdown(baseUrl);
    assert.equal(terminateCalls, 1);
  } finally {
    await app.close();
  }
});

test("running sessions are restored with their transcript after restart", async () => {
  const workspaceDir = await createTempWorkspace("remote-vibes-persist-");
  let firstApp = null;
  let secondApp = null;

  try {
    const firstRun = await startApp({
      cwd: workspaceDir,
      persistSessions: true,
    });
    firstApp = firstRun.app;

    const createResponse = await fetch(`${firstRun.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        name: "Persistent Shell",
        cwd: workspaceDir,
      }),
    });

    assert.equal(createResponse.status, 201);
    const { session } = await createResponse.json();
    const websocket = new WebSocket(`${firstRun.baseUrl.replace("http", "ws")}/ws?sessionId=${session.id}`);
    const marker = "REMOTE_VIBES_PERSISTENCE_MARKER";

    const output = await new Promise((resolve, reject) => {
      let combined = "";
      let sentResize = false;
      let sentMarker = false;
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for persisted session output."));
      }, 8_000);

      websocket.on("open", () => {
        websocket.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
        sentResize = true;
      });

      websocket.on("message", (chunk) => {
        const payload = JSON.parse(String(chunk));
        const data = payload.data || "";
        combined += data;

        if (!sentResize) {
          websocket.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
          sentResize = true;
        }

        if (!sentMarker) {
          websocket.send(
            JSON.stringify({
              type: "input",
              data: `printf "${marker}\\n"\r`,
            }),
          );
          sentMarker = true;
        }

        if (combined.includes(marker)) {
          clearTimeout(timeout);
          resolve(combined);
        }
      });
    });

    assert.match(output, new RegExp(marker));
    websocket.close();
    await once(websocket, "close");

    await firstApp.close();
    firstApp = null;

    const secondRun = await startApp({
      cwd: workspaceDir,
      persistSessions: true,
    });
    secondApp = secondRun.app;

    const sessionsResponse = await fetch(`${secondRun.baseUrl}/api/sessions`);
    assert.equal(sessionsResponse.status, 200);
    const sessionsPayload = await sessionsResponse.json();
    assert.equal(sessionsPayload.sessions.length, 1);
    assert.equal(sessionsPayload.sessions[0].name, "Persistent Shell");
    assert.equal(sessionsPayload.sessions[0].cwd, workspaceDir);

    const restoredSocket = new WebSocket(
      `${secondRun.baseUrl.replace("http", "ws")}/ws?sessionId=${sessionsPayload.sessions[0].id}`,
    );
    const snapshot = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for restored session snapshot."));
      }, 8_000);

      restoredSocket.on("message", (chunk) => {
        const payload = JSON.parse(String(chunk));

        if (payload.type === "snapshot") {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });

    assert.match(snapshot.data, new RegExp(marker));
    restoredSocket.close();
    await once(restoredSocket, "close");
  } finally {
    if (firstApp) {
      await firstApp.close();
    }

    if (secondApp) {
      await secondApp.close();
    }

    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("renamed sessions keep their updated name after restart", async () => {
  const workspaceDir = await createTempWorkspace("remote-vibes-rename-persist-");
  let firstApp = null;
  let secondApp = null;

  try {
    const firstRun = await startApp({
      cwd: workspaceDir,
      persistSessions: true,
    });
    firstApp = firstRun.app;

    const createResponse = await fetch(`${firstRun.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        name: "Before Rename",
        cwd: workspaceDir,
      }),
    });

    assert.equal(createResponse.status, 201);
    const { session } = await createResponse.json();

    const renameResponse = await fetch(`${firstRun.baseUrl}/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "After Rename",
      }),
    });

    assert.equal(renameResponse.status, 200);
    assert.equal((await renameResponse.json()).session.name, "After Rename");

    await firstApp.close();
    firstApp = null;

    const secondRun = await startApp({
      cwd: workspaceDir,
      persistSessions: true,
    });
    secondApp = secondRun.app;

    const sessionsResponse = await fetch(`${secondRun.baseUrl}/api/sessions`);
    assert.equal(sessionsResponse.status, 200);
    const sessionsPayload = await sessionsResponse.json();
    assert.equal(sessionsPayload.sessions.length, 1);
    assert.equal(sessionsPayload.sessions[0].id, session.id);
    assert.equal(sessionsPayload.sessions[0].name, "After Rename");
  } finally {
    if (firstApp) {
      await firstApp.close();
    }

    if (secondApp) {
      await secondApp.close();
    }

    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("renamed ports keep their updated name after restart", async () => {
  const workspaceDir = await createTempWorkspace("remote-vibes-port-rename-persist-");
  const previewServer = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("preview");
  });
  let firstApp = null;
  let secondApp = null;

  await new Promise((resolve) => previewServer.listen(0, "127.0.0.1", resolve));
  const previewPort = previewServer.address().port;

  try {
    const firstRun = await startApp({
      cwd: workspaceDir,
      persistSessions: true,
    });
    firstApp = firstRun.app;

    await waitForPort(firstRun.baseUrl, previewPort);

    const renameResponse = await fetch(`${firstRun.baseUrl}/api/ports/${previewPort}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Shared Preview",
      }),
    });

    assert.equal(renameResponse.status, 200);
    assert.equal((await renameResponse.json()).port.name, "Shared Preview");

    await firstApp.close();
    firstApp = null;

    const secondRun = await startApp({
      cwd: workspaceDir,
      persistSessions: true,
    });
    secondApp = secondRun.app;

    const ports = await waitForPort(secondRun.baseUrl, previewPort);
    const renamedPort = ports.find((entry) => entry.port === previewPort);
    assert.equal(renamedPort?.name, "Shared Preview");
    assert.equal(renamedPort?.customName, true);
  } finally {
    if (firstApp) {
      await firstApp.close();
    }

    if (secondApp) {
      await secondApp.close();
    }

    await new Promise((resolve) => previewServer.close(resolve));
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("workspace file api lists directories, edits text files, and serves image files", async () => {
  const workspaceDir = await createTempWorkspace("remote-vibes-files-");
  const graphsDir = path.join(workspaceDir, "graphs");
  const internalStateDir = path.join(workspaceDir, ".remote-vibes");
  const imagePath = path.join(graphsDir, "chart.png");
  const notePath = path.join(workspaceDir, "notes.txt");
  const internalStatePath = path.join(internalStateDir, "sessions.json");

  await mkdir(graphsDir, { recursive: true });
  await mkdir(internalStateDir, { recursive: true });
  await writeFile(imagePath, PNG_FIXTURE);
  await writeFile(notePath, "analysis notes\n", "utf8");
  await writeFile(internalStatePath, "{}\n", "utf8");

  const { app, baseUrl } = await startApp({ cwd: workspaceDir });

  try {
    const rootResponse = await fetch(`${baseUrl}/api/files?root=${encodeURIComponent(workspaceDir)}`);
    assert.equal(rootResponse.status, 200);
    const rootPayload = await rootResponse.json();

    assert.deepEqual(
      rootPayload.entries.map((entry) => ({ name: entry.name, type: entry.type })),
      [
        { name: "graphs", type: "directory" },
        { name: "notes.txt", type: "file" },
      ],
    );

    const nestedResponse = await fetch(
      `${baseUrl}/api/files?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent("graphs")}`,
    );
    assert.equal(nestedResponse.status, 200);
    const nestedPayload = await nestedResponse.json();
    assert.equal(nestedPayload.entries.length, 1);
    assert.equal(nestedPayload.entries[0].name, "chart.png");
    assert.equal(nestedPayload.entries[0].isImage, true);

    const textResponse = await fetch(
      `${baseUrl}/api/files/text?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent("notes.txt")}`,
    );
    assert.equal(textResponse.status, 200);
    const textPayload = await textResponse.json();
    assert.equal(textPayload.file.content, "analysis notes\n");

    const saveResponse = await fetch(`${baseUrl}/api/files/text`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        root: workspaceDir,
        path: "notes.txt",
        content: "updated notes\nwith details\n",
      }),
    });
    assert.equal(saveResponse.status, 200);
    assert.equal((await saveResponse.json()).file.content, "updated notes\nwith details\n");

    const verifyTextResponse = await fetch(
      `${baseUrl}/api/files/text?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent("notes.txt")}`,
    );
    assert.equal(verifyTextResponse.status, 200);
    assert.equal((await verifyTextResponse.json()).file.content, "updated notes\nwith details\n");

    const imageResponse = await fetch(
      `${baseUrl}/api/files/content?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent("graphs/chart.png")}`,
    );
    assert.equal(imageResponse.status, 200);
    assert.match(imageResponse.headers.get("content-type") || "", /image\/png/);

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    assert.equal(imageBuffer.compare(PNG_FIXTURE), 0);
  } finally {
    await app.close();
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("deleted persisted sessions do not come back after restart", async () => {
  const workspaceDir = await createTempWorkspace("remote-vibes-delete-");
  let firstApp = null;
  let secondApp = null;

  try {
    const firstRun = await startApp({
      cwd: workspaceDir,
      persistSessions: true,
    });
    firstApp = firstRun.app;

    const createResponse = await fetch(`${firstRun.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: "shell",
        name: "Delete Me",
        cwd: workspaceDir,
      }),
    });

    assert.equal(createResponse.status, 201);
    const { session } = await createResponse.json();

    const deleteResponse = await fetch(`${firstRun.baseUrl}/api/sessions/${session.id}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 200);

    await firstApp.close();
    firstApp = null;

    const secondRun = await startApp({
      cwd: workspaceDir,
      persistSessions: true,
    });
    secondApp = secondRun.app;

    const sessionsResponse = await fetch(`${secondRun.baseUrl}/api/sessions`);
    assert.equal(sessionsResponse.status, 200);
    const sessionsPayload = await sessionsResponse.json();
    assert.deepEqual(sessionsPayload.sessions, []);
  } finally {
    if (firstApp) {
      await firstApp.close();
    }

    if (secondApp) {
      await secondApp.close();
    }

    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("persisted sessions with missing workspaces stay visible and show restore failure", async () => {
  const workspaceDir = await createTempWorkspace("remote-vibes-missing-cwd-");
  const missingCwd = path.join(workspaceDir, "missing-workspace");
  const persistedSessionId = "persisted-missing-cwd";
  const createdAt = new Date().toISOString();

  await writePersistedSessions(workspaceDir, [
    {
      id: persistedSessionId,
      providerId: "shell",
      providerLabel: "Vanilla Shell",
      name: "Missing Workspace",
      cwd: missingCwd,
      shell: process.env.SHELL || "/bin/zsh",
      createdAt,
      updatedAt: createdAt,
      lastOutputAt: createdAt,
      status: "running",
      exitCode: null,
      exitSignal: null,
      cols: 90,
      rows: 24,
      buffer: "previous transcript\r\n",
      restoreOnStartup: true,
    },
  ]);

  const { app, baseUrl } = await startApp({
    cwd: workspaceDir,
    persistSessions: true,
  });

  try {
    const sessionsResponse = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(sessionsResponse.status, 200);
    const sessionsPayload = await sessionsResponse.json();

    assert.equal(sessionsPayload.sessions.length, 1);
    assert.equal(sessionsPayload.sessions[0].id, persistedSessionId);
    assert.equal(sessionsPayload.sessions[0].status, "exited");

    const websocket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws?sessionId=${persistedSessionId}`);
    const snapshot = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for missing-workspace snapshot."));
      }, 8_000);

      websocket.on("message", (chunk) => {
        const payload = JSON.parse(String(chunk));

        if (payload.type === "snapshot") {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });

    assert.match(snapshot.data, /previous transcript/);
    assert.match(snapshot.data, /could not restore the session/i);
    assert.match(snapshot.data, /Working directory does not exist/i);

    websocket.close();
    await once(websocket, "close");
  } finally {
    await app.close();
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("workspace file api rejects traversal and invalid entry types", async () => {
  const workspaceDir = await createTempWorkspace("remote-vibes-files-guards-");
  const graphsDir = path.join(workspaceDir, "graphs");
  const internalStateDir = path.join(workspaceDir, ".remote-vibes");
  const imagePath = path.join(graphsDir, "chart.png");
  const notePath = path.join(workspaceDir, "notes.txt");
  const internalStatePath = path.join(internalStateDir, "sessions.json");

  await mkdir(graphsDir, { recursive: true });
  await mkdir(internalStateDir, { recursive: true });
  await writeFile(imagePath, PNG_FIXTURE);
  await writeFile(notePath, "analysis notes\n", "utf8");
  await writeFile(internalStatePath, "{}\n", "utf8");

  const { app, baseUrl } = await startApp({ cwd: workspaceDir });

  try {
    const traversalResponse = await fetch(
      `${baseUrl}/api/files?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent("../")}`,
    );
    assert.equal(traversalResponse.status, 400);
    assert.match((await traversalResponse.json()).error, /escapes the selected workspace/i);

    const directoryAsFileResponse = await fetch(
      `${baseUrl}/api/files/content?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent("graphs")}`,
    );
    assert.equal(directoryAsFileResponse.status, 400);
    assert.match((await directoryAsFileResponse.json()).error, /not a file/i);

    const fileAsDirectoryResponse = await fetch(
      `${baseUrl}/api/files?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent("notes.txt")}`,
    );
    assert.equal(fileAsDirectoryResponse.status, 400);
    assert.match((await fileAsDirectoryResponse.json()).error, /not a directory/i);

    const internalDirectoryResponse = await fetch(
      `${baseUrl}/api/files?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(".remote-vibes")}`,
    );
    assert.equal(internalDirectoryResponse.status, 404);
    assert.match((await internalDirectoryResponse.json()).error, /not available in the workspace browser/i);

    const internalFileResponse = await fetch(
      `${baseUrl}/api/files/content?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent(".remote-vibes/sessions.json")}`,
    );
    assert.equal(internalFileResponse.status, 404);
    assert.match((await internalFileResponse.json()).error, /not available in the workspace browser/i);

    const imageAsTextResponse = await fetch(
      `${baseUrl}/api/files/text?root=${encodeURIComponent(workspaceDir)}&path=${encodeURIComponent("graphs/chart.png")}`,
    );
    assert.equal(imageAsTextResponse.status, 400);
    assert.match((await imageAsTextResponse.json()).error, /not editable as text/i);

    const internalTextResponse = await fetch(`${baseUrl}/api/files/text`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        root: workspaceDir,
        path: ".remote-vibes/sessions.json",
        content: "{}\n",
      }),
    });
    assert.equal(internalTextResponse.status, 404);
    assert.match((await internalTextResponse.json()).error, /not available in the workspace browser/i);
  } finally {
    await app.close();
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
