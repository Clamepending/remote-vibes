import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const GPU_HISTORY_FILE_VERSION = 1;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_SAMPLE_INTERVAL_MS = 60 * 1000;
const RANGE_MS = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function normalizeSample(snapshot, timestamp) {
  return {
    timestamp,
    perGpu: (snapshot?.perGpu || []).map((entry) => ({
      index: String(entry.index),
      totalMemoryMb: Math.max(0, Number(entry.totalMemoryMb) || 0),
      remoteVibesMemoryMb: Math.max(0, Number(entry.remoteVibesMemoryMb) || 0),
      otherMemoryMb: Math.max(0, Number(entry.otherMemoryMb) || 0),
      freeMemoryMb: Math.max(0, Number(entry.freeMemoryMb) || 0),
    })),
  };
}

function buildPayload(samples) {
  return {
    version: GPU_HISTORY_FILE_VERSION,
    savedAt: new Date().toISOString(),
    samples,
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

export function downsampleSeries(points, maxPoints) {
  if (!Array.isArray(points) || points.length <= maxPoints) {
    return points;
  }

  const result = [];
  const lastIndex = points.length - 1;

  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / Math.max(1, maxPoints - 1));
    result.push(points[sourceIndex]);
  }

  return result;
}

export class GpuHistoryStore {
  constructor({
    stateDir,
    retentionMs = DEFAULT_RETENTION_MS,
    sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
    maxPoints = 288,
  }) {
    this.stateDir = stateDir;
    this.filePath = path.join(stateDir, "gpu-history.json");
    this.retentionMs = retentionMs;
    this.sampleIntervalMs = sampleIntervalMs;
    this.maxPoints = maxPoints;
    this.samples = [];
    this.lastRecordedAt = 0;
  }

  async initialize() {
    const payload = await readJsonIfExists(this.filePath);
    const samples =
      payload?.version === GPU_HISTORY_FILE_VERSION && Array.isArray(payload?.samples)
        ? payload.samples
        : [];

    this.samples = samples
      .filter((entry) => Number.isInteger(Number(entry?.timestamp)) && Array.isArray(entry?.perGpu))
      .map((entry) => normalizeSample(entry, Number(entry.timestamp)));
    this.prune(Date.now());

    if (this.samples.length) {
      this.lastRecordedAt = this.samples[this.samples.length - 1].timestamp;
    }
  }

  prune(now = Date.now()) {
    const threshold = now - this.retentionMs;
    this.samples = this.samples.filter((entry) => entry.timestamp >= threshold);
  }

  async record(snapshot, now = Date.now()) {
    if (!snapshot?.available || !Array.isArray(snapshot?.perGpu) || !snapshot.perGpu.length) {
      return false;
    }

    if (this.lastRecordedAt && now - this.lastRecordedAt < this.sampleIntervalMs) {
      return false;
    }

    this.samples.push(normalizeSample(snapshot, now));
    this.lastRecordedAt = now;
    this.prune(now);
    await writeAtomicJson(this.filePath, buildPayload(this.samples));
    return true;
  }

  getHistory(range = "1d", now = Date.now()) {
    const rangeKey = RANGE_MS[range] ? range : "1d";
    const threshold = now - RANGE_MS[rangeKey];
    const samples = this.samples.filter((entry) => entry.timestamp >= threshold);
    const gpuIndices = new Set();

    for (const sample of samples) {
      for (const gpu of sample.perGpu) {
        gpuIndices.add(gpu.index);
      }
    }

    const gpus = Array.from(gpuIndices)
      .sort((left, right) => Number(left) - Number(right))
      .map((index) => {
        const points = samples
          .map((sample) => {
            const gpu = sample.perGpu.find((entry) => entry.index === index);
            if (!gpu) {
              return null;
            }

            return {
              timestamp: sample.timestamp,
              totalMemoryMb: gpu.totalMemoryMb,
              remoteVibesMemoryMb: gpu.remoteVibesMemoryMb,
              otherMemoryMb: gpu.otherMemoryMb,
              freeMemoryMb: gpu.freeMemoryMb,
            };
          })
          .filter(Boolean);

        return {
          index,
          points: downsampleSeries(points, this.maxPoints),
        };
      });

    return {
      range: rangeKey,
      rangeMs: RANGE_MS[rangeKey],
      sampleIntervalMs: this.sampleIntervalMs,
      latestTimestamp: this.samples[this.samples.length - 1]?.timestamp ?? null,
      gpus,
    };
  }
}
