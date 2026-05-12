import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeFleetNodeUrl } from "./fleet-registry.js";

const HANDOFF_JOB_STORE_VERSION = 1;
const HANDOFF_JOB_STORE_FILENAME = "handoff-jobs.json";
const HANDOFF_JOB_STATUSES = new Set(["planned", "launched", "running", "blocked", "done", "archived"]);
const HANDOFF_STEP_STATUSES = new Set(["pending", "running", "done", "blocked", "skipped"]);

function nowIso() {
  return new Date().toISOString();
}

function atomicPath(targetPath) {
  return `${targetPath}.${process.pid}.${Date.now()}.tmp`;
}

function buildHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function compactText(value, max = 1_000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function compactLine(value, max = 180) {
  return compactText(value, max);
}

function normalizeIdPart(value, fallback = "job") {
  return compactText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || fallback;
}

function normalizeStatus(value, fallback = "planned") {
  const status = String(value || "").trim().toLowerCase();
  return HANDOFF_JOB_STATUSES.has(status) ? status : fallback;
}

function normalizeStepStatus(value, fallback = "pending") {
  const status = String(value || "").trim().toLowerCase();
  return HANDOFF_STEP_STATUSES.has(status) ? status : fallback;
}

function normalizeStringArray(value, maxItems = 12, maxLength = 500) {
  const values = Array.isArray(value) ? value : String(value || "").split(/\r?\n|,/u);
  return values
    .map((entry) => compactText(entry, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeTarget(input = {}) {
  const target = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : { label: input };
  const url = normalizeFleetNodeUrl(target.url || target.baseUrl || target.href || "");
  const sshTarget = compactLine(target.sshTarget || target.ssh || target.host || "", 160);
  return {
    nodeId: compactLine(target.nodeId || target.id || "", 160),
    label: compactLine(target.label || target.name || sshTarget || url || "Target machine", 140),
    url,
    baseUrl: url,
    sshTarget,
  };
}

function normalizeStep(step, index) {
  const title = compactLine(step?.title || step?.name || `Step ${index + 1}`, 120);
  return {
    id: normalizeIdPart(step?.id || title, `step-${index + 1}`),
    title,
    status: normalizeStepStatus(step?.status),
    command: compactText(step?.command || "", 1_500),
    artifactPath: compactLine(step?.artifactPath || step?.artifact || "", 500),
    note: compactText(step?.note || step?.detail || "", 1_000),
  };
}

function defaultStepsForJob({ objective, target, commands, artifactPaths }) {
  const command = commands[0] || "";
  const artifact = artifactPaths[0] || "";
  return [
    {
      id: "prepare",
      title: "Plan source run",
      note: objective || "Define the source experiment, target runtime, and success check.",
    },
    {
      id: "train",
      title: "Run source work",
      command,
      note: command ? "Run the source-side training or build command." : "Train, build, or package on the best available source machine.",
    },
    {
      id: "transfer",
      title: "Transfer artifact",
      artifactPath: artifact,
      note: target.sshTarget
        ? `Move artifacts to ${target.sshTarget} with rsync or scp.`
        : "Move artifacts to the target machine once a route is available.",
    },
    {
      id: "validate",
      title: "Validate on target",
      note: "Run the target-side smoke test and collect logs, metrics, or screenshots.",
    },
    {
      id: "report",
      title: "Report to brain",
      note: "Write the result, commands, artifact paths, and next action into the markdown brain.",
    },
  ].map(normalizeStep);
}

function normalizeHandoffJobRecord(input = {}, existing = null, { sourceNodeId = "" } = {}) {
  const timestamp = nowIso();
  const target = normalizeTarget(input.target || input.targetMachine || {
    label: input.targetLabel,
    url: input.targetUrl || input.targetBaseUrl,
    sshTarget: input.sshTarget,
    nodeId: input.targetNodeId,
  });
  const objective = compactText(input.objective || input.prompt || input.goal || existing?.objective || "", 2_000);
  const commands = normalizeStringArray(input.commands || input.command || existing?.commands, 12, 1_500);
  const artifactPaths = normalizeStringArray(input.artifactPaths || input.artifacts || input.artifactPath || existing?.artifactPaths, 20, 500);
  const title = compactLine(
    input.title || input.name || existing?.title || objective || `Handoff to ${target.label}`,
    140,
  );
  const rawSteps = Array.isArray(input.steps) && input.steps.length
    ? input.steps
    : existing?.steps;
  const steps = Array.isArray(rawSteps) && rawSteps.length
    ? rawSteps.map((step, index) => normalizeStep(step, index))
    : defaultStepsForJob({ objective, target, commands, artifactPaths });

  return {
    id: existing?.id || compactLine(input.id || "", 160) || `${normalizeIdPart(title, "handoff")}-${randomUUID().slice(0, 8)}`,
    kind: "agent-handoff",
    status: normalizeStatus(input.status, existing?.status || "planned"),
    title,
    objective,
    sourceNodeId: compactLine(input.sourceNodeId || existing?.sourceNodeId || sourceNodeId, 160),
    target,
    providerId: compactLine(input.providerId || existing?.providerId || "", 80),
    workspacePath: compactLine(input.workspacePath || input.cwd || existing?.workspacePath || "", 500),
    artifactPaths,
    commands,
    steps,
    launchedSessionId: compactLine(input.launchedSessionId || existing?.launchedSessionId || "", 160),
    createdAt: existing?.createdAt || input.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = atomicPath(filePath);
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

export function buildHandoffLaunchPrompt(job, { localNodeName = "this machine" } = {}) {
  const target = job?.target || {};
  const commandLines = Array.isArray(job?.commands) && job.commands.length
    ? job.commands.map((command) => `- ${command}`).join("\n")
    : "- Decide the exact source-side command after inspecting the repo and hardware.";
  const artifacts = Array.isArray(job?.artifactPaths) && job.artifactPaths.length
    ? job.artifactPaths.map((artifactPath) => `- ${artifactPath}`).join("\n")
    : "- Record every generated artifact path before transfer.";
  const targetRoute = target.sshTarget
    ? `SSH target: ${target.sshTarget}`
    : target.baseUrl
      ? `Swarmlab URL: ${target.baseUrl}`
      : "Target route: discover from the machine registry or ask only if blocked.";

  return [
    `You are coordinating a Swarmlab machine handoff from ${localNodeName}.`,
    "",
    `Job: ${job.title}`,
    `Objective: ${job.objective || "Complete the machine-to-machine research handoff."}`,
    `Target: ${target.label || "target machine"}`,
    targetRoute,
    job.workspacePath ? `Workspace: ${job.workspacePath}` : "",
    "",
    "Execution contract:",
    "1. Inspect the source repo and hardware first.",
    "2. Run the source-side training/build/eval work on the best available machine.",
    "3. Package artifacts with a manifest containing commit, command, environment, and checksum.",
    "4. Transfer artifacts with ssh/rsync/scp when an SSH target is available.",
    "5. Run the target-side smoke or benchmark on the destination machine.",
    "6. Write the result and next action into the markdown brain before stopping.",
    "",
    "Candidate commands:",
    commandLines,
    "",
    "Artifacts to preserve or produce:",
    artifacts,
  ].filter(Boolean).join("\n");
}

export class HandoffJobStore {
  constructor({ stateDir } = {}) {
    if (!stateDir) {
      throw new Error("stateDir is required for HandoffJobStore.");
    }
    this.storePath = path.join(stateDir, HANDOFF_JOB_STORE_FILENAME);
    this.jobs = new Map();
  }

  async initialize() {
    let parsed = {};
    try {
      parsed = await readJsonFile(this.storePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("[swarmlab] could not read handoff jobs; starting empty", error?.message || error);
      }
    }

    this.jobs = new Map();
    for (const rawJob of Array.isArray(parsed?.jobs) ? parsed.jobs : []) {
      try {
        const job = normalizeHandoffJobRecord(rawJob, null, { sourceNodeId: rawJob?.sourceNodeId || "" });
        this.jobs.set(job.id, job);
      } catch {
        // Ignore corrupt legacy rows.
      }
    }
    await this.save();
    return this.listJobs();
  }

  async save() {
    await writeJsonFile(this.storePath, {
      version: HANDOFF_JOB_STORE_VERSION,
      jobs: this.listJobs({ includeArchived: true }),
      updatedAt: nowIso(),
    });
  }

  listJobs({ includeArchived = false } = {}) {
    return [...this.jobs.values()]
      .filter((job) => includeArchived || job.status !== "archived")
      .map((job) => ({ ...job, target: { ...job.target }, steps: job.steps.map((step) => ({ ...step })) }))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  getJob(id) {
    const job = this.jobs.get(String(id || "").trim());
    return job ? { ...job, target: { ...job.target }, steps: job.steps.map((step) => ({ ...step })) } : null;
  }

  async createJob(input = {}, options = {}) {
    const job = normalizeHandoffJobRecord(input, null, options);
    this.jobs.set(job.id, job);
    await this.save();
    return this.getJob(job.id);
  }

  async updateJob(id, patch = {}) {
    const key = String(id || "").trim();
    const existing = this.jobs.get(key);
    if (!existing) {
      throw buildHttpError("Handoff job not found.", 404);
    }
    const job = normalizeHandoffJobRecord({ ...existing, ...patch }, existing, { sourceNodeId: existing.sourceNodeId });
    this.jobs.set(key, { ...job, id: key, createdAt: existing.createdAt });
    await this.save();
    return this.getJob(key);
  }

  async markLaunched(id, sessionId, providerId = "") {
    return this.updateJob(id, {
      status: "launched",
      launchedSessionId: sessionId,
      providerId,
      steps: this.getJob(id)?.steps?.map((step, index) => index === 0 ? { ...step, status: "done" } : step) || [],
    });
  }

  async archiveJob(id) {
    await this.updateJob(id, { status: "archived" });
    return true;
  }
}
