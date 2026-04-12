import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";
import {
  browserCommandHints,
  browserExecutableHints,
  createBrowserError,
  ensureLocalBrowserTarget,
  inspectBrowserRuntime,
  resolveBrowserOutputPath,
  truncateBrowserText,
} from "./browser-runtime.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 960,
};

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.code = "USAGE";
  }
}

function usageText() {
  return [
    "rv-browser lets coding agents inspect localhost web apps with a real browser.",
    "",
    "Usage:",
    "  rv-browser doctor",
    "  rv-browser screenshot <port-or-url> [output.png] [--wait-for-selector <selector>] [--wait-for-text <text>] [--timeout <ms>] [--full-page]",
    "  rv-browser run <port-or-url> --steps <json> [--output output.png] [--timeout <ms>] [--wait-until load|domcontentloaded|networkidle] [--width <px>] [--height <px>]",
    "",
    "Examples:",
    "  rv-browser screenshot 7860",
    "  rv-browser screenshot http://127.0.0.1:3000/ out.png --wait-for-text Ready",
    "  rv-browser run 7860 --steps-file eval-steps.json --output final.png",
    "",
    "Step actions supported by `run`:",
    "  goto, click, fill, press, check, uncheck, select, setInputFiles, waitForSelector, waitForText, waitForLoadState, waitForTimeout, screenshot",
    "",
    "The target must be localhost, 127.0.0.1, ::1, 0.0.0.0, or a bare port number.",
  ].join("\n");
}

function parseNumberOption(rawValue, flagName) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsageError(`${flagName} must be a positive number.`);
  }

  return value;
}

function parseFlags(argv) {
  const flags = {
    headless: true,
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }

    const [rawFlagName, inlineValue] = argument.split("=", 2);
    const consumeValue = () => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }

      index += 1;
      if (index >= argv.length) {
        throw new UsageError(`${rawFlagName} requires a value.`);
      }

      return argv[index];
    };

    switch (rawFlagName) {
      case "--help":
        flags.help = true;
        break;
      case "--steps":
        flags.steps = consumeValue();
        break;
      case "--steps-file":
        flags.stepsFile = consumeValue();
        break;
      case "--output":
        flags.output = consumeValue();
        break;
      case "--timeout":
        flags.timeoutMs = parseNumberOption(consumeValue(), "--timeout");
        break;
      case "--wait-until":
        flags.waitUntil = consumeValue();
        break;
      case "--wait-for-selector":
        flags.waitForSelector = consumeValue();
        break;
      case "--wait-for-text":
        flags.waitForText = consumeValue();
        break;
      case "--width":
        flags.width = parseNumberOption(consumeValue(), "--width");
        break;
      case "--height":
        flags.height = parseNumberOption(consumeValue(), "--height");
        break;
      case "--full-page":
        flags.fullPage = true;
        break;
      case "--headful":
        flags.headless = false;
        break;
      default:
        throw new UsageError(`Unknown flag: ${rawFlagName}`);
    }
  }

  return {
    flags,
    positionals,
  };
}

function normalizeActionName(action) {
  const normalized = String(action ?? "")
    .trim()
    .replaceAll(/[-_]/g, "")
    .toLowerCase();

  switch (normalized) {
    case "goto":
      return "goto";
    case "click":
      return "click";
    case "fill":
      return "fill";
    case "press":
      return "press";
    case "check":
      return "check";
    case "uncheck":
      return "uncheck";
    case "select":
    case "selectoption":
      return "select";
    case "setinputfiles":
    case "upload":
      return "setInputFiles";
    case "waitfor":
    case "waitforselector":
      return "waitForSelector";
    case "waitfortext":
      return "waitForText";
    case "waitforloadstate":
      return "waitForLoadState";
    case "waitfortimeout":
    case "sleep":
      return "waitForTimeout";
    case "screenshot":
      return "screenshot";
    default:
      throw new UsageError(`Unsupported step action: ${action}`);
  }
}

function getStepTimeout(step, defaultTimeoutMs) {
  if (step.timeoutMs === undefined) {
    return defaultTimeoutMs;
  }

  return parseNumberOption(step.timeoutMs, "step.timeoutMs");
}

async function loadSteps(flags, cwd) {
  let source = null;

  if (flags.steps !== undefined) {
    source = flags.steps;
  } else if (flags.stepsFile !== undefined) {
    source = await readFile(path.resolve(cwd, flags.stepsFile), "utf8");
  } else {
    throw new UsageError("The run command requires --steps or --steps-file.");
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new UsageError("Could not parse browser steps JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new UsageError("Browser steps must be a JSON array.");
  }

  return parsed;
}

async function getPageSummary(page) {
  const [title, text] = await Promise.all([
    page.title().catch(() => ""),
    page
      .evaluate(() => document.body?.innerText || "")
      .catch(() => ""),
  ]);

  return {
    url: page.url(),
    title,
    text: truncateBrowserText(text),
  };
}

async function performAction(page, step, cwd, defaultTimeoutMs) {
  const action = normalizeActionName(step.action);
  const timeout = getStepTimeout(step, defaultTimeoutMs);

  switch (action) {
    case "goto": {
      const target = ensureLocalBrowserTarget(step.target ?? step.url);
      await page.goto(target, {
        waitUntil: step.waitUntil || "load",
        timeout,
      });
      return { action, target };
    }

    case "click": {
      if (!step.selector) {
        throw new UsageError("click steps require a selector.");
      }

      await page.locator(step.selector).click({
        timeout,
      });
      return {
        action,
        selector: step.selector,
      };
    }

    case "fill": {
      if (!step.selector) {
        throw new UsageError("fill steps require a selector.");
      }

      await page.locator(step.selector).fill(String(step.value ?? ""), {
        timeout,
      });
      return {
        action,
        selector: step.selector,
      };
    }

    case "press": {
      if (!step.key) {
        throw new UsageError("press steps require a key.");
      }

      if (step.selector) {
        await page.locator(step.selector).press(String(step.key), { timeout });
      } else {
        await page.keyboard.press(String(step.key));
      }

      return {
        action,
        key: String(step.key),
        selector: step.selector || null,
      };
    }

    case "check": {
      if (!step.selector) {
        throw new UsageError("check steps require a selector.");
      }

      await page.locator(step.selector).check({ timeout });
      return { action, selector: step.selector };
    }

    case "uncheck": {
      if (!step.selector) {
        throw new UsageError("uncheck steps require a selector.");
      }

      await page.locator(step.selector).uncheck({ timeout });
      return { action, selector: step.selector };
    }

    case "select": {
      if (!step.selector) {
        throw new UsageError("select steps require a selector.");
      }

      await page.locator(step.selector).selectOption(step.value);
      return {
        action,
        selector: step.selector,
      };
    }

    case "setInputFiles": {
      if (!step.selector) {
        throw new UsageError("setInputFiles steps require a selector.");
      }

      const rawPaths = step.paths ?? step.files ?? step.path;
      const fileList = Array.isArray(rawPaths) ? rawPaths : [rawPaths];
      if (!fileList[0]) {
        throw new UsageError("setInputFiles steps require at least one file path.");
      }

      const resolvedPaths = fileList.map((entry) => path.resolve(cwd, String(entry)));

      await page.locator(step.selector).setInputFiles(resolvedPaths, {
        timeout,
      });
      return {
        action,
        selector: step.selector,
        files: resolvedPaths,
      };
    }

    case "waitForSelector": {
      if (!step.selector) {
        throw new UsageError("waitForSelector steps require a selector.");
      }

      await page.locator(step.selector).waitFor({
        state: step.state || "visible",
        timeout,
      });
      return {
        action,
        selector: step.selector,
        state: step.state || "visible",
      };
    }

    case "waitForText": {
      if (!step.text) {
        throw new UsageError("waitForText steps require text.");
      }

      await page
        .getByText(String(step.text), {
          exact: step.exact === true,
        })
        .first()
        .waitFor({
          state: "visible",
          timeout,
        });
      return {
        action,
        text: String(step.text),
      };
    }

    case "waitForLoadState": {
      await page.waitForLoadState(step.state || "networkidle", {
        timeout,
      });
      return {
        action,
        state: step.state || "networkidle",
      };
    }

    case "waitForTimeout": {
      const delayMs = parseNumberOption(step.ms ?? step.timeoutMs ?? 250, "step.ms");
      await page.waitForTimeout(delayMs);
      return {
        action,
        delayMs,
      };
    }

    case "screenshot": {
      const outputPath = await resolveBrowserOutputPath(step.path, {
        cwd,
        prefix: "step-shot",
      });

      if (step.selector) {
        await page.locator(step.selector).screenshot({
          path: outputPath,
          timeout,
        });
      } else {
        await page.screenshot({
          path: outputPath,
          fullPage: step.fullPage === true,
          timeout,
        });
      }

      return {
        action,
        path: outputPath,
        selector: step.selector || null,
      };
    }

    default:
      throw new UsageError(`Unsupported step action: ${step.action}`);
  }
}

async function executeSteps(page, steps, cwd, defaultTimeoutMs) {
  const results = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || typeof step !== "object") {
      throw new UsageError(`Step ${index + 1} must be an object.`);
    }

    const result = await performAction(page, step, cwd, defaultTimeoutMs);
    results.push({
      index,
      ...result,
    });
  }

  return results;
}

async function withBrowserSession(flags, env, callback) {
  const browserRuntime = await inspectBrowserRuntime({ env });

  if (!browserRuntime.available || !browserRuntime.executablePath) {
    throw createBrowserError(
      "BROWSER_NOT_FOUND",
      [
        "rv-browser could not find a Chrome/Chromium-style browser executable.",
        "Set REMOTE_VIBES_BROWSER_EXECUTABLE_PATH to your browser binary if needed.",
        `Looked for PATH commands: ${browserCommandHints.join(", ")}`,
        `and app bundles such as: ${browserExecutableHints.slice(0, 5).join(", ")}`,
      ].join(" "),
    );
  }

  const browser = await chromium.launch({
    executablePath: browserRuntime.executablePath,
    headless: flags.headless !== false,
  });

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: {
        width: flags.width || DEFAULT_VIEWPORT.width,
        height: flags.height || DEFAULT_VIEWPORT.height,
      },
    });

    const page = await context.newPage();
    const result = await callback({
      browser,
      browserRuntime,
      context,
      page,
    });

    await context.close();
    return result;
  } finally {
    await browser.close();
  }
}

function writeJson(stream, payload) {
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function runDoctor(stdout, env) {
  const browserRuntime = await inspectBrowserRuntime({ env });
  writeJson(stdout, {
    ok: browserRuntime.available,
    command: "doctor",
    browser: browserRuntime,
  });

  return browserRuntime.available ? 0 : 1;
}

async function runScreenshot(positionals, flags, cwd, env, stdout) {
  if (!positionals[1]) {
    throw new UsageError("screenshot requires a localhost URL or port.");
  }

  const target = ensureLocalBrowserTarget(positionals[1]);
  const requestedOutputPath = positionals[2] || flags.output;
  const defaultTimeoutMs = flags.timeoutMs || DEFAULT_TIMEOUT_MS;

  return withBrowserSession(flags, env, async ({ browserRuntime, page }) => {
    await page.goto(target, {
      waitUntil: flags.waitUntil || "load",
      timeout: defaultTimeoutMs,
    });

    if (flags.waitForSelector) {
      await page.locator(flags.waitForSelector).waitFor({
        state: "visible",
        timeout: defaultTimeoutMs,
      });
    }

    if (flags.waitForText) {
      await page.getByText(flags.waitForText).first().waitFor({
        state: "visible",
        timeout: defaultTimeoutMs,
      });
    }

    const outputPath = await resolveBrowserOutputPath(requestedOutputPath, {
      cwd,
      prefix: "capture",
    });

    await page.screenshot({
      path: outputPath,
      fullPage: flags.fullPage === true,
      timeout: defaultTimeoutMs,
    });

    writeJson(stdout, {
      ok: true,
      command: "screenshot",
      browser: browserRuntime,
      target,
      outputPath,
      ...(await getPageSummary(page)),
    });

    return 0;
  });
}

async function runPlan(positionals, flags, cwd, env, stdout) {
  if (!positionals[1]) {
    throw new UsageError("run requires a localhost URL or port.");
  }

  const target = ensureLocalBrowserTarget(positionals[1]);
  const steps = await loadSteps(flags, cwd);
  const defaultTimeoutMs = flags.timeoutMs || DEFAULT_TIMEOUT_MS;

  return withBrowserSession(flags, env, async ({ browserRuntime, page }) => {
    await page.goto(target, {
      waitUntil: flags.waitUntil || "load",
      timeout: defaultTimeoutMs,
    });

    const stepResults = await executeSteps(page, steps, cwd, defaultTimeoutMs);
    const outputPath = flags.output
      ? await resolveBrowserOutputPath(flags.output, {
          cwd,
          prefix: "run",
        })
      : null;

    if (outputPath) {
      await page.screenshot({
        path: outputPath,
        timeout: defaultTimeoutMs,
      });
    }

    writeJson(stdout, {
      ok: true,
      command: "run",
      browser: browserRuntime,
      target,
      outputPath,
      stepResults,
      ...(await getPageSummary(page)),
    });

    return 0;
  });
}

export async function runBrowserCli(
  argv,
  {
    cwd = process.cwd(),
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  try {
    const { flags, positionals } = parseFlags(argv);
    const command = positionals[0] || (flags.help ? "help" : "");

    if (flags.help || !command || command === "help") {
      stdout.write(`${usageText()}\n`);
      return 0;
    }

    if (command === "doctor") {
      return await runDoctor(stdout, env);
    }

    if (command === "screenshot") {
      return await runScreenshot(positionals, flags, cwd, env, stdout);
    }

    if (command === "run") {
      return await runPlan(positionals, flags, cwd, env, stdout);
    }

    throw new UsageError(`Unknown command: ${command}`);
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`${error.message}\n\n${usageText()}\n`);
      return 1;
    }

    writeJson(stderr, {
      ok: false,
      error: {
        code: error.code || "BROWSER_COMMAND_FAILED",
        message: error.message || String(error),
      },
    });
    return 1;
  }
}
