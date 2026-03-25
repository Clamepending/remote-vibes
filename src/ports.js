import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parsePortNumber(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
}

function parseLsofOutput(output, excludePorts = []) {
  const excluded = new Set(excludePorts.map((port) => Number(port)));
  const ports = new Map();

  for (const line of output.split("\n").slice(1)) {
    if (!line.includes(" TCP ") || !line.includes("(LISTEN)")) {
      continue;
    }

    const tcpIndex = line.indexOf(" TCP ");
    const prefix = line.slice(0, tcpIndex).trim();
    const suffix = line.slice(tcpIndex + 1).trim();
    const prefixParts = prefix.split(/\s+/);
    const command = prefixParts[0];
    const pid = Number(prefixParts[1] || 0);
    const match = suffix.match(/^TCP\s+(.+):(\d+)\s+\(LISTEN\)$/);

    if (!match) {
      continue;
    }

    const host = match[1] === "*" ? "0.0.0.0" : match[1];
    const port = parsePortNumber(match[2]);

    if (!port || excluded.has(port)) {
      continue;
    }

    const existing = ports.get(port) ?? {
      port,
      command,
      pid,
      hosts: new Set(),
      proxyPath: `/proxy/${port}/`,
    };

    existing.hosts.add(host);

    if (existing.command === "unknown" && command) {
      existing.command = command;
    }

    if (!existing.pid && pid) {
      existing.pid = pid;
    }

    ports.set(port, existing);
  }

  return Array.from(ports.values())
    .map((entry) => ({
      ...entry,
      hosts: Array.from(entry.hosts).sort(),
    }))
    .sort((left, right) => left.port - right.port);
}

export async function listListeningPorts({ excludePorts = [] } = {}) {
  try {
    const { stdout } = await execFileAsync(process.env.SHELL || "/bin/zsh", [
      "-lc",
      "lsof -nP -iTCP -sTCP:LISTEN",
    ]);
    return parseLsofOutput(stdout, excludePorts);
  } catch (error) {
    if (typeof error.stdout === "string") {
      return parseLsofOutput(error.stdout, excludePorts);
    }

    return [];
  }
}
