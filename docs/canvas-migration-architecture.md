# Swarmlab Canvas Migration Architecture

Date: 2026-05-12
Status: design proposal
Confidence: high on product direction; moderate on exact frontend implementation path.

## Executive Verdict

Swarmlab should replace Agent Town as the primary visual shell with a spatial canvas of work objects: agents, terminals, browsers, local apps, approvals, artifacts, repos, machines, and dashboards. Agent Town should become an optional theme or onboarding skin, not the default control surface.

The reason is blunt: an RPG town is a metaphor, while a spatial dashboard is the thing itself. The user is not trying to watch characters walk around. The user is trying to supervise concurrent work across machines, see what each agent is doing, inspect browser/app artifacts, approve blocked actions, and move between local and remote nodes without losing context.

OpenSwarm's canvas is the right reference model. Its README describes the core product as a locally running orchestrator with an infinite canvas, drag-and-drop agent cards, view cards, browser cards, unified approvals, persistent session history, git worktree isolation, diff viewing, WebSockets, and dashboard layout persistence. That maps much more directly onto Swarmlab's actual job than the current Agent Town map.

The migration should not be a wholesale OpenSwarm fork. Swarmlab already has important primitives that OpenSwarm does not solve for us: curl installer, local daemon, persistent terminal sessions, Tailscale/local-port discovery, BuildingHub/buildings, research Library, action items, agent canvases, browser-use sessions, VideoMemory/OttoAuth integrations, GPU/system metrics, and a desktop shell. We should steal the interface pattern, not replace the product core.

## OpenSwarm Lessons To Adopt

Source inspected: https://github.com/openswarm-ai/openswarm on 2026-05-12.

Keep these ideas:

- Spatial dashboard as the primary surface. Cards are work objects, not decorations.
- Multiple dashboards per workspace or purpose.
- Agent cards that can expand into a full chat/transcript.
- Browser cards embedded in the canvas.
- View/output cards for generated HTML/JS artifacts.
- Notes/cards for lightweight planning state.
- Pan, zoom, drag, resize, z-order, selection, minimap, and keyboard commands.
- Unified approval workflow across all agents.
- Worktree/branch isolation displayed directly in the UI.
- Dashboard-level WebSocket events, plus per-session WebSocket streams.
- Persisted layout state independent of session history.
- Direct diff inspection from an agent card.
- Cost/time/status summaries at card level.

Reject or defer these:

- Full React/Redux/MUI rewrite as a prerequisite. Swarmlab's current client is a large custom bundle; a rewrite would stall product progress.
- Python/FastAPI backend migration. Swarmlab's Node/Express server is already wired into PTYs, install scripts, local settings, Electron, Tailscale, buildings, and research tooling.
- OpenSwarm's single-machine assumption. Swarmlab's bigger opportunity is a fleet dashboard across Mac, Pi, GPU boxes, and clusters.
- Any cloud-by-default telemetry model. Cloud account support should be for node registry, presence, optional relay, and account access, not for uploading raw local secrets.

## Current Swarmlab Assets

Swarmlab already has most of the backend objects a canvas needs.

| Capability | Current anchor | Migration role |
| --- | --- | --- |
| Local daemon state | `GET /api/state` in `src/create-app.js` | Boot snapshot for local machine card and local canvas |
| Sessions | `SessionManager.listSessions()` in `src/session-manager.js` | Agent cards and terminal cards |
| Project graph | `/api/projects/swarm` and `/api/sessions/:id/swarm` | Seed edges between repo, worktrees, sessions, subagents, touched files |
| Action items | `src/agent-town-store.js` and `/api/agent-town/action-items` | Approval/review cards and global inbox overlay |
| Agent canvases | `/api/agent-town/canvases` | Artifact cards; should be renamed conceptually to canvas artifacts |
| Browser automation | `src/browser-use-service.js` | Browser cards and browser-task cards |
| Local app ports | `src/ports.js`, `/api/ports`, Tailscale Serve support | App cards and port dock cards |
| System metrics | `/api/system`, GPU restrictions | Machine health cards |
| Desktop wrapper | `desktop/src/main.cjs` | Native host for local node and future node switcher |
| Account primitive | BuildingHub account token store/service | Seed pattern for Vibe account node registry |
| Buildings | `src/client/building-registry.js`, `src/buildinghub-service.js` | Integration cards and capability inventory |

The current visual implementation is split between `visual-interface`, `swarm`, and Agent Town rendering in `src/client/main.js`. This is the first thing to unwind. The system object model is useful; the RPG rendering is the weak layer.

## Target Product Model

The canvas should expose real work objects.

### Machine

A machine is one Swarmlab install. Examples: `This Mac`, `home-raspi`, `gpu-4090-a`, `cluster-login`.

Machine card contents:

- display name
- online/offline/stale status
- OS/arch/hostname hint
- Swarmlab version
- reachable URLs: local, LAN, Tailscale, relay
- active sessions count
- active browser tasks count
- pending approvals count
- detected GPUs/cameras/providers/buildings
- ports discovered
- last heartbeat

Fleet and account views must default to redacted machine cards: counts, capability hints, status, and last-seen time. Port names, local app URLs, browser URLs, project paths, repo names, hostnames, and command text require an explicit scoped grant from the node. The local desktop can render richer cards after local node auth.

### Dashboard

A dashboard is a persisted spatial board scoped to one of:

- `fleet`: all machines in the Vibe account
- `machine:<machineId>`: one machine's live dashboard
- `project:<machineId>:<projectKey>`: one project on one machine
- `research:<projectName>`: one Library research project across machines
- `custom:<id>`: user-created board

### Card

Cards are typed work objects. The first version should support:

- `machine`: machine summary and enter button
- `agent`: terminal/coding-agent session
- `browser`: embedded browser-use session or browser card
- `app`: localhost/Tailscale/proxied local app
- `approval`: action item requiring human decision
- `artifact`: image, HTML, log, chart, paper, result doc, screenshot
- `repo`: repo/worktree/branch status
- `project`: workspace or Library project
- `building`: installed integration/building
- `note`: human note

Later:

- `gpu-job`: Modal/RunPod/local training job
- `camera`: VideoMemory camera/monitor card
- `wallet/order`: OttoAuth order card
- `automation`: scheduled job card
- `diff`: code diff card

### Edge

Edges are not decorative. They should encode provenance:

- agent produced artifact
- agent controls browser
- agent runs in worktree
- app belongs to session
- approval blocks session
- result doc cites commit/artifact
- machine hosts project

Edges can be hidden by default in dense views but should exist in the data model.

## Data Model

Use a new canvas namespace instead of extending Agent Town state forever.

```ts
type CanvasScope =
  | { kind: "fleet"; accountId: string }
  | { kind: "machine"; machineId: string }
  | { kind: "project"; machineId: string; projectKey: string }
  | { kind: "research"; projectName: string }
  | { kind: "custom"; id: string };

interface CanvasBoard {
  schemaVersion: 1;
  id: string;
  scope: CanvasScope;
  name: string;
  camera: { x: number; y: number; zoom: number };
  cards: Record<string, CanvasCard>;
  edges: Record<string, CanvasEdge>;
  createdAt: string;
  updatedAt: string;
}

interface CanvasCard {
  id: string;
  type:
    | "machine"
    | "agent"
    | "browser"
    | "app"
    | "approval"
    | "artifact"
    | "repo"
    | "project"
    | "building"
    | "note";
  ref: {
    machineId?: string;
    sessionId?: string;
    browserSessionId?: string;
    actionItemId?: string;
    port?: number;
    artifactPath?: string;
    projectPath?: string;
    buildingId?: string;
  };
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  collapsed?: boolean;
  pinned?: boolean;
  title?: string;
}

interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  kind: "hosts" | "runs-in" | "controls" | "produced" | "blocks" | "cites" | "belongs-to";
  label?: string;
}
```

The important line: card layout is user state; card backing data is live machine state. Do not duplicate transcripts, ports, or system metrics into the board document. Store only placement and references.

## Node Snapshot Contract

Every local Swarmlab daemon should expose a normalized node snapshot with two modes:

- `redacted`: safe for fleet/account/mobile summaries; counts and coarse capability hints only.
- `privileged`: local desktop/local web detail after node auth; includes local names, paths, URLs, and richer session/card detail.

The local UI can call the privileged mode directly after local node auth. The fleet dashboard starts with redacted mode through direct URL, Tailscale, or relay. Privileged mode must not be reachable through the account relay in v1.

```ts
interface SwarmlabNodeSnapshot {
  schemaVersion: 1;
  node: MachineNode;
  capabilities: MachineCapabilities;
  sessions: SessionSummary[];
  browserSessions: BrowserSessionSummary[];
  actionItems: ActionItemSummary[];
  canvases: ArtifactCanvasSummary[];
  ports: PortSummary[];
  projects: ProjectSummary[];
  system: SystemSummary;
  buildings: BuildingSummary[];
  generatedAt: string;
}
```

Proposed local endpoints and auth classification:

- `GET /api/node/manifest`: stable node id, install id, version, OS, public key, supported APIs. Redacted by default; hostname is a hint/hash unless locally authenticated.
- `GET /api/node/status`: cheap heartbeat status; no expensive port scan. Redacted; allowed for loopback local UI and `node.summary.read`.
- `GET /api/node/snapshot?mode=redacted`: fleet-safe canvas boot snapshot. No command text, paths, browser URLs, local app URLs, raw transcripts, secrets, or env.
- `GET /api/node/snapshot?mode=privileged`: full local canvas boot snapshot. Local node auth only; never exposed through account relay v1.
- `GET /api/node/events?since=<cursor>`: incremental events for polling clients. Redacted event channel for account grants; privileged event channel local only.
- `GET /api/canvas/boards`: list persisted boards visible on this node. Local node auth.
- `GET /api/canvas/boards/:boardId`: board layout. Local node auth; account access later only with a board-scoped read grant.
- `PUT /api/canvas/boards/:boardId`: save board layout. Local node auth only in v1.
- `POST /api/canvas/boards/:boardId/cards`: create note/manual card. Local node auth only in v1.
- `PATCH /api/canvas/cards/:cardId`: move/resize/collapse. Local node auth only in v1.
- `DELETE /api/canvas/cards/:cardId`: remove layout reference, not backing object. Local node auth only in v1.
- `WS /ws/node`: live approval, port-count, system, and canvas events. Terminal byte streams and browser/app proxying remain separate and are not relay v1 features.

All non-loopback write/control routes must reject unauthenticated requests before the account/fleet work begins. The current local daemon should be treated as localhost-era infrastructure until these route classifications are enforced.

Compatibility endpoint:

- Keep `/api/agent-town/*` during migration.
- Add `/api/canvas/*`.
- Mirror action items and canvases into the new namespace.
- Eventually rename CLI env from `VIBE_RESEARCH_AGENT_TOWN_API` to `SWARMLAB_ACTIONS_API` or `SWARMLAB_CANVAS_API`, while keeping aliases.

## Frontend Architecture

### Recommendation

Build a canvas island inside Swarmlab rather than importing OpenSwarm wholesale.

The current client is `src/client/main.js`, built by `scripts/build-client.mjs`. It is already too large. The canvas migration should not keep adding unrelated rendering code into that file. Extract new client modules under:

```text
src/client/canvas/
  canvas-model.js
  canvas-layout.js
  canvas-render.js
  canvas-events.js
  canvas-store.js
  machine-cards.js
  agent-cards.js
  browser-cards.js
  artifact-cards.js
  approval-cards.js
```

OpenSwarm's React components are a useful behavioral spec, not a drop-in dependency. Copy patterns, not architecture:

- `Dashboard.tsx` -> Swarmlab canvas controller
- `dashboardLayoutSlice.ts` -> Swarmlab canvas layout store
- `AgentCard.tsx` -> Swarmlab agent card
- `BrowserCard.tsx` -> Swarmlab browser card
- `DashboardViewCard.tsx` -> Swarmlab artifact/app card
- `WebSocketManager.ts` -> Swarmlab node event stream manager

### Rendering Strategy

Use DOM cards on a transformed canvas layer:

- pan/zoom by CSS transform on the card plane
- cards remain real DOM for accessible text, buttons, iframes, and terminal/browser embeds
- edges can be SVG overlay below cards
- minimap can be canvas/SVG
- virtualization is not required for v1 if card count is below a few hundred

Do not render the whole board as `<canvas>`; browser cards, iframes, terminals, approval buttons, and text selection need DOM.

### Card Interaction

Minimum v1 interactions:

- drag cards
- resize cards
- collapse/expand cards
- bring to front
- search/jump to card
- fit to active work
- keyboard shortcuts for machine switch, approve, deny, open focused agent
- save layout debounced
- reset/tidy layout
- board selector

Defer:

- group selection
- copy/paste cards
- collaborative cursors
- arbitrary edges editing
- fully custom dashboards

## Product Views

### Fleet Dashboard

First screen when signed into a Vibe account or when multiple local nodes are registered.

Cards:

- every machine
- global pending approvals
- active agents grouped by machine
- recently changed projects
- GPU/camera/building capabilities
- redacted port/app counts by default; names and URLs only after scoped grant

Primary actions:

- enter machine
- approve/deny a pending action
- open granted app/port
- start agent on selected machine
- pair new machine

### Machine Dashboard

The selected machine's live board.

Cards:

- active agents
- browser-use sessions
- ports/local apps
- system metrics
- installed buildings
- action items
- artifacts/canvases
- projects/workspaces

This is the natural replacement for Agent Town.

### Project Dashboard

The project-scoped board. This is where current `/api/projects/swarm` graph data belongs.

Cards:

- repo/worktree cards
- agent sessions in the project
- touched folder/file groups
- result docs/artifacts
- app previews
- approvals blocking project work

Edges matter more here because provenance is useful.

## Migration Plan

### Phase 0: Documentation And Naming

Deliverables:

- this design doc
- account/fleet design doc
- short update to `docs/visual-os-foundation.md` pointing at canvas as primary shell

No runtime behavior changes.

### Phase 1: Local Hardening And Node Snapshot API

Harden local route/auth/redaction behavior before making a node addressable from account web or another device. Then add local-only APIs:

- `GET /api/node/manifest`
- `GET /api/node/status`
- `GET /api/node/snapshot?mode=redacted`
- `GET /api/node/snapshot?mode=privileged`

Implementation should compose existing providers:

- sessions from `sessionManager.listSessions()`
- action items/canvases from `agentTownStore.getState()`
- ports from `listNamedPorts()`
- buildings from BuildingHub/catalog state
- system from cached system metrics
- browser sessions from `browserUseService.listSessions()`

Success criteria:

- non-loopback requests cannot mutate settings, proxy arbitrary ports, expose Tailscale Serve, send session input, or control sessions without node auth
- redacted snapshots exclude paths, command text, browser URLs, local app URLs, raw transcript text, secrets, and env
- snapshot returns in under 2 seconds even when port scan or BuildingHub refresh is slow
- redacted snapshot has enough data to render account/fleet cards without `/api/state`
- privileged snapshot has enough data to render local canvas cards without `/api/state`
- tests cover degraded dependencies

### Phase 2: Local Canvas Board

Create `/api/canvas/boards` storage in the state dir. Render a new `dashboard` or `canvas` view using only local node snapshot.

Success criteria:

- existing sessions appear as movable agent cards
- pending action items appear as approval cards
- ports appear as app cards
- agent canvases appear as artifact cards
- layout persists after reload
- Agent Town remains accessible but is no longer the default visual interface

### Phase 3: Browser And App Cards

Promote existing browser-use and port surfaces into cards.

Success criteria:

- browser-use session card opens the existing browser session detail
- local app card opens direct/LAN/Tailscale/proxy URL
- app cards show reachability and expose button where allowed
- card UI does not require the RPG town side panel

### Phase 4: Machine Registry In Desktop

Add a desktop-local machine registry before building cloud account sync.

Storage:

```text
~/Library/Application Support/Swarmlab/machines.json
```

or cross-platform Electron `app.getPath("userData")`.

Each entry:

```ts
interface RegisteredMachine {
  id: string;
  name: string;
  baseUrl: string;
  authTokenRef: string;
  connectionKind: "local" | "lan" | "tailscale" | "ssh-tunnel" | "relay";
  lastSeenAt?: string;
}
```

`authTokenRef` is a reference to macOS Keychain, Windows Credential Manager, libsecret, or another OS credential store. `machines.json` must not contain raw node tokens.

Success criteria:

- desktop app can switch between local machine and at least one manually added URL
- if a remote machine is unreachable, it shows stale status rather than blocking the app
- no cloud service required yet

### Phase 5: Vibe Account Node Registry

Use the account-backed fleet architecture in `docs/vibe-account-machine-dashboard.md`.

Success criteria:

- curl-installed machine can pair with a Vibe account
- desktop/web client can list paired machines
- a remote machine card shows live/stale status from heartbeats
- direct Tailscale/LAN access is preferred when reachable
- relay is optional and scoped

### Phase 6: Agent Town Demotion

After the canvas is stable:

- rename nav label from `Map` to `Canvas`
- make canvas the default visual view
- keep Agent Town under Appearance or Themes
- migrate Agent Town action/canvas APIs to neutral names while keeping aliases

## Implementation Notes

### State Storage

Store canvas boards under the existing state directory:

```text
<stateDir>/canvas/boards/<boardId>.json
```

Do not put layout into the Library by default. Layout is personal UI state. Exportable dashboards can later become scaffold recipes, but live board positions should not pollute research docs.

### Event Model

Use a unified event envelope:

```ts
interface NodeEvent {
  seq: number;
  type:
    | "session.created"
    | "session.updated"
    | "session.deleted"
    | "approval.created"
    | "approval.updated"
    | "artifact.created"
    | "port.updated"
    | "system.updated"
    | "canvas.updated";
  nodeId: string;
  payload: unknown;
  generatedAt: string;
}
```

Swarmlab already has session PTY streams; do not force all terminal bytes through this dashboard channel. The node channel should carry summaries and state changes. Per-session streams remain separate.

### Approvals

Approvals should become a top-level card type and global overlay. Current Agent Town action items already have most fields:

- title
- detail
- source session
- target
- recommendation
- consequence
- evidence
- choices

Rename the conceptual API:

- old: `Agent Town action item`
- new: `ActionItem` or `ApprovalCard`

Agents should not know whether the human sees a town, dashboard, desktop app, or mobile web page. They should create action items against a neutral API.

### Browser Cards

There are two browser concepts:

- Browser-use task state: a tool-driven browser automation record.
- Embedded browser card: a user-visible iframe/browser surface on the dashboard.

Do not conflate them. A browser-use task can own or spawn a browser card; a user can also create a browser card manually.

### Artifacts

Agent canvas artifacts should be cards. The old `vr-agent-canvas --image` CLI should keep working, but the target should be renamed:

- command can remain `vr-agent-canvas`
- storage can remain compatible
- UI should render it as an artifact card on the current board

Add later:

```sh
vr-agent-canvas --url http://127.0.0.1:6006 --title "TensorBoard"
vr-agent-canvas --file output/report.html --title "Run report"
vr-agent-canvas --log output/train.log --title "Training log"
```

## Security Principles

- A canvas is not an auth boundary. Every card action must still call a scoped server endpoint.
- Remote dashboards must not expose the raw local API token to the browser if a relay/proxy is used.
- Direct Tailscale/LAN access can use node-issued browser session tokens, but they must be revocable and short-lived.
- Approving a tool call from the web should produce an audit entry on the node.
- Secrets stay on the node unless the user explicitly syncs a credential to account storage.
- Browser cards must be sandboxed. Do not blindly iframe arbitrary local services through a cloud origin without considering cookies, localhost-only assumptions, and mixed-origin isolation.
- The current localhost-era API must be hardened before account/web clients can treat it as a remotely reachable node API.
- Tailscale reachability is only a transport fact. It is not authorization.
- Vibe Account grants must be signed, scoped, expiring, resource-bound, and verified by the node.

## Risks

### Security Surface Expansion

The current app is localhost-first. A web-accessible dashboard changes the threat model. This is the largest risk and the reason the migration must separate local canvas from account/fleet access.

Mitigation: harden the local node first, ship local canvas second, then add node pairing and remote access with explicit resource-bound auth scopes.

### Frontend Entropy

`src/client/main.js` is already too large. Adding a complex canvas directly into it will make future work worse.

Mitigation: create canvas modules immediately. The migration is a forcing function to modularize.

### Remote Browser Embeds

Embedding browser windows or local apps from another machine into a web account dashboard is hard. It crosses network, origin, auth, and latency boundaries.

Mitigation: v1 shows cards and opens remote dashboards/apps in their native node context. Full remote iframe embedding comes after node proxy/relay is mature.

### Metaphor Regression

If the canvas simply re-skins Agent Town objects, it will inherit the same conceptual weakness.

Mitigation: the canvas data model must be built around machine/session/artifact/action/app references, not buildings and sprites.

## Concrete Next Engineering Move

Implement local route hardening, node identity, `GET /api/node/snapshot?mode=redacted`, `GET /api/node/snapshot?mode=privileged`, and a static mock canvas view using the privileged snapshot.

This is the smallest step that proves the model without committing to cloud account, React, relay, or full UI migration.

Acceptance test:

1. Start Swarmlab locally.
2. Verify unauthenticated non-loopback write/control routes fail before they can mutate settings, proxy arbitrary ports, expose Tailscale Serve, send session input, or control sessions.
3. Call `GET /api/node/snapshot?mode=redacted` and confirm it contains counts/capability hints but no command text, paths, browser URLs, app URLs, raw transcripts, secrets, or env.
4. Open `/?view=canvas` locally.
5. See machine, sessions, pending action items, ports, and recent canvases as movable cards from the privileged local snapshot.
6. Refresh the browser and see card positions persist.
7. Existing Agent Town still opens.
