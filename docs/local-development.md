# Local Development

Use two checkouts with different jobs:

- `/Users/mark/Desktop/projects/vibe-research` is the source checkout for development.
- `/Users/mark/.vibe-research/app` is the installed app that serves the everyday `http://localhost:4826`.

Keep those separate. Do not edit the installed app for normal development; patch it only for emergency live recovery, then port the fix back to the source checkout and release it.

## Daily Loop

From the source checkout:

```sh
cd /Users/mark/Desktop/projects/vibe-research
git fetch origin --tags
git status --short --branch
npm install
npm run build
VIBE_RESEARCH_PORT=4828 \
VIBE_RESEARCH_STATE_DIR="$PWD/output/dev-state" \
VIBE_RESEARCH_WORKSPACE_DIR="/Users/mark/vibe-projects" \
node src/server.js
```

Or use the shorthand:

```sh
npm run dev:local
```

Open `http://localhost:4828` for development. Leave `http://localhost:4826` for the installed app.

## Local Claude/Ollama Agent

Vibe Research exposes `Local Claude Code (Ollama)` as an agent provider when both `claude` and `ollama` are installed. It launches the regular Claude Code harness, but routes Anthropic API calls to Ollama's Anthropic-compatible endpoint at `http://localhost:11434`.

Useful knobs:

```sh
export VIBE_RESEARCH_CLAUDE_OLLAMA_MODEL=qwen3.5
export VIBE_RESEARCH_CLAUDE_OLLAMA_BASE_URL=http://localhost:11434
```

For a tiny response-only proof model:

```sh
ollama pull qwen2.5-coder:1.5b
VIBE_RESEARCH_CLAUDE_OLLAMA_MODEL=qwen2.5-coder:1.5b npm run dev:local
```

For a still-small local model that has passed a basic Claude Code tool-use smoke in Vibe Research:

```sh
ollama pull qwen3:1.7b
VIBE_RESEARCH_CLAUDE_OLLAMA_MODEL=qwen3:1.7b npm run dev:local
```

For stronger day-to-day local use, prefer a model with good tool calling and a large context window; Ollama's Claude Code docs currently recommend at least 64k context for this harness.

## Ship Loop

Use a clean worktree when shipping:

```sh
git fetch origin --tags
git worktree add /tmp/vibe-research-ship origin/main
cd /tmp/vibe-research-ship
npm install
npm run build
npm test
```

Commit and push from the clean worktree. Cut releases only from `main`.

## Directory Map

- `src/`: server services and client source.
- `src/client/main.js`: browser UI entrypoint. This file is large, so prefer extracting new reusable server/client modules instead of growing it for unrelated behavior.
- `public/`: static assets. `public/app.js` and `public/vendor/` are generated and ignored.
- `test/`: Node and browser integration tests.
- `desktop/`: Electron wrapper. `desktop/dist/` and `desktop/node_modules/` are generated.
- `output/`: local development state, screenshots, and temporary artifacts.
- `.playwright-cli/`: local browser automation logs.
- `vibe-research/`: local workspace/runtime content created by the app; ignored.

## Cleanup Rules

Safe to regenerate:

- `node_modules/`
- `desktop/node_modules/`
- `desktop/dist/`
- `.playwright-cli/`
- `output/`
- `public/app.js`
- `public/vendor/`

Check before deleting:

- `.claude/worktrees/`
- `/private/tmp/vibe-research-*` worktrees
- dirty tracked files in `/Users/mark/Desktop/projects/vibe-research`

If `localhost:4826` behaves differently from your source checkout, check these first:

```sh
lsof -nP -iTCP:4826 -sTCP:LISTEN
git -C /Users/mark/.vibe-research/app describe --tags --always --dirty
stat -f "%Sm %N" /Users/mark/.vibe-research/app/public/app.js /Users/mark/.vibe-research/app/src/client/main.js
```
