import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibeResearchApp } from "../src/create-app.js";
import { createProject } from "../src/research/init.js";
import { runResearchAutopilot } from "../src/research/autopilot.js";
import { SleepPreventionService } from "../src/sleep-prevention.js";

const WORKSPACE_LIBRARY_RELATIVE = path.join("vibe-research", "buildings", "library");

async function startCanaryApp({ workspaceDir, stateDir, codeDir }) {
  return createVibeResearchApp({
    host: "127.0.0.1",
    port: 0,
    cwd: workspaceDir,
    stateDir,
    defaultSessionCwd: codeDir,
    persistSessions: false,
    persistentTerminals: false,
    sleepPreventionFactory: (settings) =>
      new SleepPreventionService({ enabled: settings.preventSleepEnabled, platform: "test" }),
    systemMetricsSampleIntervalMs: 0,
  });
}

test("real coding agent can review and unblock a bounded autopilot cycle", { timeout: 300_000 }, async (t) => {
  if (process.env.VIBE_RESEARCH_REAL_CODING_AGENT_CANARY !== "1") {
    t.skip("Set VIBE_RESEARCH_REAL_CODING_AGENT_CANARY=1 to launch a real coding-agent provider.");
    return;
  }

  const providerId = String(process.env.VIBE_RESEARCH_REAL_CODING_AGENT_PROVIDER || "codex").trim() || "codex";
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "vr-real-agent-canary-"));
  const stateDir = path.join(workspaceDir, ".vibe-research");
  const codeDir = path.join(workspaceDir, "code");
  const libraryRoot = path.join(workspaceDir, WORKSPACE_LIBRARY_RELATIVE);
  const projectName = "real-agent-canary";
  const projectDir = path.join(libraryRoot, "projects", projectName);
  const prevWorkspaceDir = process.env.VIBE_RESEARCH_WORKSPACE_DIR;
  process.env.VIBE_RESEARCH_WORKSPACE_DIR = workspaceDir;
  let app;

  try {
    await mkdir(codeDir, { recursive: true });
    await createProject({
      projectsDir: path.join(libraryRoot, "projects"),
      name: projectName,
      goal: "Verify a real coding agent can inspect a cycle artifact and resolve the Agent Inbox gate without direct test PATCHing.",
      codeRepoUrl: "https://github.com/example/real-agent-canary-code",
      successCriteria: [
        "autopilot starts a queued move",
        "a real coding-agent reviewer resolves the cycle card",
        "the durable review line lets autopilot continue",
      ],
      ranking: { kind: "quantitative", metric: "score", direction: "higher" },
      queueRows: [
        {
          move: "agent-reviewed-cycle",
          startingPoint: "main",
          why: "prove real reviewer-agent handoff",
        },
      ],
      force: true,
    });

    app = await startCanaryApp({ workspaceDir, stateDir, codeDir });
    const baseUrl = `http://127.0.0.1:${app.config.port}`;
    const provider = app.config.providers.find((entry) => entry.id === providerId);
    if (!provider?.available) {
      t.skip(`${providerId} provider is not available on this host.`);
      return;
    }

    const first = await runResearchAutopilot({
      projectDir,
      maxSteps: 1,
      commandText: "node -e \"console.log('score=0.660')\"",
      metricRegex: "score=([0-9.]+)",
      change: "real coding-agent reviewed seed",
      seed: "real-agent-1",
      askHuman: true,
      waitHuman: true,
      timeoutMs: Number(process.env.VIBE_RESEARCH_REAL_CODING_AGENT_TIMEOUT_MS || 180_000),
      agentTownApi: `${baseUrl}/api/agent-town`,
      agentReviewProvider: providerId,
      agentReviewName: `Real ${providerId} Reviewer Canary`,
      codeCwd: codeDir,
      commandTimeoutMs: 10_000,
    });

    if (first.stopReason !== "max-steps") {
      const sessionsPayload = await (await fetch(`${baseUrl}/api/sessions`)).json();
      const actionItemsPayload = await (await fetch(`${baseUrl}/api/agent-town/action-items`)).json();
      const narratives = [];
      for (const session of sessionsPayload.sessions || []) {
        if (session.providerId !== providerId) continue;
        const narrativeResponse = await fetch(`${baseUrl}/api/sessions/${session.id}/narrative`);
        narratives.push({
          id: session.id,
          name: session.name,
          status: session.status,
          narrative: narrativeResponse.ok ? await narrativeResponse.json() : await narrativeResponse.text(),
        });
      }
      console.log(JSON.stringify({
        stopReason: first.stopReason,
        stopSummary: first.stopSummary,
        actions: first.actions,
        sessions: (sessionsPayload.sessions || []).map((session) => ({
          id: session.id,
          name: session.name,
          providerId: session.providerId,
          status: session.status,
        })),
        actionItems: actionItemsPayload.actionItems,
        narratives,
      }, null, 2));
    }

    assert.equal(first.stopReason, "max-steps");
    assert.equal(first.actions[0].plannedAction, "orchestrator-run-next");
    assert.equal(first.actions[0].result.kind, "run-next");
    assert.equal(first.actions[0].result.cycle.metric, "0.660");
    assert.equal(first.actions[0].result.cycle.reviewWait.satisfied, true);
    assert.equal(first.actions[0].result.cycle.reviewDecision.action, "continue");
    assert.equal(first.actions[0].result.cycle.agentReviewSession.providerId, providerId);

    const second = await runResearchAutopilot({
      projectDir,
      maxSteps: 1,
      commandText: "node -e \"console.log('score=0.670')\"",
      metricRegex: "score=([0-9.]+)",
      change: "autopilot continued after real reviewer approval",
      seed: "real-agent-2",
      codeCwd: codeDir,
      commandTimeoutMs: 10_000,
    });

    assert.equal(second.actions[0].plannedAction, "run-cycle");
    assert.equal(second.actions[0].result.kind, "cycle");
    assert.equal(second.actions[0].result.cycle.metric, "0.670");
  } finally {
    if (app) await app.close();
    if (prevWorkspaceDir === undefined) delete process.env.VIBE_RESEARCH_WORKSPACE_DIR;
    else process.env.VIBE_RESEARCH_WORKSPACE_DIR = prevWorkspaceDir;
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
