# Swarmlab v2 CTO Migration Report

Date: 2026-05-12
Status: working plan
Decision: rebuild the architecture spine in parallel while preserving the local execution kernel.

## Executive Decision

Swarmlab should move to a v2 architecture built around four first-class layers:

1. **Vibe Account**: identity, machine registry, grants, presence, fleet dashboard, optional relay.
2. **Swarmlab Node**: one daemon per machine, owning terminals, sessions, browsers, files, ports, local apps, artifacts, credentials, and system capabilities.
3. **Canvas Shell**: desktop and web UI showing machines, agents, browsers, apps, approvals, artifacts, repos, projects, and jobs as real work objects.
4. **Transport Layer**: localhost, LAN, Tailscale, SSH tunnel, and Vibe relay behind one route-selection abstraction.

This is a fundamental rebuild of the product architecture. It is not a clean-room rewrite of every working runtime subsystem. The current app has too much valuable operational behavior to throw away first: installer, updater, PTY/tmux sessions, provider integrations, BrowserUse, local app ports, Tailscale Serve, BuildingHub, VideoMemory, OttoAuth, research Library, and desktop launcher.

The right move is a parallel v2 shell and protocol that gradually absorbs the current runtime. Build the new skeleton around stable contracts, then port existing organs behind those contracts.

After senior-engineer review, the phrasing should be sharper: this is a **strangler v2**, not a runtime fork. Rebuild the visual shell, account plane, node protocol, grants, and transport abstraction. Do not rebuild the local daemon first. The local daemon is the asset; the current remotely reachable API shape is the liability.

## The Hard Truth

Agent Town is the wrong default metaphor for the long-term product. It may remain as a skin, tutorial mode, or playful view, but the default UI should not be characters walking around a map. The product is a distributed control plane for agent work. The natural interface is a spatial canvas of work objects plus a fleet view of machines.

The current `src/client/main.js` is also an architectural liability. It has become the place where every product surface lands: Agent Town, sessions, ports, BuildingHub, BrowserUse, inbox, canvas artifacts, research dashboards, tutorials, and visual game state. Continuing to add v2 to that file will compound the problem.

So the plan is intentionally not "polish the existing UI." It is:

- keep the current runtime serving real users;
- define a new node protocol;
- build a new canvas client in a modular frontend;
- build Vibe Account for machine identity and access;
- bridge old runtime surfaces into the new protocol;
- demote or retire old UI surfaces once the new shell runs the real workflows.

## Senior SWE Debate Summary

### Platform / Runtime Position

**Argument:** Do not rewrite the local daemon first. The current daemon already knows how to start agents, keep terminals alive, persist sessions, expose ports, integrate Tailscale, and inject environment variables into provider processes. A runtime rewrite before a stable node contract would burn time recreating behavior that is already known to work.

**Counterargument:** The server has accreted too many responsibilities inside `src/create-app.js`. If v2 keeps calling ad hoc endpoints like `/api/state`, `/api/agent-town/*`, `/api/sessions/*`, and `/api/ports/*` directly, the new UI will inherit the old coupling.

**Resolution:** Build `Swarmlab Node API` as a facade first. Existing services stay behind the facade. New v2 code consumes only `/api/node/*`, `/api/canvas/*`, `/api/actions/*`, `/api/artifacts/*`, and typed session endpoints. The old endpoints remain for compatibility.

### Frontend / Product Position

**Argument:** The UI should be rebuilt. A serious canvas needs component state, isolated stores, virtualized card rendering, keyboard focus, drag/resize, iframe/browser/app cards, approval cards, artifact cards, minimap, and persistent layout. This does not belong in the current monolithic client.

**Counterargument:** A full frontend rewrite can easily become a beautiful static dashboard that cannot actually drive sessions, approvals, browsers, and local apps. OpenSwarm is a strong reference, but its stack and assumptions are not Swarmlab's product.

**Resolution:** Build a new canvas island as v2, not a full app rewrite on day one. It should use a serious component architecture and typed contracts. It can be served by the existing Node app while it matures. It must run real local sessions before it becomes default.

### Security / Networking Position

**Argument:** Vibe ID should not replace Tailscale. Vibe ID should own identity, machine registry, grants, and permissions. Tailscale should remain one preferred private transport. Rebuilding WireGuard/NAT traversal/relay is not the product.

**Counterargument:** Users should not have to think about Tailscale. The product should feel like "my Vibe machines," not "my tailnet plus local ports plus random URLs."

**Resolution:** Absorb Tailscale into the UX, not into the infrastructure. The route selector tries localhost, LAN, Tailscale, SSH tunnel, then Vibe relay. Vibe Account explains the result as direct, private, tunnel, or relay. It does not expose implementation plumbing unless the user opens diagnostics.

**Revision after debate:** Tailscale reachability is not authorization. Vibe login is not reachability. A relayed request is not trusted because it passed through the official account service. Every non-local action needs node-side verification of a signed, scoped, expiring grant.

### Delivery / Migration Position

**Argument:** If the goal is the right long-term architecture, do a parallel v2 rebuild. Continuing to refactor inside the current UI will trap the product in old metaphors and old state names.

**Counterargument:** Parallel v2 can split focus and leave two half-products.

**Resolution:** Ship v2 in thin vertical slices with explicit adoption gates. Each slice must replace one real workflow before moving on. The migration is complete only when v2 can start agents, inspect sessions, show browsers/apps/artifacts, approve actions, switch machines, and handle offline/stale nodes.

### Review Iteration Log

Round 1 produced the architecture above. Round 2 looked specifically for contradictions and unsafe shortcuts. The material corrections were incorporated:

- Treat the migration as a strangler v2, not a runtime fork.
- Put local security hardening before node account access.
- Split snapshots into redacted and privileged modes.
- Make grants resource-bound, replay-resistant, and verified node-side.
- Replace generic relay `method/path` forwarding with allowlisted operations.
- Store manual-machine tokens in the OS credential store, not `machines.json`.
- Keep terminal streams, app/browser proxying, settings mutation, process stop, file access, OAuth callbacks, and Tailscale Serve exposure out of relay v1.
- Make remote emergency stop a deferred process-control feature, not an initial machine-card button.

## Final Architecture

```text
Vibe Account
  user identity
  node registry
  machine names/groups
  signed grants
  presence summaries
  optional relay
  account fleet dashboard

Swarmlab Node
  local daemon
  PTY/tmux/session manager
  provider adapters
  BrowserUse
  ports/local apps
  system/GPU/camera state
  BuildingHub/buildings
  action items/approvals
  artifact registry
  local secrets

Canvas Shell
  fleet board
  machine board
  project board
  agent cards
  browser cards
  app cards
  approval cards
  artifact cards
  repo/worktree cards
  building cards

Transport Layer
  localhost
  LAN
  Tailscale
  SSH tunnel
  Vibe relay
```

## Non-Negotiable Invariants

- Local nodes own raw secrets, browser profiles, terminals, local files, and raw process control.
- Vibe Account never needs raw local API tokens in the browser.
- Tailscale is a transport option, not the product identity layer.
- Tailscale reachability never implies Vibe authorization.
- Vibe authorization never implies network reachability.
- Relay is scoped and optional. It starts with status, snapshots, approvals, and events, not arbitrary reverse proxying.
- The current localhost-era API is not remotely safe until node auth, redaction, grants, and route-level scope checks exist.
- v2 UI consumes typed node contracts, not arbitrary old endpoints.
- Old UI stays working until v2 handles the equivalent workflow.
- Agent Town APIs are aliased to neutral action/canvas APIs before Agent Town is demoted.
- Every remote action has a node-side audit entry.
- Every phase has a working vertical slice and testable acceptance gates.

## Product North Star

Open Vibe from desktop or web and see every machine running Swarmlab.

From that view, the user can:

- see which machines are online, stale, or offline;
- see active agents across machines;
- inspect browser sessions and local app previews;
- approve or deny blocked actions from any device;
- open a machine dashboard;
- start work on the right machine;
- see artifacts, logs, result docs, screenshots, charts, and live monitors;
- understand which transport is being used without configuring it manually.

The mental model is:

```text
I have a Vibe account.
My machines are attached to it.
Each machine has agents and apps.
The canvas shows live work.
Approvals follow me.
Artifacts are inspectable.
The system picks the best private route.
```

## What We Keep

These systems are retained and wrapped:

- `start.sh`, `bin/vibe-research`, `bin/swarmlab`, release/update flow
- `desktop/src/main.cjs` launcher and update shell
- `src/session-manager.js` for current PTY/provider session handling
- `src/session-store.js` persisted session snapshots
- `src/create-app.js` as the initial host for v2 APIs
- provider registry and adapters
- BrowserUse service and CLI
- ports/Tailscale Serve detection
- system metrics and GPU restrictions
- BuildingHub catalog and install runners
- VideoMemory/OttoAuth/Telegram/Twilio integrations
- research Library, runner, judge, doctor, admit, paper tooling

## What We Rebuild

These become v2 foundations:

- primary UI shell
- canvas state and layout model
- node identity store
- node snapshot and event APIs
- neutral action/approval API
- artifact registry
- machine registry in desktop
- Vibe Account node registry
- grant and relay protocols
- route selection abstraction
- frontend module architecture
- Agent Town compatibility layer

## Workstreams

### Workstream 0: Local Security Hardening

Owner: security/platform.

Deliverables:

- explicit local/LAN bind policy
- node-local auth for non-loopback requests
- route scope matrix for all write/control endpoints
- CSRF/origin protections for browser-initiated writes
- `/proxy/:port` local-auth gate and allowlist
- redacted vs privileged snapshot modes
- audit log for remote decisions and control actions

Acceptance gates:

- default install is not accidentally a broad LAN control plane
- no account grant can call `PATCH /api/settings`, `/proxy/:port`, file write, session input, process stop, or port exposure unless that exact route and resource scope is implemented
- route tests prove dangerous endpoints fail closed from untrusted origins and non-loopback requests
- redacted snapshot contains no raw transcripts, env vars, secret settings, file contents, browser cookies, or arbitrary file paths

### Workstream A: Node Protocol

Owner: platform/runtime.

Deliverables:

- node identity store
- `GET /api/node/manifest`
- `GET /api/node/status`
- `GET /api/node/snapshot?mode=redacted`
- `GET /api/node/snapshot?mode=privileged`
- `GET /api/node/events`
- `WS /ws/node`
- typed serializers for sessions, ports, actions, artifacts, browser tasks, buildings, projects, system

Acceptance gates:

- both snapshot modes return under 2 seconds with degraded dependencies
- redacted snapshot contains counts/capability hints but no command text, paths, browser URLs, local app URLs, raw transcripts, secrets, or env
- privileged snapshot requires local node auth
- manifest has stable node id and public key
- node status is cheap and does not trigger port scan
- tests cover missing Tailscale, slow port scan, missing BuildingHub, and no sessions

### Workstream B: Canvas v2

Owner: frontend/product.

Deliverables:

- new client module or app for canvas
- board store and layout persistence
- machine, agent, browser, app, approval, artifact, repo, project, building, note cards
- pan, zoom, drag, resize, z-order, fit, search
- keyboard shortcuts
- local-only machine board
- project board seeded by current swarm graph

Acceptance gates:

- user can move cards and refresh without losing layout
- user can open a real session from an agent card
- user can approve a real action item from an approval card
- user can open a real port/app card
- user can inspect a real artifact/canvas image
- canvas view does not require Agent Town state names in its public contracts

### Workstream C: Vibe Account

Owner: backend/account.

Deliverables:

- account auth
- node registry
- pairing codes
- signed grants
- node heartbeat ingest
- machine list API
- presence/status API
- remote approval queue
- disconnect/revoke

Acceptance gates:

- headless node can pair by code
- desktop node can pair by browser login
- node appears in account dashboard within one heartbeat
- disconnect revokes future grants
- account never stores local secrets

### Workstream D: Transport

Owner: networking/security.

Deliverables:

- route selector
- connection hints from node heartbeat
- direct local/LAN/Tailscale probing
- SSH tunnel descriptor for desktop
- relay client on node
- relay server in account service
- grant verification on node

Acceptance gates:

- route selector prefers direct private paths
- Tailscale is hidden as "direct private" in normal UI
- relay can carry node status and approvals
- relay cannot proxy arbitrary local ports in v1
- expired grants fail closed

### Workstream E: Compatibility And Migration

Owner: staff/platform.

Deliverables:

- `/api/actions/*` aliases for `/api/agent-town/action-items`
- `/api/artifacts/*` aliases for `/api/agent-town/canvases`
- `SWARMLAB_ACTIONS_API` and `SWARMLAB_CANVAS_API` env vars with old aliases retained
- old UI route compatibility
- migration docs and deprecation warnings

Acceptance gates:

- existing `vr-agent-ask` and `vr-agent-canvas` still work
- Agent Town can still open
- new canvas sees old action items and canvases
- no existing integration loses its callback URL or env var

## Detailed Migration Plan

### Phase -1: Local Security Hardening

Duration: 1-2 weeks.

Goal: make the local daemon safe enough to grow into a node API.

Build:

- audit all current routes into classes: local-read, local-write, remote-summary, remote-approval, remote-control, never-remote
- make the bind policy explicit: loopback by default; LAN/Tailscale exposure requires user intent
- add node-local auth middleware for non-loopback requests
- add CSRF/origin protection for browser-initiated writes
- make `/proxy/:port` require local auth and an allowlist before any remote story
- define redacted snapshot rules
- define node audit entry shape

Exit criteria:

- current local app still works
- non-loopback requests cannot mutate settings or control sessions without auth
- redaction tests pass
- route scope matrix exists and is reviewed

### Phase 0: Contract Lock

Duration: 1 week.

Goal: stop debating the shape and lock the v2 seams.

Build:

- finalize `SwarmlabNodeSnapshot`
- finalize `CanvasBoard`
- finalize `ActionItem`
- finalize `Artifact`
- finalize `NodeGrant`
- write OpenAPI or JSON schema files under `schemas/`
- create fixtures for a Mac, Pi, GPU box, and offline node

Exit criteria:

- schemas reviewed
- fixtures renderable by a static mock canvas
- no field contains obvious secret leakage
- old docs point at v2 architecture

### Phase 1: Node Identity And Snapshot

Duration: 1-2 weeks.

Goal: create the execution-kernel facade after local route hardening.

Build:

- `src/node-identity-store.js`
- `src/node-snapshot-service.js`
- `src/node-event-store.js`
- `GET /api/node/manifest`
- `GET /api/node/status`
- `GET /api/node/snapshot?mode=redacted`
- `GET /api/node/snapshot?mode=privileged`
- `GET /api/node/events`

Implementation notes:

- generate stable `nodeId`
- generate signing keypair
- hash hostname in account-bound payloads
- reuse existing `/api/state` sources internally
- bound expensive calls with timeouts
- include redaction tests

Exit criteria:

- local snapshot supports first canvas board
- snapshot works on clean machine, dirty repo, missing Tailscale, and no active sessions
- tests pass

### Phase 2: Local Canvas v2

Duration: 2-4 weeks.

Goal: make the new shell real locally before cloud/account work.

Build:

- `/canvas` or `?view=canvas`
- `src/client/canvas/*` modular implementation or a new bundled app under `src/canvas-app/`
- canvas board persistence in `<stateDir>/canvas/boards/*.json`
- card rendering from node snapshot
- card move/resize/collapse/z-order
- agent card opens existing session
- approval card resolves existing action item
- app card opens existing port URL
- artifact card opens existing canvas image

Exit criteria:

- local daily use can happen from canvas
- Agent Town no longer needed for the main supervision loop
- old UI still works

### Phase 3: Desktop Machine Registry

Duration: 1-2 weeks.

Goal: prove multi-machine UX without building cloud first.

Build:

- desktop-local machine registry
- manual add machine by URL/token
- direct status probing
- machine switcher
- stale/offline handling
- connection diagnostics

Exit criteria:

- desktop can switch between this Mac and one manually configured remote node
- unreachable remote does not hang app
- no Vibe Account required

### Phase 4: Vibe Account Skeleton

Duration: 3-6 weeks. Starts only after Phase -1 and Phase 1 gates pass.

Goal: create account identity and machine pairing.

Build:

- account auth
- node pairing by browser login and headless code
- account node registry
- heartbeat ingestion
- node disconnect/revoke
- account machine list

Exit criteria:

- curl-installed Pi or GPU box pairs to account
- web account shows online/stale/offline machines
- no remote control yet beyond status

### Phase 5: Remote Approvals

Duration: 2-4 weeks.

Goal: ship the highest-value cross-device workflow before remote desktops.

Build:

- account approval queue
- node publishes redacted pending approvals
- signed one-use decision grants bound to `approvalId`
- node-side decision verification
- audit log
- mobile-friendly approval page

Exit criteria:

- user can approve/deny a real blocked local agent from web
- expired/replayed decision fails
- node audit records actor/action/time/result

### Phase 6: Direct Remote Machine Canvas

Duration: 3-5 weeks.

Goal: access machine dashboards from desktop/web via direct private routes.

Build:

- route selector
- connection hints in heartbeats
- direct Tailscale/LAN/local probing
- browser-safe short-lived node grants
- remote snapshot and event subscription
- machine canvas over direct URL

Exit criteria:

- desktop opens paired machine over Tailscale without manual URL management
- web tries direct private URL when browser can reach it
- route failures degrade to stale snapshot with clear diagnostics

### Phase 7: Scoped Relay

Duration: 4-8 weeks.

Goal: make web dashboard useful when direct routes fail.

Build:

- node outbound relay WebSocket
- account relay broker
- scoped request forwarding
- snapshot/events over relay
- approval decisions over relay
- artifact thumbnail reads over relay

Do not build first:

- arbitrary local port reverse proxy
- full terminal streaming
- file write relay
- browser profile relay
- settings mutation
- OAuth callback completion through relay
- Tailscale Serve exposure from account web

Exit criteria:

- web can show live node status and approvals over relay
- relay cannot access unscoped endpoints
- load/rate limits enforced
- audit exists on both node and account

### Phase 8: Full Workflow Parity

Duration: 6-12 weeks.

Goal: v2 becomes default.

Build:

- start agent from canvas
- send message to agent
- inspect full transcript
- open browser task
- open local app
- inspect diff/artifact
- research project dashboard
- BuildingHub/building cards
- VideoMemory/OttoAuth cards
- old route migration

Exit criteria:

- one full day of real work can be done from v2 without old UI
- Agent Town is optional
- old `visual-interface` route redirects to canvas by default

## Rebuild Strategy

This should be a parallel v2 rebuild, not a branch that blocks all current work.

Recommended structure:

```text
src/node/
  identity-store.js
  snapshot-service.js
  event-service.js
  grant-verifier.js

src/canvas/
  board-store.js
  board-schema.js

src/client/canvas/
  index.js
  store.js
  render.js
  cards/
  interactions/

src/account/
  account-token-store.js
  pairing-client.js
  heartbeat-client.js
  relay-client.js

schemas/
  node-manifest.schema.json
  node-snapshot.schema.json
  canvas-board.schema.json
  action-item.schema.json
  node-grant.schema.json
```

The current `src/create-app.js` can host the first endpoints, but new modules should own the logic. Do not put node snapshot serialization directly into `create-app.js`.

## Build Vs Borrow From OpenSwarm

Borrow:

- spatial dashboard mental model
- agent/view/browser/note card taxonomy
- persisted card layout
- dashboard-level websocket
- approval unification
- keyboard-first supervision
- worktree/diff visibility

Do not borrow:

- Python/FastAPI backend
- single-machine product assumption
- full dependency stack as a hard requirement
- local-only account story

OpenSwarm is a reference implementation for the canvas UX. Swarmlab's differentiator is fleet, local execution, Vibe Account, research workflow, buildings, remote machines, and real installed services.

## Technical Contracts To Lock

### Node Manifest

```ts
interface NodeManifest {
  schemaVersion: 1;
  nodeId: string;
  displayName: string;
  swarmlabVersion: string;
  os: string;
  arch: string;
  publicKey: string;
  api: {
    snapshot: 1;
    events: 1;
    canvas: 1;
    actions: 1;
  };
}
```

### Node Status

```ts
interface NodeStatus {
  nodeId: string;
  status: "online" | "busy" | "idle";
  generatedAt: string;
  counts: {
    sessions: number;
    runningSessions: number;
    approvals: number;
    ports?: number;
  };
  version: string;
}
```

### Action Item

```ts
interface ActionItem {
  id: string;
  kind: "action" | "approval" | "review" | "setup";
  priority: "low" | "normal" | "high" | "urgent";
  title: string;
  detail: string;
  sourceSessionId?: string;
  target?: {
    type: string;
    id: string;
    label?: string;
  };
  capabilityIds: string[];
  evidence: Array<{
    label: string;
    kind: "file" | "url" | "artifact" | "log" | "image";
    path?: string;
    url?: string;
  }>;
  choices: Array<{
    id: string;
    label: string;
    status: "resolved" | "dismissed" | "blocked";
  }>;
  createdAt: string;
  updatedAt: string;
}
```

### Node Grant

```ts
interface NodeGrant {
  id: string;
  iss: "vibe-account";
  sub: string;
  aud: string;
  accountId: string;
  actorId: string;
  nodeId: string;
  scopes: string[];
  resources: Record<string, string[]>;
  methods?: string[];
  paths?: string[];
  iat: number;
  jti: string;
  payloadHash?: string;
  requireUserGesture?: boolean;
  exp: number;
  createdAt: string;
}
```

Implementation rule: `jti`, `iat`, `aud`, `nodeId`, `scopes`, `resources`, and expiry are mandatory. `methods`, `paths`, and `payloadHash` are mandatory for relay-forwarded requests. A grant without resource binding is invalid except global redacted summaries such as `node.summary.read`. The account service issues grants, but the node verifies them against a shared schema before doing anything.

### Resource-Bound Grant Scopes

Do not ship generic `admin`, `owner`, `session:write`, `file:write`, or `port:expose` scopes. Grants should bind action and resource.

Initial allowed scopes:

- `node.summary.read`
- `node.snapshot.read.redacted`
- `approval.list`
- `approval.decide:{approvalId}`
- `artifact.thumbnail.read:{artifactId}`
- `artifact.read:{artifactId}`
- `session.summary.read:{sessionId}`

Deferred scopes requiring separate review:

- `session.transcript.read:{sessionId}`
- `session.input.write:{sessionId}`
- `process.stop:{sessionId}`
- `port.list`
- `port.open:{port}`
- `port.expose.tailscale:{port}`
- `file.read:{pathPrefix}`
- `file.write:{pathPrefix}`
- `settings.write:{settingKey}`

Default TTLs:

- summary and redacted snapshot: 1-5 minutes
- approval decision: under 2 minutes, one use
- session input, process stop, file, port exposure: under 60 seconds, one use, later phase only
- relay bootstrap: short-lived, then node-bound relay session with explicit allowed methods

## Security Gates

Nothing account/web-facing ships until these are true:

- node grants are signed and verified node-side
- grants are scoped and expire
- one-use grants reject replay through node-side `jti` tracking
- account relay cannot call arbitrary local endpoints
- remote approval decisions are audited
- snapshots redact secrets and high-risk paths by default
- CORS and private network access behavior are explicitly tested
- disconnect revokes account refresh token and relay channel
- relay has rate limits and payload size limits
- current `/proxy/:port`, `PATCH /api/settings`, session input, file read/write, OAuth callbacks, and Tailscale Serve exposure are classified as local-only until they have resource-bound grant support

## Kill Criteria

Kill or redesign a phase if:

- v2 canvas cannot run a real local agent workflow by Phase 2;
- node snapshot leaks secrets or file contents by default;
- relay becomes necessary for basic local/direct remote use;
- account service starts storing raw transcripts by default;
- route selection requires the user to understand Tailscale internals;
- v2 frontend becomes another monolithic file;
- old runtime behavior breaks before v2 reaches parity.

## Staffing Model

Minimum serious team:

- 1 platform/runtime lead
- 1 frontend/canvas lead
- 1 security/networking lead
- 1 account/backend lead
- 1 product/design engineer
- 1 QA/release owner

Solo execution is possible but slower. If solo, strict phase gates matter more than speed.

## 30 / 60 / 90 Day Plan

### First 30 Days

- harden local bind/auth/redaction route policy
- lock schemas
- implement node identity
- implement redacted and privileged local node snapshots
- build static canvas from privileged snapshot
- persist local board layout
- show sessions, ports, approvals, artifacts as cards

Success: local v2 canvas can supervise current-machine work.

### First 60 Days

- machine registry in desktop
- manual remote node add
- direct Tailscale/LAN route probing
- local account pairing prototype
- neutral action/artifact APIs
- remote stale/offline UI

Success: desktop can switch between at least two machines without cloud relay.

### First 90 Days

- Vibe Account node registry
- headless pairing
- heartbeats
- account fleet dashboard
- remote approval queue
- signed grants
- relay for status/approvals/snapshots

Success: user can approve a blocked agent from the web and open machine dashboards through direct routes or scoped relay.

## Revised Recommendation After Debate

The first design docs were directionally right but too polite about the rebuild. The better CTO-level framing is:

- Yes, Swarmlab needs a fundamental v2 architecture.
- No, the local execution kernel should not be rewritten first.
- The v2 center is account + node protocol + canvas + transport abstraction.
- Agent Town should not be allowed to define v2 state names.
- Tailscale should be hidden under Vibe Network, not replaced.
- Relay must be scoped, late, and boring.
- Local security hardening must precede any account-controlled node access.
- Grants must be resource-bound and verified by the node, not trusted because the request came from the account service.
- The first code milestone is local hardening plus node snapshot, not React, not relay, not account.

## Immediate Next PR

Title: `Add local node hardening and Swarmlab node snapshot API`

Scope:

- route classification for loopback-only, local-auth, grant-auth, and never-remote endpoints
- `src/node-identity-store.js`
- `src/node-snapshot-service.js`
- route registration in `src/create-app.js`
- tests for manifest/status/snapshot redaction
- docs update with the concrete endpoint contract

Out of scope:

- canvas UI
- account pairing
- relay
- Agent Town removal
- frontend rewrite

Acceptance:

- `GET /api/node/manifest` returns stable identity and version
- `GET /api/node/status` returns cheap counts
- `GET /api/node/snapshot?mode=redacted` returns fleet-safe local state
- `GET /api/node/snapshot?mode=privileged` is local-node-auth only
- no secret settings included
- unauthenticated non-loopback write/control requests fail before settings, proxy, Tailscale Serve, session input, or process-control behavior can run
- degraded dependencies do not hang response
