# Swarmlab Canvas Use-Case Audit

Date: 2026-05-14

Purpose: pressure-test Swarmlab as the unified research/control canvas for a user with a Mac, remote GPU machines, edge machines, browser/app surfaces, agents, live monitors, and a Markdown brain.

## Verdict

The platform is now viable as a local-first fleet canvas prototype. It handles the core board metaphor: machine regions, local and remote agent cards, launcher dock, terminal-as-canvas, app/port previews, W&B monitor cards, Markdown brain entry, machine-region resize, and account-safe redacted remote snapshots.

The biggest unresolved product gaps are not basic canvas rendering. They are:

- True account-first onboarding is still incomplete: login should provision Library/workspace defaults and auto-populate curl-installed machines without manual decisions.
- True state migration is not implemented. Dragging an agent to another machine creates or offers a copy/capsule while the original keeps running. That is safe, but it is not full process/context migration.
- Remote application launch is command-queued, but full remote GUI/app streaming and rich browser control are still limited by grants, pairing, and node reachability.
- The Markdown brain is visible and openable, but not yet a first-class editable canvas surface with backlinks/graph/workflow cards.
- Production account web parity is not proven end to end. Local desktop/browser canvas is ahead of hosted account access.

## Use-Case Matrix

| Use case | What users expect | Current handling | Evidence | Status |
| --- | --- | --- | --- | --- |
| First install on one machine | `curl` install, log in, see this machine without choosing repo/library internals | Installer and node snapshot support exist; canvas shows local region and Vibe account login. Account-first Library provisioning is still a product gap | `README.md`, `docs/vibe-account-machine-dashboard.md`, `test/node-routes.test.js` | Partial |
| Multiple machines online | Mac, GPU box, Pi, and servers appear as regions in one canvas | Local + remote redacted snapshots render as machine regions with rail navigation and compact unreachable states | `test/canvas-ui.test.js`, `test/fleet-registry.test.js`, `test/node-heartbeat-service.test.js` | Good prototype |
| Launch local coding agents | Start Claude Code, Codex, OpenSwarm from the canvas and continue in native chat | Agent-provider launcher dock starts sessions, focuses card, focuses composer | `test/canvas-ui.test.js`, `test/canvas-model.test.js`, live canvas smoke | Good |
| Open persistent terminal in canvas | Terminal should be a canvas surface, not a desktop app node | Shell provider maps to Terminal launcher; terminal cards use monospace, compact composer, and hide prompt-only residue | `test/canvas-ui.test.js` | Good |
| Launch agents on remote machines | Select a machine region and start an agent there if paired | Paired/account remote nodes accept signed command-queue launch; view-only nodes ask to pair first | `test/canvas-ui.test.js`, `test/node-command-relay-service.test.js` | Good prototype |
| Move agent card between machines | Drag card into another region without killing the source session | Canvas treats this as relocation/copy. Source keeps running; commandable target can start a capsule copy; view-only target asks to pair | `test/canvas-ui.test.js`, `src/client/canvas/local-canvas-view.js` | Safe partial |
| True agent/process state migration | Drop an agent on another machine and migrate complete process/context/state | Not implemented. Needs provider-specific checkpoint/export/import and artifact transfer semantics | No automated coverage yet | Gap |
| GPU train -> Pi deploy | Start a handoff that trains on GPU, transfers artifact, validates on Pi, writes result to brain | Handoff cards, steps, open-agent action, and launch path exist. Full artifact movement is still mostly agent/workflow convention | `test/canvas-ui.test.js`, `test/handoff-job-store.test.js` | Partial |
| W&B/TensorBoard/live monitors | Agent starts experiment and monitor appears connected to agent | W&B URLs are promoted to monitor cards linked by canvas pipe; generic app/port previews work | `test/canvas-model.test.js`, `test/canvas-ui.test.js` | Good for W&B/ports |
| Browser/app components | Browser tabs and localhost apps appear as visual components, not hidden port lists | Browser cards and previewable app port cards render inline; noisy port remainder is compacted | `test/canvas-model.test.js`, `test/canvas-ui.test.js` | Good prototype |
| Desktop app launchers | Apps are buttons/dock items until launched; launched instances become cards | Dock separates launchers from instances; app instances can be dismissed without closing app | `test/app-launchers.test.js`, `test/canvas-ui.test.js`, `test/app-instance-store.test.js` | Good |
| Markdown brain/wiki | User can open research memory and see notes related to the work | Brain card summarizes notes and links to Library. Full canvas-native wiki editing/graph is not first-class yet | `test/canvas-model.test.js`, `test/canvas-ui.test.js`, `test/knowledge-base-graph-build.test.js` | Partial |
| Offline/stale machines | Dead machines should not break the board or reserve huge space | Offline/unreachable nodes get compact regions/cards and clear status | `test/canvas-ui.test.js`, `test/fleet-registry.test.js` | Good |
| Privacy/account-safe fleet view | Remote summaries must not leak paths, tokens, URLs, env, raw transcript text | Redacted snapshots and heartbeat tests strip secrets/paths/tokenized URLs; W&B URLs strip tokens | `test/node-routes.test.js`, `test/node-heartbeat-service.test.js`, `test/canvas-ui.test.js` | Good, keep hardening |
| Layout work surface | Users should drag cards, resize machine regions, zoom/pan, recover from bad saved viewport | Drag layout, region resize, viewport persistence/recovery, dock/controls overlap tests exist | `test/canvas-ui.test.js`, `test/canvas-model.test.js` | Good |
| Phone/tablet/web use | The same canvas should be usable from narrow browser/device widths | Tests cover in-app-browser width and dock/control overlap. Hosted account web parity still not proven | `test/canvas-ui.test.js` | Partial |

## Test Plan To Keep

Run before shipping meaningful canvas changes:

```sh
npm run build
node --test --test-concurrency=1 test/canvas-model.test.js
node --test --test-concurrency=1 test/canvas-ui.test.js
node --test --test-concurrency=1 test/node-routes.test.js
node --test --test-concurrency=1 test/node-heartbeat-service.test.js
node --test --test-concurrency=1 test/node-command-relay-service.test.js
node --test --test-concurrency=1 test/app-launchers.test.js
node --test --test-concurrency=1 test/app-instance-store.test.js
node --test --test-concurrency=1 test/handoff-job-store.test.js
```

Manual/live smoke on `http://localhost:4828/?view=canvas`:

1. Confirm the header shows local machine and remote-online count.
2. Confirm no "Add machine" primary button is visible; account login/pairing is the primary path.
3. Confirm the launcher dock shows agent providers as "Start in canvas", Terminal as "Open in canvas", and desktop apps as "Open desktop".
4. Launch Terminal; verify a terminal card appears, composer is focused, and prompt-only residue does not render as useful history.
5. Launch Codex or Claude Code; verify card focus and native composer.
6. Select a paired remote machine; launch a remote agent and verify queued lifecycle/copy card appears.
7. Drag a local agent card into a paired machine region; verify source agent stays running and copy/capsule messaging is explicit.
8. Open W&B/monitor/app cards and verify tokenized URLs are stripped.
9. Resize a machine region; refresh and verify persisted bounds.
10. Narrow the browser to tablet width; verify dock and zoom controls do not overlap.

## Next Product Tests To Add

- Hosted account-web test: account registry returns two live machines and the web canvas can open each machine board.
- Full "curl install -> login -> heartbeat -> account canvas region appears" integration test.
- Agent capsule quality test: copied agent receives enough source context, source id, target machine id, and artifact-transfer instructions.
- Brain canvas test: create/edit a Markdown note from a canvas card, render backlinks, and survive refresh.
- Remote app launch lifecycle test with a launched browser/W&B instance becoming a canvas card on the remote region.
- Mobile approval test: a pending action from remote GPU appears on phone-sized canvas and can be approved without exposing raw terminal logs.
