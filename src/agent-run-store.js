import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const AGENT_RUN_FILE_VERSION = 1;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RANGE_MS = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};
const RUN_BUCKETS = [
  { key: "lt30s", label: "<30s", minMs: 0, maxMs: 30 * 1000 },
  { key: "30s-2m", label: "30s-2m", minMs: 30 * 1000, maxMs: 2 * 60 * 1000 },
  { key: "2m-10m", label: "2m-10m", minMs: 2 * 60 * 1000, maxMs: 10 * 60 * 1000 },
  { key: "10m-30m", label: "10m-30m", minMs: 10 * 60 * 1000, maxMs: 30 * 60 * 1000 },
  { key: "30m-1h", label: "30m-1h", minMs: 30 * 60 * 1000, maxMs: 60 * 60 * 1000 },
  { key: "1h-2h", label: "1h-2h", minMs: 60 * 60 * 1000, maxMs: 2 * 60 * 60 * 1000 },
  { key: "2hPlus", label: "2h+", minMs: 2 * 60 * 60 * 1000, maxMs: null },
];

function normalizeRun(entry) {
  const startedAt = Number(entry?.startedAt);
  const endedAt = Number(entry?.endedAt);
  const durationMs = Math.max(0, Number(entry?.durationMs) || endedAt - startedAt);

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt || durationMs <= 0) {
    return null;
  }

  return {
    id: String(entry?.id || randomUUID()),
    sessionId: String(entry?.sessionId || "").trim(),
    sessionName: String(entry?.sessionName || "").trim(),
    providerId: String(entry?.providerId || "").trim(),
    providerLabel: String(entry?.providerLabel || "").trim(),
    startedAt,
    endedAt,
    durationMs,
    completionReason: String(entry?.completionReason || "idle").trim() || "idle",
  };
}

function buildPayload(runs) {
  return {
    version: AGENT_RUN_FILE_VERSION,
    savedAt: new Date().toISOString(),
    runs,
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeAtomicJson(filePath, payload) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function percentile(sortedValues, percentileValue) {
  if (!sortedValues.length) {
    return 0;
  }

  const index = (sortedValues.length - 1) * percentileValue;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = index - lowerIndex;
  return Math.round(
    sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight,
  );
}

function buildBuckets(runs) {
  return RUN_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: runs.filter(
      (run) => run.durationMs >= bucket.minMs && (bucket.maxMs === null || run.durationMs < bucket.maxMs),
    ).length,
  }));
}

function summarizeRuns(runs) {
  const sortedRuns = runs.slice().sort((left, right) => left.endedAt - right.endedAt);
  const durations = sortedRuns
    .map((run) => run.durationMs)
    .filter((durationMs) => Number.isFinite(durationMs) && durationMs > 0)
    .sort((left, right) => left - right);

  return {
    totalRuns: sortedRuns.length,
    totalRunMs: durations.reduce((sum, durationMs) => sum + durationMs, 0),
    sessionCount: new Set(sortedRuns.map((run) => run.sessionId).filter(Boolean)).size,
    medianRunMs: percentile(durations, 0.5),
    p90RunMs: percentile(durations, 0.9),
    maxRunMs: durations[durations.length - 1] || 0,
    latestEndedAt: sortedRuns[sortedRuns.length - 1]?.endedAt ?? null,
    buckets: buildBuckets(sortedRuns),
  };
}

export class AgentRunStore {
  constructor({
    stateDir,
    retentionMs = DEFAULT_RETENTION_MS,
  }) {
    this.stateDir = stateDir;
    this.filePath = path.join(stateDir, "agent-runs.json");
    this.retentionMs = retentionMs;
    this.runs = [];
  }

  async initialize() {
    const payload = await readJsonIfExists(this.filePath);
    const runs =
      payload?.version === AGENT_RUN_FILE_VERSION && Array.isArray(payload?.runs)
        ? payload.runs
        : [];

    this.runs = runs
      .map((entry) => normalizeRun(entry))
      .filter(Boolean)
      .sort((left, right) => left.endedAt - right.endedAt);
    this.prune(Date.now());
  }

  prune(now = Date.now()) {
    const threshold = now - this.retentionMs;
    this.runs = this.runs.filter((run) => run.endedAt >= threshold);
  }

  async recordRun(run) {
    const normalizedRun = normalizeRun(run);
    if (!normalizedRun) {
      return false;
    }

    this.runs.push(normalizedRun);
    this.runs.sort((left, right) => left.endedAt - right.endedAt);
    this.prune(normalizedRun.endedAt);
    await writeAtomicJson(this.filePath, buildPayload(this.runs));
    return true;
  }

  getHistory(range = "1d", now = Date.now()) {
    const rangeKey = RANGE_MS[range] ? range : "1d";
    const threshold = now - RANGE_MS[rangeKey];
    const runs = this.runs.filter((run) => run.endedAt >= threshold);

    return {
      range: rangeKey,
      rangeMs: RANGE_MS[rangeKey],
      ...summarizeRuns(runs),
    };
  }
}
