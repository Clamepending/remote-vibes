import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import test from "node:test";
import { updateResearchState } from "../src/research/brief.js";
import {
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
    });
    assert.equal(report.recommendation.action, "rerun-cycle");
    assert.equal(report.decision.action, "rerun");
    assert.match(report.nextCommand, /vr-research-runner/);
    assert.match(report.nextCommand, /--kind rerun/);
    assert.match(report.nextCommand, /node train\.js/);
    assert.match(report.nextCommand, /--wait-human/);
    assert.match(report.nextCommand, /agent-town\.test/);
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

test("vr-research-autopilot CLI help and JSON output work", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /vr-research-autopilot/);

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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
