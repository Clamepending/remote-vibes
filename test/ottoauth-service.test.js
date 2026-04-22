import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { createVibeResearchApp } from "../src/create-app.js";
import { OttoAuthService } from "../src/ottoauth-service.js";
import { SleepPreventionService } from "../src/sleep-prevention.js";

const execFileAsync = promisify(execFile);

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function createFakeOttoAuthFetch(calls) {
  let taskStatusChecks = 0;
  let submitCount = 0;

  return async function fakeOttoAuthFetch(url, options = {}) {
    const requestUrl = new URL(String(url));
    const body = options.body ? JSON.parse(String(options.body)) : {};
    calls.push({ body, method: options.method || "GET", pathname: requestUrl.pathname });

    if (requestUrl.pathname === "/api/services/computeruse/submit-task") {
      submitCount += 1;
      assert.equal(body.username, "codex_agent");
      assert.equal(body.private_key, "pk_test");
      assert.equal(body.task_prompt.includes("Pad see ew"), true);
      assert.equal(body.website_url, "https://www.snackpass.co/");
      assert.equal(body.max_charge_cents, 2000);
      return jsonResponse({
        ok: true,
        human_credit_balance: 5000,
        run_id: `run_${submitCount}`,
        task: {
          id: `task-${submitCount}`,
          status: "queued",
          billing_status: "pending",
        },
      });
    }

    if (requestUrl.pathname.startsWith("/api/services/computeruse/tasks/")) {
      taskStatusChecks += 1;
      assert.equal(body.username, "codex_agent");
      assert.equal(body.private_key, "pk_test");
      return jsonResponse({
        task: {
          id: requestUrl.pathname.split("/").at(-1),
          status: taskStatusChecks >= 1 ? "completed" : "running",
          billing_status: "completed",
          summary: "Order submitted.",
        },
      });
    }

    return jsonResponse({ error: `unexpected ${requestUrl.pathname}` }, 404);
  };
}

test("OttoAuth service creates hosted computeruse tasks and exposes live subagents", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-ottoauth-service-"));
  const calls = [];
  const service = new OttoAuthService({
    fetchImpl: createFakeOttoAuthFetch(calls),
    settings: {
      ottoAuthBaseUrl: "https://ottoauth.vercel.app",
      ottoAuthEnabled: true,
      ottoAuthPrivateKey: "pk_test",
      ottoAuthUsername: "codex_agent",
    },
    stateDir: workspaceDir,
  });

  try {
    await service.initialize();
    const task = await service.createTask({
      callerSessionId: "session-1",
      maxChargeCents: 2000,
      taskPrompt: "Please order Pad see ew for pickup.",
      title: "Snackpass pickup",
      url: "https://www.snackpass.co/",
    });

    assert.equal(task.serviceId, "computeruse");
    assert.equal(task.hostedTaskId, "task-1");
    assert.equal(task.orderUrl, "https://ottoauth.vercel.app/orders/task-1");
    assert.equal(service.listSubagentsForSession("session-1").length, 1);
    assert.equal(service.listSubagentsForSession("session-1")[0].source, "ottoauth");

    const refreshed = await service.refreshTask(task.id);
    assert.equal(refreshed.status, "completed");
    assert.equal(service.listSubagentsForSession("session-1").length, 0);
    assert.equal(calls.length, 2);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("vr-ottoauth starts a hosted task under the caller session", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "vibe-research-ottoauth-app-"));
  const stateDir = path.join(workspaceDir, ".vibe-research");
  const calls = [];

  const app = await createVibeResearchApp({
    host: "127.0.0.1",
    port: 0,
    cwd: workspaceDir,
    stateDir,
    persistSessions: false,
    persistentTerminals: false,
    ottoAuthServiceFactory: (settings, { stateDir: serviceStateDir }) =>
      new OttoAuthService({
        fetchImpl: createFakeOttoAuthFetch(calls),
        settings,
        stateDir: serviceStateDir,
      }),
    sleepPreventionFactory: (settings) =>
      new SleepPreventionService({
        enabled: settings.preventSleepEnabled,
        platform: "test",
      }),
  });
  const baseUrl = `http://127.0.0.1:${app.config.port}`;

  try {
    const setupResponse = await fetch(`${baseUrl}/api/ottoauth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        privateKey: "pk_test",
        username: "codex_agent",
      }),
    });
    assert.equal(setupResponse.status, 200);
    const setupPayload = await setupResponse.json();
    assert.equal(setupPayload.settings.ottoAuthPrivateKey, "");
    assert.equal(setupPayload.settings.ottoAuthPrivateKeyConfigured, true);

    const createParentResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "shell", name: "Caller" }),
    });
    assert.equal(createParentResponse.status, 201);
    const { session: parentSession } = await createParentResponse.json();

    const serverInfo = JSON.parse(await readFile(path.join(stateDir, "server.json"), "utf8"));
    const createTaskResponse = await fetch(`${baseUrl}/api/ottoauth/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vibe-research-ottoauth-token": serverInfo.ottoAuthToken,
      },
      body: JSON.stringify({
        callerSessionId: parentSession.id,
        maxChargeCents: 2000,
        taskPrompt: "Please order Pad see ew for pickup.",
        url: "https://www.snackpass.co/",
      }),
    });
    assert.equal(createTaskResponse.status, 201);
    const { task } = await createTaskResponse.json();

    const parentResponse = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(parentResponse.status, 200);
    const { sessions } = await parentResponse.json();
    const serializedParent = sessions.find((entry) => entry.id === parentSession.id);
    assert.ok(serializedParent);
    const ottoAuthSubagent = serializedParent.subagents.find((entry) => entry.ottoAuthSessionId === task.id);
    assert.equal(ottoAuthSubagent.source, "ottoauth");
    assert.equal(ottoAuthSubagent.status, "working");

    const { stdout: helperStdout } = await execFileAsync(
      process.execPath,
      [
        path.join(process.cwd(), "bin", "vr-ottoauth"),
        "--task",
        "Please order Pad see ew for pickup.",
        "--url",
        "https://www.snackpass.co/",
        "--max-charge-cents",
        "2000",
        "--wait",
        "--json",
      ],
      {
        cwd: workspaceDir,
        env: {
          ...process.env,
          VIBE_RESEARCH_ROOT: stateDir,
          VIBE_RESEARCH_SESSION_ID: parentSession.id,
        },
        timeout: 8_000,
      },
    );
    const helperPayload = JSON.parse(helperStdout);
    assert.equal(helperPayload.status, "completed");
    assert.equal(helperPayload.serviceId, "computeruse");
    assert.match(helperPayload.orderUrl, /https:\/\/ottoauth\.vercel\.app\/orders\/task-/);
  } finally {
    await app.close();
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
