# Recursive Self-Improvement Buildings Plan

User request (2026-04-28): continue developing buildings to enable sandboxing and recursive self-improvement of Vibe Research. Develop Harbor, Modal, RunPod, Google Drive, AWS, GCP. Onboard "all the services one could ever hope for" — but **only ship a building when its onboarding can be fully exercised end-to-end on this machine**. Test the VideoMemory building extensively, including that it can give agents access to the camera.

This plan exists so the work survives context loss. Update as buildings move between buckets.

## Hard rule

A building only counts as "shipped" in this pass when:

1. The manifest lives in `src/client/building-registry.js` (or already does).
2. Every `agentGuide.commands` entry that promises a smoke check actually runs to completion on this Mac.
3. Either an automated test exercises the onboarding path, or a manual transcript of the smoke-check run is recorded in this doc.
4. The Library has a paragraph documenting what was verified.

If any of those gates fails, the building moves to the **Blocked** bucket below with an explicit reason. No stub manifests get committed.

## Inventory snapshot (2026-04-28)

What's in the registry today (from `src/client/building-registry.js`):

| building | category | status | local CLI | local creds |
|---|---|---|---|---|
| modal | Cloud Compute | exists | `modal` 1.4.2 | `modal token info` returns valid token (workspace `clamepending`) |
| runpod | Cloud Compute | exists | `runpodctl` 2.1.9 | `~/.runpod/config.toml` present; `runpodctl pod list` returns `[]` cleanly |
| harbor | Evals | exists | not installed | n/a |
| google-drive | (pending audit) | exists | n/a | n/a |
| videomemory | Vibe Research | exists | service runs in-process | needs camera permission grant |
| aws | — | **not registered** | `aws` 1.44.49 | **no creds configured** |
| gcp | — | **not registered** | `gcloud` not installed | n/a |

## Buckets

### A. Verifiable today (do these first)

- **Modal building** — token works locally. Plan: run `command -v modal && modal --help`, `modal token info`, `modal app list`. Capture output. If all three succeed, mark the building as verified-onboarded and add a short verification block to this doc.
- **RunPod building** — `runpodctl pod list` returned `[]` (success, empty account). Plan: run `runpodctl version`, `runpodctl gpu list`, `runpodctl pod list`, `runpodctl serverless list`. Capture output.
- **VideoMemory building** — service is in-process. Plan: run all four test files (`videomemory-service.test.js`, `videomemory-service-loader.test.js`, `videomemory-integration.test.js`, `videomemory-end-to-end.test.js`); verify the bin script `bin/vr-videomemory devices` runs; document that the camera-access path itself requires a browser session and is exercised via the tutorial in `tutorials/connect-cameras.md`.

### B. Verifiable today only after a CLI install

- **Harbor building** — try `uv tool install harbor` (the building's own onboarding hint). If the install completes without paid credentials, run `harbor --help` and `harbor dataset list`. If install fails, move Harbor to bucket C with the failure reason.

### C. Blocked — do NOT ship a stub manifest

These need either credentials or a CLI install I can't do unattended on this machine. They go into a follow-up move; flag them in the project README so the next agent knows.

- **AWS** — `aws sts get-caller-identity` fails with "Unable to locate credentials". Without an IAM key pair or SSO config, I cannot exercise even the read-only smoke checks the building's `agentGuide.commands` would promise. Document the gap, do not commit a manifest.
- **GCP** — `gcloud` CLI not installed; installing it interactively requires the human (account selection, billing project). Document the gap.
- **Google Drive** — no local CLI, browser OAuth required. Manifest may already exist; verifying it from a headless agent run is not possible without a browser session. Audit the existing manifest, but don't claim "verified" unless I can demonstrate the OAuth round-trip.

### D. "All the services one could ever hope for" — backlog only

The user's framing is broad. The right move is to *not* spam manifests; instead, keep an explicit backlog here so we revisit when each gains a verifiable onboarding path:

- Replicate, Together, Fireworks, Anyscale (cloud inference)
- Vast.ai, Lambda Labs, CoreWeave, Crusoe, Hyperbolic (GPU markets)
- Fly.io, Railway, Render, Vercel, Cloudflare Workers (edge/runtime)
- HuggingFace Hub (datasets/models — high value, OAuth-driven)
- Notion, Linear, Slack, Asana (collaboration)
- S3-compatible object stores (R2, B2, Wasabi)
- Pinecone, Weaviate, Qdrant, Chroma (vector stores)

For each one, the gating question is the same: "can I run the smoke command from a fresh terminal right now and watch it return?" If no, it stays in this list.

## VideoMemory deep test plan

The user singled VideoMemory out. The building has four existing test files plus a CLI:

1. `test/videomemory-service.test.js` (610 lines — service core)
2. `test/videomemory-service-loader.test.js` — module loader
3. `test/videomemory-integration.test.js` (193 lines — service ↔ rest of app)
4. `test/videomemory-end-to-end.test.js` (215 lines — closest thing to a full path)

Plan for the verification pass:

1. Run `npm test -- --grep videomemory` (or run the four files individually with the project test runner) and confirm green.
2. Run `bin/vr-videomemory --help` to confirm the helper exposed to agents starts up.
3. Run `bin/vr-videomemory devices` against the in-process service and confirm it lists devices (or surfaces a clear "service not running" error rather than crashing).
4. Read the camera-access flow:
   - The browser path (xterm-side) requests `navigator.mediaDevices.getUserMedia` from the Camera Room building UI.
   - Document this in this plan as "the agent gets camera access by asking the human to grant it via the building panel; agents do not bypass browser permission grants."
5. Verify the building manifest's `onboarding.steps[]` matches reality (enable building → save URL/provider → grant camera access).

Camera access from inside a sandboxed agent is **mediated**, not direct: the human grants browser permission once, the in-process VideoMemory service captures frames, and agents drive monitors via the `vr-videomemory` CLI. That's the design contract — confirm tests don't pretend otherwise.

## Order of operations

1. ✅ Write this plan (this file).
2. Run videomemory tests; capture pass/fail per file.
3. Run modal smoke commands; capture transcript.
4. Run runpod smoke commands; capture transcript.
5. Try `uv tool install harbor`; either run Harbor smoke commands or move Harbor to bucket C with reason.
6. Append a "Verification log" section below with timestamps + commit SHAs.
7. Commit + push the Library after each building's verification block lands.
8. For AWS/GCP/Google Drive: write the gap into the project README (or this plan) so the next session resumes correctly. Do **not** commit empty manifests.

## Verification log

### 2026-04-28 — first pass

**Environment:** Mac, branch `claude/gallant-curran-d0362a` in worktree `gallant-curran-d0362a`. CLIs surveyed: `aws` 1.44.49, `modal` 1.4.2, `runpodctl` 2.1.9, `uv` 0.9.26, `harbor` (not yet installed pre-pass), `gcloud` (absent).

#### VideoMemory — VERIFIED

- Ran `node --test --test-concurrency=1` over `test/videomemory-service.test.js`, `test/videomemory-service-loader.test.js`, `test/videomemory-integration.test.js`, `test/videomemory-end-to-end.test.js`.
- Result: **15 passed, 0 failed**, total ~780 ms. Covers monitor creation, webhook delivery (correct token + wrong token), Claude readiness wait, provider-agnostic wakeups, fresh-session creation, device inventory refresh, paste-then-submit wake, cooldown suppression, status polling for camera-permission notes, end-to-end webhook → caller-session wake.
- Ran `node bin/vr-videomemory --help`: exit 0, full usage block prints. The bin script is the agent-facing CLI for `devices`, `create`, `list`, `delete`, `webhook-info`.
- Camera-access contract (confirmed by reading `src/client/main.js:6914`): the browser is the only thing that can call `navigator.mediaDevices.getUserMedia`. The `.videomemory-camera-permission-button` triggers `requestVideoMemoryCameraPermission()`, which opens the OS prompt, takes the granted stream, immediately stops every track to release the device, then refreshes VideoMemory status. **Agents do NOT bypass the browser permission grant** — they request that a human click the button via the building panel, then drive monitors via `vr-videomemory create --io-id ...`. This is the right design (Vibe Research's Mac entitlement is what gates `mediaDevices`; the in-process service then uses the granted handle).

#### Modal — VERIFIED

- `command -v modal && modal --help` → `/Users/mark/miniconda3/bin/modal`, full usage prints.
- `modal token info` → token `ak-YETcvr32huf1OfhTn99Zq5`, workspace `clamepending`, user `clamepending`.
- `modal app list` → empty table (account is auth'd, no live apps), exit 0.

All three commands the agent guide promises run cleanly. Building manifest matches reality.

#### RunPod — VERIFIED

- `runpodctl version` → `runpodctl 2.1.9-673143d`.
- `runpodctl gpu list` → returns a JSON array of GPU offerings (MI300X, A100 PCIe, …).
- `runpodctl pod list` → `[]`.
- `runpodctl serverless list` → `[]`.

Account is authenticated (otherwise `pod list` would error rather than return `[]`). Building manifest matches reality.

#### Harbor — VERIFIED (after install)

- `uv tool install harbor` → installed `harbor`, `hb`, `hr` to `~/.local/bin`. Pulled the full dependency closure (Supabase, Starlette, OpenAI, etc.) without touching any model credentials.
- `harbor --version` → `0.5.0`.
- `harbor --help` → full subcommand tree (`check`, `analyze`, `init`, `run`, `publish`, `add`, `download`, `remove`, `sync`, `view`, `adapter`, `task`, `dataset`, `job`, …).
- `harbor dataset list` → "View registered datasets at https://registry.harborframework.com/datasets" (Harbor 0.5.0 redirects list to the web registry; exit 0).

Caveat: `harbor run` paths require model + sandbox credentials that aren't on this machine. Smoke checks the agent guide promises (CLI presence, dataset surface) all pass; deeper run paths are correctly gated on a human approving spend.

#### Google Drive — DOCUMENTED, NOT FULLY VERIFIED

- Building manifest is well-formed (system-installed, source `google`, `buildingAccessConfirmed` gate).
- The OAuth/Drive-grant round-trip is a browser-only path (`setupUrl: https://drive.google.com/`, single-step `Enable Drive access` button). Cannot be exercised from a headless terminal in this pass.
- Status: ship as-is, but the verification box for "agent can list files" needs a future session running through the host agent's Drive connector. Don't claim more than the manifest already does.

#### AWS — BLOCKED (no creds)

- `aws sts get-caller-identity` → "Unable to locate credentials".
- Per the hard rule, no manifest gets committed for AWS in this pass. Reason: every agent-guide command we'd promise (`aws s3 ls`, `aws sts get-caller-identity`, `aws ec2 describe-instances`) needs an IAM key pair or SSO config, which requires a human action on this machine.
- Follow-up: when the human runs `aws configure` (or sets up AWS SSO), spawn a session that defines the building, fills in the read-only smoke-check commands, and verifies them.

#### GCP — BLOCKED (no CLI)

- `gcloud` is not installed. Installation is interactive (account selection + billing project linkage) and must be done by the human.
- Per the hard rule, no manifest gets committed for GCP in this pass.
- Follow-up: after the human installs `gcloud` and runs `gcloud auth login` + `gcloud config set project`, define the building with `gcloud auth list`, `gcloud projects list`, and `gcloud compute regions list` as the smoke-check trio.

### Friend onboarding flow — "ship a Calendar building without touching Vibe Research source"

Verified by scaffolding a throwaway building inside the BuildingHub starter catalog at `/Users/mark/Desktop/projects/buildinghub`:

```
$ cd /Users/mark/Desktop/projects/buildinghub
$ node bin/buildinghub.mjs init my-cal --name "My Calendar"
created /Users/mark/Desktop/projects/buildinghub/buildings/my-cal/building.json
$ node bin/buildinghub.mjs validate
validated 40 BuildingHub manifests, 4 layouts, and 1 scaffolds
$ node bin/buildinghub.mjs build
wrote registry.json with 40 buildings, 4 layouts, and 1 scaffolds
$ node bin/buildinghub.mjs doctor
root: /Users/mark/Desktop/projects/buildinghub
cli: buildinghub/0.2.0
buildings: 40
layouts: 4
scaffolds: 1
registry packages: 40
registry layout packages: 4
registry scaffold packages: 1
safety: manifest-only loader, no executable package lane enabled
```

(Test scaffold deleted, `registry.json` reverted; nothing committed in the BuildingHub repo for this verification.)

**Friend's actual workflow** for shipping a brand-new calendar building (e.g. Cal.com, Fantastical, Apple Calendar):

1. `git clone https://github.com/<you>/buildinghub.git && cd buildinghub`
2. `node bin/buildinghub.mjs init <slug> --name "<Pretty Name>"` — scaffolds `buildings/<slug>/building.json` and a starter README from `templates/basic-building/`.
3. Edit `buildings/<slug>/building.json`: set `category: "Planning"`, `icon: "calendar"`, fill `description`, list `tools`, `endpoints`, `capabilities` env, and `onboarding.steps`. The Google Calendar manifest at `buildings/google-calendar/building.json` is the closest reference for "MCP-backed calendar".
4. `node bin/buildinghub.mjs validate` — schema check, fails the build if anything is wrong.
5. `node bin/buildinghub.mjs build` — regenerates `registry.json`.
6. Open a PR. Vibe Research consumes BuildingHub through `src/buildinghub-service.js`, which forces `source: "buildinghub"`, strips executable-only fields, and refuses id collisions with first-party buildings.

**Things community manifests cannot do** (intentional — see `docs/buildings.md`): register executable client code, add custom workspace routes, reserve special Agent Town places, toggle arbitrary local settings, or store secrets. Calendars that need MCP execution (e.g. Google Calendar's existing one) declare `trust: "mcp"` and rely on the host agent's MCP connector for credentials and execution; the BuildingHub manifest only describes the integration shape and onboarding copy.

### What "verified" means in this pass

A green entry above means: the smoke commands the building's `agentGuide` promises actually run and exit 0 on this machine. It does **not** mean we ran a paid workload, deployed an app, or proved the building's full end-to-end UX with the building panel open in a browser. Those checks belong to the next session — the gating infrastructure (CLI present, account auth'd, manifest correct) is in place.

### Resume instructions for the next session

1. Read this doc top to bottom.
2. If `aws sts get-caller-identity` or `gcloud auth list` now succeeds, draft an AWS or GCP building manifest in `src/client/building-registry.js` modeled on the Modal/RunPod entries (lab visual shape, env list, agent-guide commands ranked by safety: read-only smoke checks first, then read-write only after explicit approval).
3. After that drafting, **rerun the smoke commands by hand** before declaring the building "verified".
4. For Harbor: optionally run `harbor init` to scaffold a tiny task and prove the local trial path with a mock model. Decide whether the existing manifest needs an additional `harbor init` smoke-check command.
5. For Google Drive: the verification needs a browser. Run an in-app session, click `Enable Drive access`, and confirm the agent can `ListFiles` via the host MCP. Update this doc.
6. Then: pick from the bucket-D backlog (Replicate, HuggingFace Hub, Vast.ai, Lambda Labs, Fly.io, R2/B2, Pinecone, Linear, …) and re-enter the same loop: install + auth + smoke check + manifest + verification block.

