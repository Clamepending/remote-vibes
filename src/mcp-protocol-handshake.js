// Speak the MCP stdio protocol against a launched server long enough to
// learn whether it works:
//
//   1) spawn the resolved launch command
//   2) send `initialize` (JSON-RPC 2.0)
//   3) read the response, expect serverInfo + protocolVersion
//   4) send `notifications/initialized`
//   5) send `tools/list`
//   6) read the response, count tools
//   7) kill the process, report
//
// MCP stdio transport: newline-delimited JSON. Each message is a single
// line of JSON-RPC 2.0 terminated by \n. The 2024-11-05 protocol version
// is the most-used baseline at the time of writing.
//
// What this gives us beyond the dry-run launch tester:
//
//   - confirms the server speaks valid MCP, not just "didn't crash"
//   - confirms the configured token (if any) was accepted enough for
//     initialize to succeed (most servers fail initialize on missing/bad
//     tokens, though exact behavior varies)
//   - reports the tool count, which the UI can show inline
//
// What it still does NOT do:
//
//   - actually invoke a tool (would require knowing which one + args)
//   - confirm the upstream API is responsive

import { spawn as defaultSpawn } from "node:child_process";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_KILL_GRACE_MS = 500;
const STDIO_TAIL_BYTES = 800;

function tail(text, max) {
  if (typeof text !== "string") return "";
  return text.length <= max ? text : text.slice(text.length - max);
}

function stillTemplated(text) {
  return typeof text === "string" && /\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(text);
}

export async function handshakeWithLaunch(launch, options = {}) {
  const {
    spawnImpl = defaultSpawn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    env = process.env,
  } = options;

  if (!launch || typeof launch !== "object") {
    return { ok: false, status: "invalid-launch", error: "no launch provided" };
  }
  if (!launch.command || typeof launch.command !== "string") {
    return { ok: false, status: "invalid-launch", error: "launch has no command" };
  }
  const args = Array.isArray(launch.args) ? launch.args : [];
  const envValues = launch.env && typeof launch.env === "object" ? Object.values(launch.env) : [];
  if (stillTemplated(launch.command) || args.some(stillTemplated) || envValues.some(stillTemplated)) {
    return { ok: false, status: "unresolved-template", error: "launch still contains ${settingKey} templates" };
  }

  return await new Promise((resolve) => {
    let child;
    // `pendingBuf` is the not-yet-parsed portion of stdout (parser eats
    // it line-by-line). `stdoutSeen` is everything we ever saw on stdout
    // — used for the human-readable tail in the response.
    let pendingBuf = "";
    let stdoutSeen = "";
    let stderrBuf = "";
    let settled = false;

    // Pending JSON-RPC request id → handler
    const pending = new Map();
    let nextId = 1;

    const settle = (payload) => {
      if (settled) return;
      settled = true;
      try { child?.kill?.("SIGTERM"); } catch {}
      setTimeout(() => {
        try { child?.kill?.("SIGKILL"); } catch {}
      }, killGraceMs);
      resolve({
        ...payload,
        stdoutTail: tail(stdoutSeen, STDIO_TAIL_BYTES),
        stderrTail: tail(stderrBuf, STDIO_TAIL_BYTES),
      });
    };

    const overallTimer = setTimeout(() => {
      settle({ ok: false, status: "timeout", error: `no response within ${timeoutMs}ms` });
    }, timeoutMs);

    try {
      child = spawnImpl(launch.command, args, {
        env: { ...env, ...(launch.env || {}) },
      });
    } catch (err) {
      clearTimeout(overallTimer);
      resolve({ ok: false, status: "spawn-failed", error: err?.message || String(err) });
      return;
    }

    const send = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        // stdin may be closed if the child exited
      }
    };

    const sendRequest = (method, params) => new Promise((resolveRequest, rejectRequest) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolveRequest, rejectRequest });
      send({ jsonrpc: "2.0", id, method, params });
    });

    child.stdout?.on?.("data", (chunk) => {
      const text = chunk.toString();
      stdoutSeen += text;
      pendingBuf += text;
      // newline-delimited JSON-RPC. Process every complete line.
      let newlineIndex = pendingBuf.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = pendingBuf.slice(0, newlineIndex).trim();
        pendingBuf = pendingBuf.slice(newlineIndex + 1);
        if (line) {
          try {
            const message = JSON.parse(line);
            if (message && message.id !== undefined && pending.has(message.id)) {
              const handler = pending.get(message.id);
              pending.delete(message.id);
              handler.resolveRequest(message);
            }
          } catch {
            // Not JSON — log line, ignore. Server might emit plain
            // banner text before the JSON-RPC stream starts.
          }
        }
        newlineIndex = pendingBuf.indexOf("\n");
      }
    });

    child.stderr?.on?.("data", (chunk) => { stderrBuf += chunk.toString(); });

    child.on?.("error", (err) => {
      clearTimeout(overallTimer);
      settle({ ok: false, status: "spawn-failed", error: err?.message || String(err) });
    });

    child.on?.("exit", (code, signal) => {
      clearTimeout(overallTimer);
      // The handshake hadn't completed yet if we land here.
      settle({
        ok: false,
        status: "exited-during-handshake",
        exitCode: code,
        signal,
      });
    });

    // Drive the handshake.
    (async () => {
      try {
        const initResponse = await sendRequest("initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "vibe-research-handshake", version: "1.0.0" },
        });
        if (initResponse.error) {
          settle({
            ok: false,
            status: "init-failed",
            error: initResponse.error.message || String(initResponse.error.code),
          });
          return;
        }
        const serverInfo = initResponse.result?.serverInfo || {};
        // Send the post-init notification per the MCP spec.
        send({ jsonrpc: "2.0", method: "notifications/initialized" });

        let toolCount = 0;
        try {
          const toolsResponse = await sendRequest("tools/list", {});
          if (toolsResponse.error) {
            clearTimeout(overallTimer);
            settle({
              ok: false,
              status: "tools-list-failed",
              serverName: serverInfo.name,
              serverVersion: serverInfo.version,
              error: toolsResponse.error.message || String(toolsResponse.error.code),
            });
            return;
          }
          toolCount = Array.isArray(toolsResponse.result?.tools) ? toolsResponse.result.tools.length : 0;
        } catch {
          // tools/list timed out or threw — at least initialize worked.
          clearTimeout(overallTimer);
          settle({
            ok: false,
            status: "initialized",
            serverName: serverInfo.name,
            serverVersion: serverInfo.version,
          });
          return;
        }
        clearTimeout(overallTimer);
        settle({
          ok: true,
          status: "tools-listed",
          serverName: serverInfo.name,
          serverVersion: serverInfo.version,
          toolCount,
        });
      } catch (err) {
        // Most likely the timeout fired and rejected pending requests;
        // settle() inside the timer will already have run.
      }
    })();
  });
}

export const __internal = { MCP_PROTOCOL_VERSION };
