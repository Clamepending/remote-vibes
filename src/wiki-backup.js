import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function getErrorMessage(error) {
  return String(error?.stderr || error?.stdout || error?.message || error || "Unknown error").trim();
}

export class WikiBackupService {
  constructor({
    wikiPath,
    enabled = true,
    intervalMs = 10 * 60 * 1000,
    execFile: execFileRunner = execFileAsync,
    now = () => new Date(),
  } = {}) {
    this.enabled = Boolean(enabled);
    this.execFile = execFileRunner;
    this.intervalMs = intervalMs;
    this.lastRunAt = null;
    this.lastStatus = "idle";
    this.lastMessage = "";
    this.lastCommit = "";
    this.now = now;
    this.timer = null;
    this.wikiPath = wikiPath;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      lastCommit: this.lastCommit,
      lastMessage: this.lastMessage,
      lastRunAt: this.lastRunAt,
      lastStatus: this.lastStatus,
      wikiPath: this.wikiPath,
    };
  }

  setConfig({ wikiPath = this.wikiPath, enabled = this.enabled, intervalMs = this.intervalMs } = {}) {
    this.wikiPath = wikiPath;
    this.enabled = Boolean(enabled);
    this.intervalMs = intervalMs;

    if (this.timer) {
      this.stop();
      this.start();
    }

    return this.getStatus();
  }

  start() {
    this.stop();

    if (!this.enabled) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runBackup({ reason: "scheduled" });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async git(args, options = {}) {
    return this.execFile("git", ["-C", this.wikiPath, ...args], options);
  }

  async ensureGitRepository() {
    let hasOwnGitRepository = false;

    try {
      const { stdout = "" } = await this.git(["rev-parse", "--show-toplevel"]);
      hasOwnGitRepository = path.resolve(stdout.trim()) === path.resolve(this.wikiPath);
    } catch {
      hasOwnGitRepository = false;
    }

    if (!hasOwnGitRepository) {
      try {
        await this.git(["init", "-b", "main"]);
      } catch {
        await this.git(["init"]);
      }
    }

    await this.ensureGitConfig("user.name", "Remote Vibes");
    await this.ensureGitConfig("user.email", "remote-vibes@local");
  }

  async ensureGitConfig(key, fallbackValue) {
    try {
      const { stdout = "" } = await this.git(["config", "--get", key]);
      if (stdout.trim()) {
        return;
      }
    } catch {
      // Missing local config is normal for freshly initialized wiki repos.
    }

    await this.git(["config", key, fallbackValue]);
  }

  async runBackup({ reason = "manual" } = {}) {
    if (!this.enabled) {
      this.lastRunAt = this.now().toISOString();
      this.lastStatus = "skipped";
      this.lastMessage = "Wiki git backup is disabled.";
      return this.getStatus();
    }

    try {
      await mkdir(this.wikiPath, { recursive: true });
      await this.ensureGitRepository();
      await this.git(["add", "-A"]);
      const { stdout = "" } = await this.git(["status", "--porcelain"]);

      if (!stdout.trim()) {
        this.lastRunAt = this.now().toISOString();
        this.lastStatus = "clean";
        this.lastMessage = "No wiki changes to back up.";
        return this.getStatus();
      }

      const timestamp = this.now().toISOString();
      await this.git(["commit", "-m", `Remote Vibes wiki backup ${timestamp}`]);
      const { stdout: commitStdout = "" } = await this.git(["rev-parse", "--short", "HEAD"]);

      this.lastRunAt = timestamp;
      this.lastStatus = "committed";
      this.lastCommit = commitStdout.trim();
      this.lastMessage = reason === "scheduled" ? "Scheduled wiki backup committed." : "Wiki backup committed.";
      return this.getStatus();
    } catch (error) {
      this.lastRunAt = this.now().toISOString();
      this.lastStatus = "error";
      this.lastMessage = getErrorMessage(error);
      return this.getStatus();
    }
  }
}
