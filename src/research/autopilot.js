import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { readResearchState, updateResearchState } from "./brief.js";
import { tickResearchOrchestrator } from "./orchestrator.js";
import { parseProjectReadme } from "./project-readme.js";
import { finishMove, runCycle, runNextMove } from "./runner.js";

function trimString(value) {
  return String(value || "").trim();
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  const text = String(value || "");
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function command(parts) {
  return parts.filter((part) => part !== "" && part !== undefined && part !== null).map(shellQuote).join(" ");
}

function normalizeDecisionAction(value) {
  const normalized = trimString(value).toLowerCase();
  const map = new Map([
    ["continued", "continue"],
    ["continue", "continue"],
    ["rerun", "rerun"],
    ["synthesized", "synthesize"],
    ["synthesize", "synthesize"],
    ["brainstorm", "brainstorm"],
    ["ideation", "brainstorm"],
    ["steered", "steer"],
    ["steer", "steer"],
    ["paused", "pause"],
    ["pause", "pause"],
    ["timeout", "timeout"],
  ]);
  return map.get(normalized) || (normalized ? "unknown" : "");
}

function parseReviewDecisionLine(line) {
  const match = /^-\s*cycle\s+(\d+)\s+review:\s*([^;\n.]+)(.*)$/iu.exec(trimString(line));
  if (!match) return null;
  const suffix = match[3] || "";
  const fields = {};
  for (const segment of suffix.split(";")) {
    const trimmed = segment.trim().replace(/\.$/u, "");
    const fieldMatch = /^([A-Za-z0-9_-]+)=(.*)$/u.exec(trimmed);
    if (fieldMatch) {
      fields[fieldMatch[1]] = fieldMatch[2].trim();
      continue;
    }
    const actionItemMatch = /^action item\s+`([^`]+)`$/iu.exec(trimmed);
    if (actionItemMatch) {
      fields.actionItemId = actionItemMatch[1].trim();
    }
  }
  return {
    cycleIndex: Number(match[1]) || 0,
    action: normalizeDecisionAction(match[2]),
    rawAction: trimString(match[2]),
    resolution: fields.resolution || "",
    resolutionNote: fields.note || "",
    actionItemId: fields.actionItemId || "",
    raw: trimString(line),
  };
}

export function extractReviewDecisions(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(parseReviewDecisionLine)
    .filter(Boolean);
}

function latestReviewDecision(text) {
  const decisions = extractReviewDecisions(text);
  return decisions[decisions.length - 1] || null;
}

function decisionFromOverride(value) {
  const action = normalizeDecisionAction(value);
  if (!action) return null;
  return {
    cycleIndex: 0,
    action,
    rawAction: trimString(value),
    resolution: trimString(value),
    resolutionNote: "",
    actionItemId: "",
    raw: `override:${trimString(value)}`,
  };
}

function activeResultPath(projectDir, row) {
  const fromRow = trimString(row?.resultPath || "");
  if (fromRow) {
    return path.isAbsolute(fromRow) ? fromRow : path.resolve(projectDir, fromRow);
  }
  return path.resolve(projectDir, "results", `${row.slug}.md`);
}

function runnerCycleCommand({ projectDir, slug, kind, commandText, askHuman, waitHuman, agentTownApi, codeCwd } = {}) {
  const parts = [
    "vr-research-runner",
    projectDir,
    "cycle",
    "--slug",
    slug,
    "--kind",
    kind,
    "--command",
    commandText || "<experiment-command>",
  ];
  if (codeCwd) parts.push("--cwd", codeCwd);
  if (waitHuman) parts.push("--wait-human");
  else if (askHuman) parts.push("--ask-human");
  if (agentTownApi) parts.push("--agent-town-api", agentTownApi);
  return command(parts);
}

function runnerFinishCommand({ projectDir, slug, apply = false } = {}) {
  const parts = [
    "vr-research-runner",
    projectDir,
    "finish",
    "--slug",
    slug,
    "--aggregate-metric",
    "--auto-admit",
    "--update-paper",
    "--publish-canvas",
  ];
  if (apply) parts.push("--apply");
  return command(parts);
}

function recommendation(action, reason, extra = {}) {
  return { action, reason, ...extra };
}

function finitePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.floor(numeric));
}

function finiteNonNegativeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}

async function routeActiveDecision({
  projectDir,
  row,
  state,
  decision,
  apply = false,
  askHuman = false,
  waitHuman = false,
  commandText = "",
  codeCwd = "",
  agentTownApi = "",
} = {}) {
  const slug = row.slug;
  let phaseUpdate = null;
  let nextCommand = "";
  let rec;

  if (!decision) {
    rec = recommendation(
      "wait-review",
      `ACTIVE move ${slug} has no recorded review decision yet; run or wait for a cycle review.`,
      { slug },
    );
    nextCommand = runnerCycleCommand({
      projectDir,
      slug,
      kind: "change",
      commandText,
      askHuman: true,
      waitHuman,
      agentTownApi,
      codeCwd,
    });
  } else if (decision.action === "continue") {
    rec = recommendation(
      "run-cycle",
      `latest review decision for ${slug} was continue; run the next change cycle.`,
      { slug, decision },
    );
    nextCommand = runnerCycleCommand({ projectDir, slug, kind: "change", commandText, askHuman, waitHuman, agentTownApi, codeCwd });
  } else if (decision.action === "rerun") {
    rec = recommendation(
      "rerun-cycle",
      `latest review decision for ${slug} requested a rerun/noise check.`,
      { slug, decision },
    );
    nextCommand = runnerCycleCommand({ projectDir, slug, kind: "rerun", commandText, askHuman, waitHuman, agentTownApi, codeCwd });
  } else if (decision.action === "synthesize") {
    rec = recommendation(
      "finish-move",
      `latest review decision for ${slug} requested synthesis; finish the move before taking new work.`,
      { slug, decision },
    );
    nextCommand = runnerFinishCommand({ projectDir, slug, apply });
    if (apply) {
      phaseUpdate = await updateResearchState({
        projectDir,
        phase: "synthesis",
        briefSlug: state.briefSlug,
        summary: `autopilot: synthesize requested for ${slug}`,
      });
    }
  } else if (decision.action === "brainstorm") {
    rec = recommendation(
      "return-to-ideation",
      `latest review decision for ${slug} requested brainstorm; return the project to ideation.`,
      { slug, decision },
    );
    nextCommand = command([
      "vr-research-orchestrator",
      projectDir,
      "--apply",
      "--ask-human",
    ]);
    if (apply) {
      phaseUpdate = await updateResearchState({
        projectDir,
        phase: "ideation",
        briefSlug: "",
        summary: `autopilot: brainstorm requested for ${slug}`,
      });
    }
  } else if (decision.action === "steer") {
    rec = recommendation(
      "apply-steering",
      `latest review decision for ${slug} includes steering; fold the note into the next cycle change or brief.`,
      { slug, decision },
    );
    nextCommand = runnerCycleCommand({
      projectDir,
      slug,
      kind: "change",
      commandText,
      askHuman,
      waitHuman,
      agentTownApi,
      codeCwd,
    });
  } else if (decision.action === "timeout" || decision.action === "pause") {
    rec = recommendation(
      "pause",
      `latest review decision for ${slug} is ${decision.action}; do not continue autonomously.`,
      { slug, decision },
    );
  } else {
    rec = recommendation(
      "needs-human",
      `latest review decision for ${slug} is not routable: ${decision.rawAction || decision.action}.`,
      { slug, decision },
    );
  }

  return { rec, nextCommand, phaseUpdate };
}

export async function stepResearchAutopilot({
  projectDir,
  apply = false,
  decision = "",
  askHuman = false,
  waitHuman = false,
  agentTownApi = "",
  timeoutMs = "",
  allowCrossVersion = false,
  checkPaper = true,
  codeCwd = "",
  commandText = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!projectDir) throw new TypeError("projectDir is required");
  const resolvedProjectDir = path.resolve(projectDir);
  const readmePath = path.join(resolvedProjectDir, "README.md");
  const readmeText = await readFile(readmePath, "utf8");
  const parsed = parseProjectReadme(readmeText);
  const state = await readResearchState({ projectDir: resolvedProjectDir });
  const active = parsed.active || [];

  if (!active.length) {
    const orchestrator = await tickResearchOrchestrator({
      projectDir: resolvedProjectDir,
      apply,
      askHuman,
      waitHuman,
      agentTownApi,
      timeoutMs,
      allowCrossVersion,
      checkPaper,
      codeCwd,
      commandText,
      fetchImpl,
    });
    return {
      projectDir: resolvedProjectDir,
      phase: state,
      delegated: "orchestrator",
      orchestrator,
      recommendation: recommendation(
        `orchestrator-${orchestrator.recommendation.action}`,
        orchestrator.recommendation.reason,
        { upstream: orchestrator.recommendation },
      ),
      nextCommand: orchestrator.nextCommand,
      phaseUpdate: orchestrator.phaseUpdate,
      active: null,
      decision: null,
    };
  }

  const row = active[0];
  const resultPath = activeResultPath(resolvedProjectDir, row);
  const resultText = await pathExists(resultPath) ? await readFile(resultPath, "utf8") : "";
  const routedDecision = decisionFromOverride(decision) || latestReviewDecision(resultText);
  const routed = await routeActiveDecision({
    projectDir: resolvedProjectDir,
    row,
    state,
    decision: routedDecision,
    apply,
    askHuman,
    waitHuman,
    commandText,
    codeCwd,
    agentTownApi,
  });

  return {
    projectDir: resolvedProjectDir,
    phase: state,
    delegated: "",
    active: {
      slug: row.slug,
      resultPath,
      agent: row.agent || "",
      started: row.started || "",
    },
    decision: routedDecision,
    recommendation: routed.rec,
    nextCommand: routed.nextCommand,
    phaseUpdate: routed.phaseUpdate?.state || null,
    orchestrator: null,
  };
}

function cycleOptionsFromRun({
  projectDir,
  slug = "",
  kind = "change",
  commandText = "",
  codeCwd = "",
  askHuman = false,
  waitHuman = false,
  agentTownApi = "",
  humanTimeoutMs = 30_000,
  commandTimeoutMs = 30 * 60 * 1000,
  metric = "",
  metricRegex = "",
  change = "",
  qual = "",
  seed = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    projectDir,
    slug,
    command: commandText,
    cwd: codeCwd,
    kind,
    metric,
    metricRegex,
    change,
    qual,
    seed,
    timeoutMs: commandTimeoutMs,
    askHuman,
    waitHuman,
    humanTimeoutMs,
    agentTownApi,
    fetchImpl,
  };
}

function summarizeCycleStop(cycle, { waitHuman = false } = {}) {
  if (cycle?.review && !waitHuman) {
    return { stop: true, reason: "human-gate", summary: "cycle opened a review card" };
  }
  if (cycle?.reviewDecision?.action === "timeout") {
    return { stop: true, reason: "human-timeout", summary: "human review wait timed out" };
  }
  if (["pause", "reject", "dismiss"].includes(cycle?.reviewDecision?.action || "")) {
    return { stop: true, reason: "human-stop", summary: `human review resolved as ${cycle.reviewDecision.action}` };
  }
  return { stop: false, reason: "", summary: "" };
}

export async function runResearchAutopilot({
  projectDir,
  maxSteps = 1,
  apply = false,
  decision = "",
  askHuman = false,
  waitHuman = false,
  agentTownApi = "",
  timeoutMs = "",
  allowCrossVersion = false,
  checkPaper = true,
  codeCwd = "",
  commandText = "",
  commandTimeoutMs = 30 * 60 * 1000,
  metric = "",
  metricRegex = "",
  change = "",
  qual = "",
  seed = "",
  finishOnSynthesize = false,
  finishApply = false,
  finishTakeaway = "",
  finishAnalysis = "",
  finishDecision = "",
  finishAggregateMetric = false,
  finishMetricName = "",
  finishHigherIsBetter,
  finishAutoAdmit = false,
  finishUpdatePaper = false,
  finishPublishCanvas = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!projectDir) throw new TypeError("projectDir is required");
  const resolvedProjectDir = path.resolve(projectDir);
  const limit = finitePositiveInteger(maxSteps, 1);
  const humanTimeoutMs = finiteNonNegativeInteger(timeoutMs, 30_000);
  const cycleTimeoutMs = finitePositiveInteger(commandTimeoutMs, 30 * 60 * 1000);
  const actions = [];
  let stopReason = "max-steps";
  let stopSummary = `stopped after ${limit} step${limit === 1 ? "" : "s"}`;
  let lastStep = null;

  for (let index = 0; index < limit; index += 1) {
    const step = await stepResearchAutopilot({
      projectDir: resolvedProjectDir,
      apply,
      decision: index === 0 ? decision : "",
      askHuman,
      waitHuman,
      agentTownApi,
      timeoutMs: humanTimeoutMs,
      allowCrossVersion,
      checkPaper,
      codeCwd,
      commandText,
      fetchImpl,
    });
    lastStep = step;
    const action = step.recommendation?.action || "";
    const actionRecord = {
      index: index + 1,
      plannedAction: action,
      recommendation: step.recommendation,
      decision: step.decision || null,
      result: null,
    };

    if (action === "orchestrator-fix-doctor") {
      actionRecord.result = { skipped: true, reason: "doctor-error" };
      actions.push(actionRecord);
      stopReason = "doctor-error";
      stopSummary = step.recommendation.reason;
      break;
    }

    if (action === "orchestrator-run-next") {
      if (!trimString(commandText)) {
        actionRecord.result = { skipped: true, reason: "missing-command" };
        actions.push(actionRecord);
        stopReason = "missing-command";
        stopSummary = "QUEUE has work, but --command is required before autopilot can run it";
        break;
      }
      const result = await runNextMove(cycleOptionsFromRun({
        projectDir: resolvedProjectDir,
        commandText,
        codeCwd,
        askHuman,
        waitHuman,
        agentTownApi,
        humanTimeoutMs,
        commandTimeoutMs: cycleTimeoutMs,
        metric,
        metricRegex,
        change,
        qual,
        seed,
        fetchImpl,
      }));
      actionRecord.result = {
        kind: "run-next",
        claim: result.claim,
        cycle: result.cycle,
      };
      actions.push(actionRecord);
      const stop = summarizeCycleStop(result.cycle, { waitHuman });
      if (stop.stop) {
        stopReason = stop.reason;
        stopSummary = stop.summary;
        break;
      }
      continue;
    }

    if (["run-cycle", "rerun-cycle", "wait-review", "apply-steering"].includes(action)) {
      if (!trimString(commandText)) {
        actionRecord.result = { skipped: true, reason: "missing-command" };
        actions.push(actionRecord);
        stopReason = "missing-command";
        stopSummary = `${action} needs --command before autopilot can execute it`;
        break;
      }
      const kind = action === "rerun-cycle" ? "rerun" : "change";
      const result = await runCycle(cycleOptionsFromRun({
        projectDir: resolvedProjectDir,
        slug: step.active?.slug || step.recommendation?.slug || "",
        kind,
        commandText,
        codeCwd,
        askHuman,
        waitHuman,
        agentTownApi,
        humanTimeoutMs,
        commandTimeoutMs: cycleTimeoutMs,
        metric,
        metricRegex,
        change: change || step.decision?.resolutionNote || "",
        qual,
        seed,
        fetchImpl,
      }));
      actionRecord.result = { kind: "cycle", cycle: result };
      actions.push(actionRecord);
      const stop = summarizeCycleStop(result, { waitHuman });
      if (stop.stop) {
        stopReason = stop.reason;
        stopSummary = stop.summary;
        break;
      }
      continue;
    }

    if (action === "finish-move") {
      if (!finishOnSynthesize) {
        actionRecord.result = { skipped: true, reason: "finish-not-enabled" };
        actions.push(actionRecord);
        stopReason = "synthesis-ready";
        stopSummary = "synthesis was requested; pass --finish-on-synthesize to let autopilot call finishMove";
        break;
      }
      const result = await finishMove({
        projectDir: resolvedProjectDir,
        slug: step.active?.slug || step.recommendation?.slug || "",
        status: "resolved",
        event: "resolved",
        takeaway: finishTakeaway,
        analysis: finishAnalysis,
        decision: finishDecision,
        aggregateMetric: finishAggregateMetric,
        metricName: finishMetricName,
        higherIsBetter: finishHigherIsBetter,
        autoAdmit: finishAutoAdmit,
        allowCrossVersion,
        apply: finishApply,
        updatePaper: finishUpdatePaper,
        publishCanvas: finishPublishCanvas,
        agentTownApi,
        fetchImpl,
      });
      actionRecord.result = { kind: "finish", finish: result };
      actions.push(actionRecord);
      stopReason = "finished";
      stopSummary = `finished ${result.slug} as ${result.status}`;
      break;
    }

    if (action === "return-to-ideation") {
      actionRecord.result = {
        kind: "phase",
        phase: step.phaseUpdate,
      };
      actions.push(actionRecord);
      stopReason = "ideation";
      stopSummary = "returned project to ideation";
      break;
    }

    if (action === "pause" || action === "needs-human") {
      actionRecord.result = { skipped: true, reason: action };
      actions.push(actionRecord);
      stopReason = action;
      stopSummary = step.recommendation.reason;
      break;
    }

    actionRecord.result = { skipped: true, reason: "delegated-or-unsupported" };
    actions.push(actionRecord);
    stopReason = action.startsWith("orchestrator-") ? "orchestrator-stop" : "unsupported-action";
    stopSummary = step.recommendation.reason;
    break;
  }

  return {
    projectDir: resolvedProjectDir,
    maxSteps: limit,
    stopReason,
    stopSummary,
    actions,
    lastStep,
  };
}

export function formatAutopilotReport(report) {
  const lines = [
    `vr-research-autopilot: ${path.basename(report.projectDir)}`,
    `phase: ${report.phase.phase}${report.phase.briefSlug ? ` (${report.phase.briefSlug})` : ""}`,
    `recommendation: ${report.recommendation.action} - ${report.recommendation.reason}`,
  ];
  if (report.active?.slug) {
    lines.push(`active: ${report.active.slug}`);
  }
  if (report.decision) {
    lines.push(`decision: ${report.decision.action}${report.decision.resolutionNote ? ` - ${report.decision.resolutionNote}` : ""}`);
  }
  if (report.phaseUpdate) {
    lines.push(`phase update: ${report.phaseUpdate.phase} - ${report.phaseUpdate.summary}`);
  }
  if (report.delegated === "orchestrator" && report.orchestrator?.recommendation?.action) {
    lines.push(`orchestrator: ${report.orchestrator.recommendation.action}`);
  }
  if (report.nextCommand) {
    lines.push(`next: ${report.nextCommand}`);
  }
  return lines.join("\n");
}

export function formatAutopilotRunReport(report) {
  const lines = [
    `vr-research-autopilot run: ${path.basename(report.projectDir)}`,
    `stop: ${report.stopReason} - ${report.stopSummary}`,
  ];
  for (const action of report.actions || []) {
    lines.push(`step ${action.index}: ${action.plannedAction}`);
    const result = action.result || {};
    if (result.kind === "run-next") {
      lines.push(`  claimed: ${result.claim?.slug || ""}`);
      lines.push(`  cycle: ${result.cycle?.cycleIndex || ""} ${result.cycle?.metric ? `metric=${result.cycle.metric}` : `exit=${result.cycle?.exitCode}`}`);
    } else if (result.kind === "cycle") {
      lines.push(`  cycle: ${result.cycle?.cycleIndex || ""} ${result.cycle?.metric ? `metric=${result.cycle.metric}` : `exit=${result.cycle?.exitCode}`}`);
    } else if (result.kind === "finish") {
      lines.push(`  finished: ${result.finish?.slug || ""} ${result.finish?.status || ""}`);
    } else if (result.kind === "phase") {
      lines.push(`  phase: ${result.phase?.phase || ""}`);
    } else if (result.skipped) {
      lines.push(`  skipped: ${result.reason}`);
    }
  }
  if (report.lastStep?.nextCommand) {
    lines.push(`planned: ${report.lastStep.nextCommand}`);
  }
  return lines.join("\n");
}

export const __internal = {
  extractReviewDecisions,
  latestReviewDecision,
  normalizeDecisionAction,
  parseReviewDecisionLine,
  routeActiveDecision,
};
