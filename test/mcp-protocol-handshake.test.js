// Unit tests for src/mcp-protocol-handshake.js. Uses a stub spawn that
// drives a fake MCP server: tests inject behavior by parsing requests
// off stdin and emitting canned responses on stdout.

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { handshakeWithLaunch } from "../src/mcp-protocol-handshake.js";

// Stub child that holds an outgoing-line buffer (writes to stdin) and an
// incoming response queue (we call .pushStdout(json) to simulate server
// replies). Pushed messages are wrapped in newline-delimited JSON.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = null;
  child.kill = (signal) => { child.killed = signal; };
  // Capture stdin writes so the test can drive responses based on what
  // the SUT sent.
  const writes = [];
  child.stdin = {
    write: (chunk) => {
      writes.push(String(chunk));
      // Parse newline-delimited JSON-RPC requests off the write stream
      // and let the test inspect them via child.requests.
      const trimmed = String(chunk).trim();
      if (trimmed) {
        try {
          const message = JSON.parse(trimmed);
          child._onRequest?.(message, child);
        } catch {}
      }
    },
  };
  child.writes = writes;
  child.respond = (message) => {
    child.stdout.emit("data", Buffer.from(`${JSON.stringify(message)}\n`));
  };
  return child;
}

test("handshake: tools-listed — server responds initialize then tools/list", async () => {
  const child = fakeChild();
  child._onRequest = (msg) => {
    if (msg.method === "initialize") {
      child.respond({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "demo-server", version: "0.1.0" },
        },
      });
    } else if (msg.method === "tools/list") {
      child.respond({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [
            { name: "read_file", description: "read a file" },
            { name: "write_file", description: "write a file" },
            { name: "list_dir", description: "list directory" },
          ],
        },
      });
    }
  };
  const result = await handshakeWithLaunch(
    { command: "node", args: ["server.js"] },
    { spawnImpl: () => child, timeoutMs: 1000 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "tools-listed");
  assert.equal(result.serverName, "demo-server");
  assert.equal(result.serverVersion, "0.1.0");
  assert.equal(result.toolCount, 3);
});

test("handshake: init-failed — initialize returns an error", async () => {
  const child = fakeChild();
  child._onRequest = (msg) => {
    if (msg.method === "initialize") {
      child.respond({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32600, message: "missing api token" },
      });
    }
  };
  const result = await handshakeWithLaunch(
    { command: "node" },
    { spawnImpl: () => child, timeoutMs: 1000 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "init-failed");
  assert.match(result.error, /missing api token/);
});

test("handshake: tools-list-failed — initialize ok, tools/list errors", async () => {
  const child = fakeChild();
  child._onRequest = (msg) => {
    if (msg.method === "initialize") {
      child.respond({
        jsonrpc: "2.0",
        id: msg.id,
        result: { serverInfo: { name: "ok-server", version: "1.0" } },
      });
    } else if (msg.method === "tools/list") {
      child.respond({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "method not supported" },
      });
    }
  };
  const result = await handshakeWithLaunch(
    { command: "node" },
    { spawnImpl: () => child, timeoutMs: 1000 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "tools-list-failed");
  assert.equal(result.serverName, "ok-server");
});

test("handshake: timeout — server never responds", async () => {
  const child = fakeChild();
  // Don't register _onRequest, so the SUT's initialize hangs.
  const result = await handshakeWithLaunch(
    { command: "silent" },
    { spawnImpl: () => child, timeoutMs: 80, killGraceMs: 20 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "timeout");
});

test("handshake: exited-during-handshake — server exits before responding", async () => {
  const child = fakeChild();
  setTimeout(() => child.emit("exit", 1, null), 10);
  const result = await handshakeWithLaunch(
    { command: "broken" },
    { spawnImpl: () => child, timeoutMs: 500, killGraceMs: 20 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "exited-during-handshake");
  assert.equal(result.exitCode, 1);
});

test("handshake: spawn-failed — synchronous throw", async () => {
  const result = await handshakeWithLaunch(
    { command: "x" },
    { spawnImpl: () => { throw new Error("ENOENT: no such file"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "spawn-failed");
  assert.match(result.error, /ENOENT/);
});

test("handshake: spawn-failed — async error event", async () => {
  const child = fakeChild();
  setTimeout(() => child.emit("error", new Error("EACCES")), 5);
  const result = await handshakeWithLaunch(
    { command: "noperm" },
    { spawnImpl: () => child, timeoutMs: 500, killGraceMs: 20 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "spawn-failed");
});

test("handshake: rejects unresolved templates", async () => {
  const result = await handshakeWithLaunch({ command: "node", env: { TOKEN: "${apiKey}" } });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unresolved-template");
});

test("handshake: rejects null / no-command launches", async () => {
  assert.equal((await handshakeWithLaunch(null)).status, "invalid-launch");
  assert.equal((await handshakeWithLaunch({})).status, "invalid-launch");
});

test("handshake: tolerates non-JSON banner output before JSON-RPC stream", async () => {
  const child = fakeChild();
  // Many MCP servers print a startup banner to stdout before they begin
  // emitting JSON-RPC. The handshake should ignore non-JSON lines.
  // Emit the banner inline with the initialize response so it lands
  // before the handshake completes (otherwise the SIGTERM races).
  child._onRequest = (msg) => {
    if (msg.method === "initialize") {
      child.stdout.emit("data", Buffer.from("Booting server v1.0\n"));
      child.stdout.emit("data", Buffer.from("Loaded plugins: foo, bar\n"));
      child.respond({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "x", version: "1" } } });
    } else if (msg.method === "tools/list") {
      child.respond({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "t" }] } });
    }
  };
  const result = await handshakeWithLaunch(
    { command: "noisy-server" },
    { spawnImpl: () => child, timeoutMs: 1000 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.toolCount, 1);
  assert.match(result.stdoutTail, /Booting server v1\.0/);
});

test("handshake: SUT sends notifications/initialized after initialize", async () => {
  const child = fakeChild();
  let sawInitNotification = false;
  child._onRequest = (msg) => {
    if (msg.method === "initialize") {
      child.respond({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "x", version: "1" } } });
    } else if (msg.method === "notifications/initialized") {
      sawInitNotification = true;
    } else if (msg.method === "tools/list") {
      child.respond({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } });
    }
  };
  await handshakeWithLaunch(
    { command: "x" },
    { spawnImpl: () => child, timeoutMs: 1000 },
  );
  assert.equal(sawInitNotification, true, "spec requires the post-init notification");
});

test("handshake: chunked stdout where one frame contains multiple JSON lines", async () => {
  // MCP servers often pipeline several JSON-RPC messages into a single
  // stdout chunk. Make sure the parser splits them correctly.
  const child = fakeChild();
  child._onRequest = (msg) => {
    if (msg.method === "initialize") {
      // Send multiple lines in one chunk: an unrelated notification + the
      // init response, separated by \n.
      const noise = JSON.stringify({ jsonrpc: "2.0", method: "notifications/log", params: { level: "info", text: "hi" } });
      const reply = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "x", version: "1" } } });
      child.stdout.emit("data", Buffer.from(`${noise}\n${reply}\n`));
    } else if (msg.method === "tools/list") {
      child.respond({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } });
    }
  };
  const result = await handshakeWithLaunch(
    { command: "x" },
    { spawnImpl: () => child, timeoutMs: 1000 },
  );
  assert.equal(result.ok, true);
});
