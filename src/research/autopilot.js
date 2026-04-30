import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { readResearchState, updateResearchState } from "./brief.js";
import { tickResearchOrchestrator } from "./orchestrator.js";
import { parseProjectReadme } from "./project-readme.js";

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

export const __internal = {
  extractReviewDecisions,
  latestReviewDecision,
  normalizeDecisionAction,
  parseReviewDecisionLine,
  routeActiveDecision,
};
