#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const distDir = path.join(desktopDir, "dist");
const appPath = path.join(distDir, "mac-universal", "Vibe Research.app");
const notarizeDir = path.join(distDir, "notarize");
const notarizeZip = path.join(notarizeDir, "Vibe Research.app.zip");

const appleId = requireEnv("APPLE_ID");
const applePassword = requireEnv("APPLE_APP_SPECIFIC_PASSWORD");
const appleTeamId = requireEnv("APPLE_TEAM_ID");

const submitAttempts = numberEnv("NOTARY_SUBMIT_ATTEMPTS", 5);
const submitTimeoutMs = numberEnv("NOTARY_SUBMIT_TIMEOUT_MS", 10 * 60 * 1000);
const infoTimeoutMs = numberEnv("NOTARY_INFO_TIMEOUT_MS", 2 * 60 * 1000);
const waitAttempts = numberEnv("NOTARY_WAIT_ATTEMPTS", 4);
const waitTimeoutMs = numberEnv("NOTARY_WAIT_TIMEOUT_MS", 45 * 60 * 1000);
const waitRetryDelayMs = numberEnv("NOTARY_WAIT_RETRY_DELAY_MS", 60 * 1000);
const stapleAttempts = numberEnv("NOTARY_STAPLE_ATTEMPTS", 5);

await access(appPath);
await rm(notarizeDir, { recursive: true, force: true });
await mkdir(notarizeDir, { recursive: true });

await runChecked("codesign verification", "codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  appPath,
], {
  timeoutMs: 2 * 60 * 1000,
});

await runChecked("create notarization zip", "ditto", [
  "-c",
  "-k",
  "--keepParent",
  appPath,
  notarizeZip,
], {
  timeoutMs: 10 * 60 * 1000,
});

const submissionId = await submitForNotarization();
await waitForAcceptedNotarization(submissionId);
await stapleApp();

console.log("macOS app notarized and stapled");

async function submitForNotarization() {
  for (let attempt = 1; attempt <= submitAttempts; attempt += 1) {
    const result = await run(`notarytool submit attempt ${attempt}/${submitAttempts}`, "xcrun", [
      "notarytool",
      "submit",
      notarizeZip,
      "--apple-id",
      appleId,
      "--password",
      applePassword,
      "--team-id",
      appleTeamId,
      "--output-format",
      "json",
    ], {
      timeoutMs: submitTimeoutMs,
    });

    if (result.status === 0) {
      const payload = parseJson(result.stdout, "notarytool submit");
      const id = payload.id ?? payload.submissionId;
      if (!id) {
        throw new Error(`notarytool submit did not return a submission id: ${result.stdout}`);
      }
      console.log(`notarytool submission id: ${id}`);
      return id;
    }

    if (attempt === submitAttempts) {
      throw new Error(`notarytool submit failed after ${submitAttempts} attempts`);
    }

    console.log(`notarytool submit failed with exit code ${result.status}; retrying`);
    await sleep(60 * 1000);
  }

  throw new Error("notarytool submit did not run");
}

async function waitForAcceptedNotarization(submissionId) {
  let lastStatus = "Unknown";

  for (let attempt = 1; attempt <= waitAttempts; attempt += 1) {
    const result = await run(`notarytool wait attempt ${attempt}/${waitAttempts}`, "xcrun", [
      "notarytool",
      "wait",
      submissionId,
      "--apple-id",
      appleId,
      "--password",
      applePassword,
      "--team-id",
      appleTeamId,
      "--output-format",
      "json",
      "--timeout",
      `${Math.round(waitTimeoutMs / 1000)}s`,
    ], {
      timeoutMs: waitTimeoutMs + 2 * 60 * 1000,
    });

    if (result.status === 0) {
      const payload = parseJson(result.stdout, "notarytool wait");
      lastStatus = payload.status ?? payload.Status ?? lastStatus;
      console.log(`notarytool status: ${lastStatus}`);

      if (lastStatus === "Accepted") {
        return;
      }

      if (["Invalid", "Rejected"].includes(lastStatus)) {
        await downloadNotaryLog(submissionId);
        throw new Error(`notarytool status is ${lastStatus}`);
      }
    } else {
      console.log(`notarytool wait exited with ${result.status}; checking current submission state`);
    }

    const info = await getSubmissionInfo(submissionId);
    if (info.status) {
      lastStatus = info.status;
      console.log(`notarytool status: ${lastStatus}`);
    }

    if (lastStatus === "Accepted") {
      return;
    }

    if (["Invalid", "Rejected"].includes(lastStatus)) {
      await downloadNotaryLog(submissionId);
      throw new Error(`notarytool status is ${lastStatus}`);
    }

    if (attempt < waitAttempts) {
      await sleep(waitRetryDelayMs);
    }
  }

  throw new Error(
    `notarytool did not reach Accepted after ${waitAttempts} wait attempts of ${Math.round(waitTimeoutMs / 60000)} minutes each; last status: ${lastStatus}`,
  );
}

async function getSubmissionInfo(submissionId) {
  const result = await run("notarytool info", "xcrun", [
    "notarytool",
    "info",
    submissionId,
    "--apple-id",
    appleId,
    "--password",
    applePassword,
    "--team-id",
    appleTeamId,
    "--output-format",
    "json",
  ], {
    timeoutMs: infoTimeoutMs,
  });

  if (result.status !== 0) {
    return {};
  }

  const payload = parseJson(result.stdout, "notarytool info");
  return {
    status: payload.status ?? payload.Status ?? null,
  };
}

async function downloadNotaryLog(submissionId) {
  await run("notarytool log", "xcrun", [
    "notarytool",
    "log",
    submissionId,
    "--apple-id",
    appleId,
    "--password",
    applePassword,
    "--team-id",
    appleTeamId,
  ], {
    timeoutMs: 2 * 60 * 1000,
  });
}

async function stapleApp() {
  for (let attempt = 1; attempt <= stapleAttempts; attempt += 1) {
    const result = await run(`stapler staple attempt ${attempt}/${stapleAttempts}`, "xcrun", [
      "stapler",
      "staple",
      appPath,
    ], {
      timeoutMs: 2 * 60 * 1000,
    });

    if (result.status === 0) {
      await runChecked("stapler validate", "xcrun", [
        "stapler",
        "validate",
        appPath,
      ], {
        timeoutMs: 2 * 60 * 1000,
      });
      return;
    }

    if (attempt === stapleAttempts) {
      throw new Error(`stapler failed after ${stapleAttempts} attempts`);
    }

    await sleep(30 * 1000);
  }
}

async function runChecked(label, command, args, options) {
  const result = await run(label, command, args, options);
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
  return result;
}

async function run(label, command, args, { timeoutMs }) {
  console.log(`::group::${label}`);
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 15 * 1000).unref();
  }, timeoutMs);

  const status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal && timedOut) {
        resolve(124);
        return;
      }
      resolve(code ?? 1);
    });
  });

  clearTimeout(timer);
  if (timedOut) {
    console.error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`);
  }
  console.log("::endgroup::");

  return { status, stdout, stderr };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} returned non-JSON output: ${text || error.message}`);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
