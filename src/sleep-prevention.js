import { spawn } from "node:child_process";

function getErrorMessage(error) {
  return String(error?.message || error || "Unknown error").trim();
}

export class SleepPreventionService {
  constructor({
    enabled = true,
    platform = process.platform,
    spawnProcess = spawn,
  } = {}) {
    this.active = false;
    this.child = null;
    this.command = "";
    this.enabled = Boolean(enabled);
    this.lastMessage = "";
    this.lastStatus = this.enabled ? "idle" : "disabled";
    this.platform = platform;
    this.spawnProcess = spawnProcess;
    this.stopRequested = false;
    this.supported = platform === "darwin";
  }

  getStatus() {
    return {
      active: this.active,
      command: this.command,
      enabled: this.enabled,
      lastMessage: this.lastMessage,
      lastStatus: this.lastStatus,
      pid: this.child?.pid || null,
      supported: this.supported,
    };
  }

  start() {
    if (!this.enabled) {
      this.lastStatus = "disabled";
      this.lastMessage = "Sleep prevention is disabled.";
      return this.getStatus();
    }

    if (!this.supported) {
      this.active = false;
      this.lastStatus = "unsupported";
      this.lastMessage = "Sleep prevention is only supported on macOS right now.";
      return this.getStatus();
    }

    if (this.child) {
      return this.getStatus();
    }

    this.command = "caffeinate -dimsu";
    this.stopRequested = false;

    try {
      const child = this.spawnProcess("caffeinate", ["-dimsu"], {
        stdio: "ignore",
      });

      this.child = child;
      this.active = true;
      this.lastStatus = "active";
      this.lastMessage = "Preventing this computer from sleeping.";

      child.once?.("error", (error) => {
        if (this.child !== child) {
          return;
        }

        this.child = null;
        this.active = false;
        this.lastStatus = "error";
        this.lastMessage = getErrorMessage(error);
      });

      child.once?.("exit", (code, signal) => {
        if (this.child !== child) {
          return;
        }

        this.child = null;
        this.active = false;

        if (this.stopRequested || !this.enabled) {
          this.lastStatus = "disabled";
          this.lastMessage = "Sleep prevention is disabled.";
          return;
        }

        this.lastStatus = "stopped";
        this.lastMessage = `Sleep prevention stopped unexpectedly (${signal || code || "exit"}).`;
      });
    } catch (error) {
      this.child = null;
      this.active = false;
      this.lastStatus = "error";
      this.lastMessage = getErrorMessage(error);
    }

    return this.getStatus();
  }

  stop() {
    this.stopRequested = true;
    const child = this.child;
    this.child = null;
    this.active = false;

    if (child && !child.killed) {
      child.kill?.();
    }

    this.lastStatus = "disabled";
    this.lastMessage = "Sleep prevention is disabled.";
    return this.getStatus();
  }

  setConfig({ enabled = this.enabled } = {}) {
    this.enabled = Boolean(enabled);

    if (this.enabled) {
      return this.start();
    }

    return this.stop();
  }
}
