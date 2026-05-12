import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  buildOpenSwarmClientConfig,
  buildOpenSwarmRunArgs,
  inferOpenSwarmServerCommand,
  OpenSwarmApiSession,
} from "../src/openswarm-api-session.js";

function makeJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function waitForTurn(session) {
  return new Promise((resolve) => {
    session.once("turn-complete", resolve);
  });
}

test("buildOpenSwarmClientConfig routes model and provider keys", () => {
  const config = buildOpenSwarmClientConfig({
    env: {
      ANTHROPIC_API_KEY: "ant-secret",
      GOOGLE_API_KEY: "google-secret",
      OPENAI_API_KEY: "openai-secret",
    },
    model: "anthropic/claude-test",
  });

  assert.equal(config.model, "anthropic/claude-test");
  assert.equal(config.api_key, undefined);
  assert.deepEqual(config.litellm_keys, {
    anthropic: "ant-secret",
    gemini: "google-secret",
    google: "google-secret",
    openai: "openai-secret",
  });
});

test("OpenSwarmApiSession posts prompts with chat history and model override", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).endsWith("/openapi.json")) {
      return makeJsonResponse({ openapi: "3.1.0" });
    }
    return makeJsonResponse({
      response: "done",
      new_messages: [{ type: "message", role: "assistant", content: "done" }],
    });
  };
  const session = new OpenSwarmApiSession({
    env: {
      OPENAI_API_KEY: "openai-secret",
      OPENSWARM_APP_TOKEN: "app-token",
      VIBE_RESEARCH_OPENSWARM_MODEL: "gpt-5.2",
      VIBE_RESEARCH_OPENSWARM_TRANSPORT: "api",
    },
    fetchImpl,
  });

  session.send("make a deck");
  await waitForTurn(session);

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "http://127.0.0.1:8080/open-swarm/get_response");
  const requestBody = JSON.parse(calls[1].options.body);
  assert.equal(requestBody.message, "make a deck");
  assert.equal(requestBody.client_config.model, "gpt-5.2");
  assert.equal(requestBody.client_config.api_key, "openai-secret");
  assert.equal(calls[1].options.headers.Authorization, "Bearer app-token");
  assert.equal(session.chatHistory.length, 1);
  assert.equal(session.entries.at(-1).text, "done");

  session.send("continue");
  await waitForTurn(session);
  const secondRequestBody = JSON.parse(calls[3].options.body);
  assert.equal(secondRequestBody.chat_history.length, 1);
});

test("buildOpenSwarmRunArgs uses CLI JSON mode, model, session, files, and permissions", () => {
  assert.deepEqual(
    buildOpenSwarmRunArgs({
      cwd: "/tmp/work",
      model: "huggingface/zai-org/GLM-4.7-Flash",
      sessionId: "ses_test",
      prompt: "hello",
      files: ["/tmp/input.png"],
      agent: "build",
      bypassPermissions: true,
    }),
    [
      "run",
      "--format",
      "json",
      "--dir",
      "/tmp/work",
      "--model",
      "huggingface/zai-org/GLM-4.7-Flash",
      "--session",
      "ses_test",
      "--agent",
      "build",
      "--dangerously-skip-permissions",
      "--file",
      "/tmp/input.png",
      "hello",
    ],
  );
});

test("OpenSwarmApiSession consumes OpenSwarm CLI JSON events", async () => {
  const spawns = [];
  const spawnFn = (cmd, args, options) => {
    spawns.push({ cmd, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({
        type: "step_start",
        sessionID: "ses_cli",
        part: { type: "step-start" },
      })}\n`);
      child.stdout.write(`${JSON.stringify({
        type: "text",
        sessionID: "ses_cli",
        part: {
          type: "text",
          messageID: "msg_1",
          text: "done ![plot](/tmp/chart.png) and [deck](/tmp/deck.pptx)",
        },
      })}\n`);
      child.stdout.write(`${JSON.stringify({
        type: "step_finish",
        sessionID: "ses_cli",
        part: { type: "step-finish", tokens: { total: 12, input: 10, output: 2 } },
      })}\n`);
      child.emit("close", 0, null);
    });
    return child;
  };

  const session = new OpenSwarmApiSession({
    cwd: "/tmp/work",
    env: {
      VIBE_RESEARCH_OPENSWARM_MODEL: "huggingface/zai-org/GLM-4.7-Flash",
      VIBE_RESEARCH_OPENSWARM_TRANSPORT: "cli",
    },
    provider: { launchCommand: "openswarm" },
    spawnFn,
  });

  session.send("hello");
  await waitForTurn(session);

  assert.equal(spawns[0].cmd, "openswarm");
  assert.deepEqual(spawns[0].args.slice(0, 7), [
    "run",
    "--format",
    "json",
    "--dir",
    "/tmp/work",
    "--model",
    "huggingface/zai-org/GLM-4.7-Flash",
  ]);
  assert.equal(session.openSwarmSessionId, "ses_cli");
  const assistant = session.entries.find((entry) => entry.kind === "assistant");
  assert.match(assistant.text, /done/);
  assert.deepEqual(assistant.imageRefs, ["/tmp/chart.png"]);
  assert.equal(session.entries.at(-1).label, "Usage");
});

test("OpenSwarmApiSession sends image attachments as OpenSwarm CLI files", async () => {
  const spawns = [];
  const spawnFn = (cmd, args) => {
    spawns.push({ cmd, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({
        type: "text",
        sessionID: "ses_files",
        part: { type: "text", messageID: "msg_1", text: "ok" },
      })}\n`);
      child.emit("close", 0, null);
    });
    return child;
  };
  const session = new OpenSwarmApiSession({
    cwd: "/tmp/work",
    env: { VIBE_RESEARCH_OPENSWARM_TRANSPORT: "cli" },
    spawnFn,
  });

  await session.sendWithImages("inspect", [{ absolutePath: "/tmp/input.png" }]);
  await waitForTurn(session);

  assert.ok(spawns[0].args.includes("--file"));
  assert.equal(spawns[0].args[spawns[0].args.indexOf("--file") + 1], "/tmp/input.png");
});

test("inferOpenSwarmServerCommand respects explicit command and disabled autostart", () => {
  assert.deepEqual(
    inferOpenSwarmServerCommand("/missing/openswarm", {
      VIBE_RESEARCH_OPENSWARM_SERVER_COMMAND: "python server.py",
    }),
    { command: "python server.py", cwd: "" },
  );
  assert.deepEqual(
    inferOpenSwarmServerCommand("/missing/openswarm", {
      VIBE_RESEARCH_OPENSWARM_AUTOSTART_SERVER: "0",
    }),
    { command: "", cwd: "" },
  );
});
