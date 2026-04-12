import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeCsvValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/^"/, "")
    .replace(/"$/, "");
}

function parseCsvRows(raw, columns) {
  return String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const values = line.split(",").map((part) => normalizeCsvValue(part));
      return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
    });
}

function parsePsTree(raw) {
  const parentByPid = new Map();

  for (const line of String(raw ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [pidText, ppidText] = trimmed.split(/\s+/, 2);
    const pid = Number(pidText);
    const ppid = Number(ppidText);

    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
      continue;
    }

    parentByPid.set(pid, ppid);
  }

  return parentByPid;
}

export function findDescendantPids(rootPids, parentByPid) {
  const roots = new Set(
    rootPids
      .map((pid) => Number(pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0),
  );
  const descendants = new Set(roots);
  let changed = true;

  while (changed) {
    changed = false;

    for (const [pid, ppid] of parentByPid.entries()) {
      if (descendants.has(pid) || !descendants.has(ppid)) {
        continue;
      }

      descendants.add(pid);
      changed = true;
    }
  }

  return descendants;
}

export function summarizeGpuUsage({ gpuRows, computeRows, parentByPid, sessionRoots }) {
  const agentRoots = sessionRoots.filter(
    (entry) => entry?.providerId && entry.providerId !== "shell" && Number.isInteger(Number(entry.pid)),
  );
  const descendantPids = findDescendantPids(
    agentRoots.map((entry) => Number(entry.pid)),
    parentByPid,
  );
  const gpuSummaries = gpuRows.map((row, index) => ({
    index: row.index || String(index),
    uuid: row.uuid,
    totalMemoryMb: Math.max(0, Number(row.memory_total_mb) || 0),
    remoteVibesMemoryMb: 0,
    otherMemoryMb: 0,
  }));
  const gpuSummaryByUuid = new Map(gpuSummaries.filter((row) => row.uuid).map((row) => [row.uuid, row]));

  for (const row of computeRows) {
    const targetGpu = gpuSummaryByUuid.get(row.gpu_uuid);
    if (!targetGpu) {
      continue;
    }

    const pid = Number(row.pid);
    const usedMemoryMb = Math.max(0, Number(row.used_memory_mb) || 0);

    if (!Number.isInteger(pid)) {
      continue;
    }

    if (descendantPids.has(pid)) {
      targetGpu.remoteVibesMemoryMb += usedMemoryMb;
      continue;
    }

    targetGpu.otherMemoryMb += usedMemoryMb;
  }

  const perGpu = gpuSummaries.map((gpu) => {
    const cappedRemote = Math.min(gpu.totalMemoryMb, gpu.remoteVibesMemoryMb);
    const cappedOther = Math.min(Math.max(0, gpu.totalMemoryMb - cappedRemote), gpu.otherMemoryMb);
    const freeMemoryMb = Math.max(0, gpu.totalMemoryMb - cappedRemote - cappedOther);

    return {
      index: gpu.index,
      totalMemoryMb: gpu.totalMemoryMb,
      remoteVibesMemoryMb: cappedRemote,
      otherMemoryMb: cappedOther,
      freeMemoryMb,
    };
  });
  const usedGpuIds = new Set(
    perGpu
      .filter((gpu) => gpu.remoteVibesMemoryMb > 0)
      .map((gpu) => gpu.index),
  );
  const totalRemoteVibesMemoryMb = perGpu.reduce((sum, gpu) => sum + gpu.remoteVibesMemoryMb, 0);
  const totalOtherMemoryMb = perGpu.reduce((sum, gpu) => sum + gpu.otherMemoryMb, 0);
  const totalMemoryMb = perGpu.reduce((sum, gpu) => sum + gpu.totalMemoryMb, 0);

  return {
    available: true,
    total: gpuRows.length,
    used: usedGpuIds.size,
    idle: Math.max(0, gpuRows.length - usedGpuIds.size),
    activeAgentSessions: agentRoots.length,
    totalMemoryMb,
    remoteVibesMemoryMb: totalRemoteVibesMemoryMb,
    otherMemoryMb: totalOtherMemoryMb,
    freeMemoryMb: Math.max(0, totalMemoryMb - totalRemoteVibesMemoryMb - totalOtherMemoryMb),
    perGpu,
  };
}

export async function getGpuStatus({
  execFileImpl = execFileAsync,
  sessionRoots = [],
} = {}) {
  try {
    const [{ stdout: gpuStdout }, { stdout: computeStdout }, { stdout: psStdout }] = await Promise.all([
      execFileImpl("nvidia-smi", ["--query-gpu=index,uuid,memory.total", "--format=csv,noheader,nounits"]),
      execFileImpl("nvidia-smi", ["--query-compute-apps=gpu_uuid,pid,used_memory", "--format=csv,noheader,nounits"]),
      execFileImpl("ps", ["-axo", "pid=,ppid="]),
    ]);

    return summarizeGpuUsage({
      gpuRows: parseCsvRows(gpuStdout, ["index", "uuid", "memory_total_mb"]),
      computeRows: parseCsvRows(computeStdout, ["gpu_uuid", "pid", "used_memory_mb"]),
      parentByPid: parsePsTree(psStdout),
      sessionRoots,
    });
  } catch (error) {
    return {
      available: false,
      total: 0,
      used: 0,
      idle: 0,
      activeAgentSessions: sessionRoots.filter((entry) => entry?.providerId && entry.providerId !== "shell").length,
      totalMemoryMb: 0,
      remoteVibesMemoryMb: 0,
      otherMemoryMb: 0,
      freeMemoryMb: 0,
      perGpu: [],
      error: error?.message || "GPU status unavailable.",
    };
  }
}
