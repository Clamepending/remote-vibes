import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import test from "node:test";
import { updateResearchState } from "../src/research/brief.js";
import {
  runResearchAutopilot,
  stepResearchAutopilot,
  __internal,
} from "../src/research/autopilot.js";

const VR_RESEARCH_AUTOPILOT = path.resolve("bin/vr-research-autopilot");

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

function runCli(args, { cwd, env = {}, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", [VR_RESEARCH_AUTOPILOT, ...args], {
      cwd,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    };
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} settle(null); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { stderr += `\n[spawn error] ${error.message}`; settle(null); });
    child.on("exit", (code) => settle(code));
  });
}

function writeProjectReadme(dir, { active = "", queue = "" } = {}) {
  writeFileSync(join(dir, "README.md"), `# example

## GOAL

Find a better setting.

## CODE REPO

https://github.com/example/widget

## SUCCESS CRITERIA

- score improves.

## RANKING CRITERION

quantitative: score (higher is better)

## LEADERBOARD

| rank | result | branch | commit | score / verdict |
|------|--------|--------|--------|-----------------|

## INSIGHTS

_none_

## ACTIVE

| move | result doc | branch | agent | started |
|------|-----------|--------|-------|---------|
${active}

## QUEUE

| move | starting-point | why |
|------|----------------|-----|
${queue}

## LOG

See [LOG.md](./LOG.md) - append-only event history.
`);
  writeFileSync(join(dir, "LOG.md"), "# example - LOG\n\n| date | event | slug or ref | one-line summary | link |\n|------|-------|-------------|------------------|------|\n");
}

async function makeProject(prefix = "vr-autopilot", { active = true, queue = "" } = {}) {
  const dir = tmp(prefix);
  await mkdir(join(dir, "results"), { recursive: true });
  writeProjectReadme(dir, {
    active: active
      ? "| first-move | [first-move](results/first-move.md) | [r/first-move](https://github.com/example/widget/tree/r/first-move) | 0 | 2026-04-30 |\n"
      : "",
    queue,
  });
  return dir;
}

function writeResult(dir, { reviewLine = "" } = {}) {
  writeFileSync(join(dir, "results", "first-move.md"), `# first-move

## TAKEAWAY

_pending_

## STATUS

active

## STARTING POINT

https://github.com/example/widget/tree/main

## BRANCH

https://github.com/example/widget/tree/r/first-move

## AGENT

0

## Question

Does this move improve score?

## Hypothesis

50% prior; falsifier is no improvement.

## Research grounding

Toy fixture.

## Experiment design

Run toy command.

## Cycles

- cycle 1 @abcdef0: seed 1 -> metric=0.81. qual: completed.

## Results

- cycle 1: metric=0.81; artifact \`artifacts/first-move/cycle-1.log\`.

## Agent canvas

_none_

## Analysis

Toy analysis.
${reviewLine}

## Reproducibility

- cycle 1: command \`node toy.js\`; git \`abcdef0\`.

## Leaderboard verdict

Decision: pending

## Queue updates

_none_
`);
}

test("extractReviewDecisions parses durable cycle review lines", () => {
  const decisions = __internal.extractReviewDecisions("- cycle 2 review: rerun; resolution=rerun; note=Need one more seed; action item `research-cycle-x-2`.");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].cycleIndex, 2);
  assert.equal(decisions[0].action, "rerun");
  assert.equal(decisions[0].resolutionNote, "Need one more seed");
  assert.equal(decisions[0].actionItemId, "research-cycle-x-2");
});

test("stepResearchAutopilot routes rerun decisions to a rerun cycle command", async () => {
  const dir = await makeProject("vr-autopilot-rerun");
  try {
    writeResult(dir, {
      reviewLine: "- cycle 1 review: rerun; resolution=rerun; note=Need one more seed; action item `research-cycle-first-move-1`.",
    });
    await updateResearchState({ projectDir: dir, phase: "experiment", summary: "active move" });
    const report = await stepResearchAutopilot({
      projectDir: dir,
      commandText: "node train.js",
      waitHuman: true,
      agentTownApi: "http://agent-town.test/api/agent-town",
      agentReviewProvider: "codex",
      agentReviewName: "Review Bot",
    });
    assert.equal(report.recommendation.action, "rerun-cycle");
    assert.equal(report.decision.action, "rerun");
    assert.match(report.nextCommand, /vr-research-runner/);
    assert.match(report.nextCommand, /--kind rerun/);
    assert.match(report.nextCommand, /node train\.js/);
    assert.match(report.nextCommand, /--wait-human/);
    assert.match(report.nextCommand, /agent-town\.test/);
    assert.match(report.nextCommand, /--agent-review-provider codex/);
    assert.match(report.nextCommand, /--agent-review-name 'Review Bot'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stepResearchAutopilot can apply synthesize and brainstorm phase transitions", async () => {
  const synthesizeDir = await makeProject("vr-autopilot-synthesis");
  const brainstormDir = await makeProject("vr-autopilot-brainstorm");
  try {
    writeResult(synthesizeDir);
    writeResult(brainstormDir);
    await updateResearchState({ projectDir: synthesizeDir, phase: "experiment", summary: "active move" });
    await updateResearchState({ projectDir: brainstormDir, phase: "experiment", summary: "active move" });

    const synthesize = await stepResearchAutopilot({
      projectDir: synthesizeDir,
      decision: "synthesize",
      apply: true,
    });
    assert.equal(synthesize.recommendation.action, "finish-move");
    assert.equal(synthesize.phaseUpdate.phase, "synthesis");
    assert.match(synthesize.nextCommand, /finish/);
    assert.match(synthesize.nextCommand, /--apply/);

    const brainstorm = await stepResearchAutopilot({
      projectDir: brainstormDir,
      decision: "brainstorm",
      apply: true,
    });
    assert.equal(brainstorm.recommendation.action, "return-to-ideation");
    assert.equal(brainstorm.phaseUpdate.phase, "ideation");
    assert.match(brainstorm.nextCommand, /vr-research-orchestrator/);
  } finally {
    rmSync(synthesizeDir, { recursive: true, force: true });
    rmSync(brainstormDir, { recursive: true, force: true });
  }
});

test("stepResearchAutopilot delegates no-active projects to the orchestrator", async () => {
  const dir = await makeProject("vr-autopilot-delegate", {
    active: false,
    queue: "| queued-move | main | run next queued work |\n",
  });
  try {
    const report = await stepResearchAutopilot({
      projectDir: dir,
      commandText: "node eval.js",
    });
    assert.equal(report.delegated, "orchestrator");
    assert.equal(report.recommendation.action, "orchestrator-run-next");
    assert.equal(report.orchestrator.recommendation.slug, "queued-move");
    assert.match(report.nextCommand, /node eval\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runResearchAutopilot executes a queued move when a command is supplied", async () => {
  const dir = await makeProject("vr-autopilot-run-queue", {
    active: false,
    queue: "| queued-move | main | run next queued work |\n",
  });
  try {
    const report = await runResearchAutopilot({
      projectDir: dir,
      commandText: "node -e \"console.log('score=0.42')\"",
      metricRegex: "score=([0-9.]+)",
      maxSteps: 1,
    });
    assert.equal(report.stopReason, "max-steps");
    assert.equal(report.actions.length, 1);
    assert.equal(report.actions[0].plannedAction, "orchestrator-run-next");
    assert.equal(report.actions[0].result.kind, "run-next");
    assert.equal(report.actions[0].result.claim.slug, "queued-move");
    assert.equal(report.actions[0].result.cycle.metric, "0.42");

    const readme = readFileSync(join(dir, "README.md"), "utf8");
    assert.match(readme, /\| queued-move \| \[queued-move\]\(results\/queued-move\.md\)/);
    const resultDoc = readFileSync(join(dir, "results", "queued-move.md"), "utf8");
    assert.match(resultDoc, /cycle 1.*metric=0\.42/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runResearchAutopilot stops before execution when a command is missing", async () => {
  const dir = await makeProject("vr-autopilot-run-missing-command", {
    active: false,
    queue: "| queued-move | main | run next queued work |\n",
  });
  try {
    const report = await runResearchAutopilot({ projectDir: dir, maxSteps: 1 });
    assert.equal(report.stopReason, "missing-command");
    assert.equal(report.actions[0].result.reason, "missing-command");
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    assert.match(readme, /\| queued-move \| main \| run next queued work \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runResearchAutopilot stops before gated execution when Agent Town API is missing", async () => {
  const dir = await makeProject("vr-autopilot-run-missing-agent-town", {
    active: false,
    queue: "| gated-move | main | needs review gate |\n",
  });
  const previousApi = process.env.VIBE_RESEARCH_AGENT_TOWN_API;
  const previousLegacyApi = process.env.REMOTE_VIBES_AGENT_TOWN_API;
  try {
    delete process.env.VIBE_RESEARCH_AGENT_TOWN_API;
    delete process.env.REMOTE_VIBES_AGENT_TOWN_API;
    const report = await runResearchAutopilot({
      projectDir: dir,
      commandText: "node -e \"console.log('score=0.50')\"",
      metricRegex: "score=([0-9.]+)",
      maxSteps: 1,
      askHuman: true,
    });
    assert.equal(report.stopReason, "missing-agent-town-api");
    assert.equal(report.actions[0].result.reason, "missing-agent-town-api");
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    assert.match(readme, /\| gated-move \| main \| needs review gate \|/);
  } finally {
    if (previousApi === undefined) delete process.env.VIBE_RESEARCH_AGENT_TOWN_API;
    else process.env.VIBE_RESEARCH_AGENT_TOWN_API = previousApi;
    if (previousLegacyApi === undefined) delete process.env.REMOTE_VIBES_AGENT_TOWN_API;
    else process.env.REMOTE_VIBES_AGENT_TOWN_API = previousLegacyApi;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runResearchAutopilot executes rerun decisions as rerun cycles", async () => {
  const dir = await makeProject("vr-autopilot-run-rerun");
  try {
    writeResult(dir, {
      reviewLine: "- cycle 1 review: rerun; resolution=rerun; note=Need one more seed; action item `research-cycle-first-move-1`.",
    });
    await updateResearchState({ projectDir: dir, phase: "experiment", summary: "active move" });
    const report = await runResearchAutopilot({
      projectDir: dir,
      commandText: "node -e \"console.log('score=0.43')\"",
      metricRegex: "score=([0-9.]+)",
      maxSteps: 1,
    });
    assert.equal(report.actions[0].plannedAction, "rerun-cycle");
    assert.equal(report.actions[0].result.kind, "cycle");
    assert.equal(report.actions[0].result.cycle.kind, "rerun");
    assert.equal(report.actions[0].result.cycle.metric, "0.43");
    const resultDoc = readFileSync(join(dir, "results", "first-move.md"), "utf8");
    assert.match(resultDoc, /cycle 2(?: @[0-9a-f]+)? rerun: Need one more seed -> metric=0\.43/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runResearchAutopilot can complete a gated long-horizon move after synthesize review", async () => {
  const dir = await makeProject("vr-autopilot-long-horizon", {
    active: false,
    queue: "| queued-move | main | run next queued work |\n",
  });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), body });
    if (String(url).endsWith("/action-items")) {
      return {
        ok: true,
        status: 201,
        async json() {
          return { actionItem: { ...body, id: body.id, status: "open" } };
        },
      };
    }
    if (String(url).endsWith("/wait")) {
      const actionItemId = body?.predicateParams?.actionItemId || "";
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            satisfied: true,
            predicate: body.predicate,
            state: {
              actionItems: [{
                id: actionItemId,
                status: "completed",
                resolution: "synthesized",
                resolutionNote: "Enough signal for the harness; finish the move.",
              }],
            },
          };
        },
      };
    }
    if (String(url).endsWith("/canvases")) {
      return {
        ok: true,
        status: 201,
        async json() {
          return { canvas: { id: body.id, title: body.title, imagePath: body.imagePath, href: body.href } };
        },
      };
    }
    return {
      ok: false,
      status: 404,
      async json() {
        return { error: `unexpected fetch ${url}` };
      },
    };
  };

  try {
    const report = await runResearchAutopilot({
      projectDir: dir,
      commandText: "node -e \"console.log('score=0.77')\"",
      metricRegex: "score=([0-9.]+)",
      maxSteps: 2,
      askHuman: true,
      waitHuman: true,
      agentTownApi: "http://agent-town.test/api/agent-town",
      timeoutMs: 5_000,
      finishOnSynthesize: true,
      finishApply: true,
      finishTakeaway: "The long-horizon harness completed the move.",
      finishAnalysis: "The review gate requested synthesis, so autopilot finalized the move.",
      finishDecision: "do not admit",
      finishSummary: "long-horizon harness finalized",
      finishAggregateMetric: true,
      finishMetricName: "score",
      finishUpdatePaper: true,
      finishPaperCaption: "Long-horizon harness finalized.",
      finishPaperLimitations: "This harness uses a synthetic metric and does not test external provider quality.",
      finishPaperDiscussion: "The harness proves the mechanics from queue to resolved paper update.",
      finishPublishCanvas: true,
      finishCanvasSessionId: "human-chat",
      finishCanvasAgentId: "codex",
      finishCanvasTitle: "Long-horizon harness",
      finishCanvasCaption: "Resolved from a synthesized review decision.",
      fetchImpl,
    });

    assert.equal(report.stopReason, "finished");
    assert.equal(report.actions.length, 2);
    assert.equal(report.actions[0].plannedAction, "orchestrator-run-next");
    assert.equal(report.actions[0].result.kind, "run-next");
    assert.equal(report.actions[0].result.cycle.reviewDecision.action, "synthesize");
    assert.equal(report.actions[1].plannedAction, "finish-move");
    assert.equal(report.actions[1].result.kind, "finish");
    assert.equal(report.actions[1].result.finish.applied, true);
    assert.equal(report.actions[1].result.finish.paper.figure.generated, true);
    assert.equal(report.actions[1].result.finish.canvas.title, "Long-horizon harness");

    const readme = readFileSync(join(dir, "README.md"), "utf8");
    assert.doesNotMatch(readme, /\| queued-move \| \[queued-move\]\(results\/queued-move\.md\)/);
    const log = readFileSync(join(dir, "LOG.md"), "utf8");
    assert.match(log, /\| \d{4}-\d{2}-\d{2} \| resolved \| queued-move \| long-horizon harness finalized \| results\/queued-move\.md \|/);
    const resultDoc = readFileSync(join(dir, "results", "queued-move.md"), "utf8");
    assert.match(resultDoc, /STATUS\s*\n\nresolved/);
    assert.match(resultDoc, /mean: 0\.77/);
    assert.match(resultDoc, /seeds: \["1"\]/);
    assert.match(resultDoc, /cycle 1 review: synthesize/);
    const paper = readFileSync(join(dir, "paper.md"), "utf8");
    assert.match(paper, /Long-horizon harness finalized\./);
    assert.match(paper, /figures\/queued-move-summary\.svg/);
    assert.ok(calls.some((call) => call.url.endsWith("/action-items")), "review card was created");
    assert.ok(calls.some((call) => call.url.endsWith("/wait")), "review card was waited on");
    assert.ok(calls.some((call) => call.url.endsWith("/canvases")), "final canvas was published");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vr-research-autopilot CLI help and JSON output work", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /vr-research-autopilot/);
  assert.match(help.stdout, /--agent-review-provider/);
  assert.match(help.stdout, /--finish-paper-caption/);
  assert.match(help.stdout, /--finish-canvas-session-id/);

  const dir = await makeProject("vr-autopilot-cli");
  try {
    writeResult(dir, {
      reviewLine: "- cycle 1 review: continue; resolution=continued; note=Looks good; action item `research-cycle-first-move-1`.",
    });
    const result = await runCli(["step", dir, "--json", "--command", "node train.js"]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.recommendation.action, "run-cycle");
    assert.equal(payload.decision.action, "continue");
    assert.match(payload.nextCommand, /node train\.js/);

    const run = await runCli([
      "run",
      dir,
      "--json",
      "--command",
      "node -e \"console.log('score=0.44')\"",
      "--metric-regex",
      "score=([0-9.]+)",
    ]);
    assert.equal(run.status, 0, run.stderr);
    const runPayload = JSON.parse(run.stdout);
    assert.equal(runPayload.actions[0].plannedAction, "run-cycle");
    assert.equal(runPayload.actions[0].result.cycle.metric, "0.44");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
