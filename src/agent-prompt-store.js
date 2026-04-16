import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

export const AGENT_PROMPT_FILENAME = "agent-prompt.md";

function normalizePrompt(prompt) {
  const trimmed = String(prompt ?? "").trim();
  return trimmed ? `${trimmed}\n` : "";
}

export function getDefaultAgentPrompt() {
  return normalizePrompt(`
# Remote Vibes Agent Prompt

Remote Vibes provides \`rv-session-name\` on your session \`PATH\`.

- At the start of meaningful work, if your current session name is still generic or no longer matches the task, run \`rv-session-name "<short task label>"\`.
- Keep the session name short, human-readable, and workload-oriented.
- If the task changes materially, rename the session again so the sidebar stays accurate.
`);
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

export class AgentPromptStore {
  constructor({ stateDir }) {
    this.stateDir = stateDir;
    this.promptFilePath = path.join(stateDir, AGENT_PROMPT_FILENAME);
    this.prompt = "";
  }

  async initialize() {
    const existingPrompt = await readTextIfExists(this.promptFilePath);
    this.prompt = normalizePrompt(existingPrompt) || getDefaultAgentPrompt();
    await writeAtomic(this.promptFilePath, this.prompt);
  }
}
