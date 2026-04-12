import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

const MANAGED_MARKER = "<!-- remote-vibes:managed-agent-prompt -->";
const PROMPT_FILENAME = "agent-prompt.md";
const TARGET_FILES = [
  { filename: "AGENTS.md", label: "AGENTS.md" },
  { filename: "CLAUDE.md", label: "CLAUDE.md" },
  { filename: "GEMINI.md", label: "GEMINI.md" },
];

function normalizePrompt(prompt) {
  const trimmed = String(prompt ?? "").trim();
  return trimmed ? `${trimmed}\n` : "";
}

function getDefaultPrompt() {
  return normalizePrompt(`
# Remote Vibes Agent Prompt

Use the repo-local wiki in \`.remote-vibes/\` to organize experiments, findings, and open questions following Andrej Karpathy's LLM wiki pattern.

## Architecture

- \`.remote-vibes/raw/\` is the immutable source layer for copied notes, manifests, and exact experiment pointers.
- \`.remote-vibes/wiki/\` is the maintained synthesis layer.
- \`.remote-vibes/wiki/index.md\` is the entrypoint.
- \`.remote-vibes/wiki/log.md\` is append-only and chronological.

## Working Rules

- Prefer one page per experiment family under \`.remote-vibes/wiki/experiments/\`.
- Use \`.remote-vibes/raw/sources/\` for source manifests with exact paths, commands, commits, and artifact lists.
- Distinguish observed results from interpretation.
- Keep pages terse, cross-linked, and evidence-driven.

## Ingest Workflow

1. Create or update a manifest in \`.remote-vibes/raw/sources/\`.
2. Update the relevant synthesized page in \`.remote-vibes/wiki/experiments/\`.
3. Update any cross-cutting topic pages in \`.remote-vibes/wiki/topics/\`.
4. Update \`.remote-vibes/wiki/index.md\`.
5. Append a dated entry to \`.remote-vibes/wiki/log.md\`.

## Query Workflow

Start from \`.remote-vibes/wiki/index.md\`, then drill into experiment and topic pages. Prefer citing exact source manifests and result files.
`);
}

function renderManagedFile(prompt, sourcePath) {
  return `${MANAGED_MARKER}
<!-- Edit this from Remote Vibes or ${sourcePath}. -->

${normalizePrompt(prompt)}`;
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

async function writeAtomic(filePath, nextContent) {
  const tempFilePath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempFilePath, nextContent, "utf8");
  await rename(tempFilePath, filePath);
}

async function ensureFile(filePath, nextContent) {
  const currentContent = await readTextIfExists(filePath);

  if (currentContent !== null && currentContent.trim() && !currentContent.includes(MANAGED_MARKER)) {
    return {
      path: filePath,
      status: "conflict",
    };
  }

  if (currentContent === nextContent) {
    return {
      path: filePath,
      status: "unchanged",
    };
  }

  await writeAtomic(filePath, nextContent);
  return {
    path: filePath,
    status: currentContent === null ? "created" : "updated",
  };
}

export class AgentPromptStore {
  constructor({ cwd, stateDir }) {
    this.cwd = cwd;
    this.stateDir = stateDir;
    this.promptFilePath = path.join(stateDir, PROMPT_FILENAME);
    this.prompt = "";
    this.targets = [];
  }

  async initialize() {
    const prompt = (await readTextIfExists(this.promptFilePath)) ?? getDefaultPrompt();
    await this.persistPrompt(prompt);
    await this.ensureWikiScaffold();
    this.targets = await this.syncManagedFiles();
  }

  async getState() {
    return {
      prompt: this.prompt,
      promptPath: path.relative(this.cwd, this.promptFilePath) || PROMPT_FILENAME,
      wikiRoot: ".remote-vibes",
      targets: this.targets,
    };
  }

  async save(prompt) {
    await this.persistPrompt(prompt);
    await this.ensureWikiScaffold();
    this.targets = await this.syncManagedFiles();
    return this.getState();
  }

  async persistPrompt(prompt) {
    this.prompt = normalizePrompt(prompt) || getDefaultPrompt();
    await writeAtomic(this.promptFilePath, this.prompt);
  }

  async syncManagedFiles() {
    const sourcePath = path.relative(this.cwd, this.promptFilePath) || PROMPT_FILENAME;
    const rendered = renderManagedFile(this.prompt, sourcePath);

    return Promise.all(
      TARGET_FILES.map(async ({ filename, label }) => ({
        label,
        ...(await ensureFile(path.join(this.cwd, filename), rendered)),
      })),
    );
  }

  async ensureWikiScaffold() {
    const scaffold = [
      {
        filePath: path.join(this.stateDir, "README.md"),
        content: "# Remote Vibes Wiki\n\nCanonical wiki root for this workspace.\n",
      },
      {
        filePath: path.join(this.stateDir, "raw", "sources", ".gitkeep"),
        content: "",
      },
      {
        filePath: path.join(this.stateDir, "wiki", "experiments", ".gitkeep"),
        content: "",
      },
      {
        filePath: path.join(this.stateDir, "wiki", "topics", ".gitkeep"),
        content: "",
      },
      {
        filePath: path.join(this.stateDir, "wiki", "index.md"),
        content: "# Wiki Index\n\n- Add experiment pages under `experiments/`.\n- Add cross-cutting pages under `topics/`.\n- Append major updates to `log.md`.\n",
      },
      {
        filePath: path.join(this.stateDir, "wiki", "log.md"),
        content: "# Wiki Log\n\n",
      },
    ];

    await Promise.all(
      scaffold.map(async ({ filePath, content }) => {
        const currentContent = await readTextIfExists(filePath);
        if (currentContent !== null) {
          return;
        }

        await writeAtomic(filePath, content);
      }),
    );
  }
}
