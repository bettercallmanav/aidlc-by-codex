# SDLC Chain

The SDLC chain is an 8-phase, gated workflow that runs in a single conversation session and advances by synthetic handoffs between specialized agents.

## Chain

`discovery -> architect -> journey -> wireframe -> coder -> testing -> devops -> handover`

There is also an entry tool, `sdlc_start`, and a final return to `build` after `handover`.

## How The Chain Starts

The chain begins with [`sdlc-start.ts`](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/tool/sdlc-start.ts:1>).

What it does:

- Asks whether the work is a `New Project` or `Existing Codebase`.
- Creates the folder structure under `.opencode/`:
- `.opencode/discovery/`
- `.opencode/architecture/`
- `.opencode/journeys/`
- `.opencode/wireframes/`
- `.opencode/coder/` is not created here
- `.opencode/testing/`
- `.opencode/devops/`
- `.opencode/handover/`
- Creates `.opencode/sdlc-status.json` and marks:
- `discovery = active`
- every later phase = `not-started`
- Injects a synthetic user message targeting the `discovery` agent.
- Adds a synthetic text instruction telling discovery how to start based on project type.

This is important: the workflow does not fork into child sessions here. It stays in the same session and changes the active agent by writing a new user message with a different `agent` field.

## How Each Handoff Works

Every phase transition uses the same pattern:

1. The current phase agent completes its work.
2. It calls its phase-specific `*_exit` tool.
3. That tool asks the user for approval to move on.
4. If approved, it updates `.opencode/sdlc-status.json`.
5. It creates a new user message in the same session with `agent = nextPhase`.
6. It appends a synthetic text prompt telling the next phase what to do.
7. The main loop sees that user message and loads the next phase’s system reminder.

This means the handoff is implemented as a message-level agent switch, not as a separate worker or subagent delegation.

## Phase-By-Phase Detail

### 1. `discovery`

- Prompt source: [discovery.txt](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt/discovery.txt:1>)
- Exit tool: [discovery-exit.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/tool/discovery-exit.ts:1>)
- Allowed output area: `.opencode/discovery/`
- Main job:
- determine whether this is greenfield or existing code,
- gather requirements,
- research competitors/market/feasibility,
- manage scope,
- confirm understanding.
- Required deliverable:
- `.opencode/discovery/requirements.md`
- Handoff:
- asks whether to move to `architect`,
- marks `discovery = complete`, `architecture = active`,
- injects a user message for `architect` saying requirements are approved and architecture should begin.

### 2. `architect`

- Prompt source: [architect.txt](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt/architect.txt:1>)
- Exit tool: [architect-exit.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/tool/architect-exit.ts:1>)
- Allowed output area: `.opencode/architecture/`
- Main job:
- read discovery requirements,
- choose stack and architecture,
- define data models and APIs,
- document security and deployment,
- explain tradeoffs.
- Required deliverables:
- `.opencode/architecture/architecture.md`
- `.opencode/architecture/architecture-diagram.md`
- Handoff:
- asks whether to move to `journey`,
- marks `architecture = complete`, `journeys = active`,
- injects a user message for `journey`.

### 3. `journey`

- Prompt source: [journey.txt](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt/journey.txt:1>)
- Exit tool: [journey-exit.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/tool/journey-exit.ts:1>)
- Allowed output area: `.opencode/journeys/`
- Main job:
- read requirements and architecture,
- map user flows,
- identify screens,
- capture edge cases and navigation structure.
- Required deliverables:
- `.opencode/journeys/user-journeys.md`
- `.opencode/journeys/screens-list.md`
- Handoff:
- asks whether to move to `wireframe`,
- marks `journeys = complete`, `wireframes = active`,
- injects a user message for `wireframe`.

### 4. `wireframe`

- Prompt source: [wireframe.txt](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt/wireframe.txt:1>)
- Exit tool: [wireframe-exit.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/tool/wireframe-exit.ts:1>)
- Allowed output area: `.opencode/wireframes/`
- Main job:
- read discovery, architecture, and screen list,
- design layouts and components,
- iterate with the user,
- define component inventory and basic design system rules.
- Required deliverables:
- `.opencode/wireframes/wireframes.md`
- `.opencode/wireframes/components.md`
- Special behavior:
- the prompt injector checks whether Paper MCP is connected and appends a status note before execution. That happens in [prompt.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt.ts:1383>).
- Handoff:
- asks whether to move to `coder`,
- marks `wireframes = complete`, `coder = active`,
- injects a user message for `coder`.

### 5. `coder`

- Prompt source: [coder.txt](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt/coder.txt:1>)
- Exit tool: [coder-exit.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/tool/coder-exit.ts:1>)
- File access:
- full project filesystem access.
- Main job:
- read all prior documentation,
- scaffold and implement,
- build components/screens/features,
- follow project patterns,
- work incrementally.
- No fixed documentation file is required here by the prompt; this is the implementation phase.
- Handoff:
- asks whether to move to `testing`,
- marks `coder = complete`, `testing = active`,
- injects a user message for `testing`.

### 6. `testing`

- Prompt source: [testing.txt](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt/testing.txt:1>)
- Exit tool: [testing-exit.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/tool/testing-exit.ts:1>)
- Allowed output areas:
- `.opencode/testing/`
- test files in the codebase.
- Main job:
- review implementation,
- create test strategy,
- write unit/integration/component/e2e tests,
- run tests and document results.
- Required deliverables:
- `.opencode/testing/test-plan.md`
- `.opencode/testing/test-results.md`
- Handoff:
- asks whether to move to `devops`,
- marks `testing = complete`, `devops = active`,
- injects a user message for `devops`.

### 7. `devops`

- Prompt source: [devops.txt](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt/devops.txt:1>)
- Exit tool: [devops-exit.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/tool/devops-exit.ts:1>)
- Allowed output areas:
- `.opencode/devops/`
- deployment-related project files.
- Main job:
- review architecture,
- define deployment model,
- add containers,
- set up CI/CD,
- document hosting, env vars, monitoring, scaling.
- Required deliverables:
- `.opencode/devops/deployment-guide.md`
- `.opencode/devops/infrastructure.md`
- Expected project files:
- `Dockerfile`
- `docker-compose.yml`
- `.github/workflows/`
- env templates
- Handoff:
- asks whether to move to `handover`,
- marks `devops = complete`, `handover = active`,
- injects a user message for `handover`.

### 8. `handover`

- Prompt source: [handover.txt](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt/handover.txt:1>)
- Exit tool: [handover-exit.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/tool/handover-exit.ts:1>)
- Allowed output areas:
- `.opencode/handover/`
- root `README.md`
- Main job:
- review all prior phase docs,
- create client-facing and developer-facing documentation,
- document credentials/access placeholders,
- document future roadmap and debt.
- Required deliverables:
- `.opencode/handover/client-handover.md`
- `.opencode/handover/developer-guide.md`
- `.opencode/handover/credentials-and-access.md`
- `.opencode/handover/future-roadmap.md`
- update `README.md`
- Final handoff:
- asks whether to return to `build`,
- marks `handover = complete`,
- injects a synthetic user message with `agent = build`,
- adds a summary text stating the SDLC workflow is complete.

## Where The Active Phase Is Tracked

The workflow state is stored in `.opencode/sdlc-status.json`.

The structure is a map of phase name to:

- `status`
- `updatedAt`

Statuses used by the chain:

- `not-started`
- `active`
- `complete`

Every exit tool updates only the current and next phase, except the final handover exit which only marks `handover` complete.

## How The System Knows Which Phase Rules To Apply

The message-processing loop checks the current user message’s `agent` field and injects the matching synthetic system reminder before calling the model. That switch logic is in [prompt.ts](</Users/manav/Documents/Projects/tauri embos/opencode/packages/opencode/src/session/prompt.ts:1328>).

So the actual phase behavior comes from two pieces working together:

- the `*_exit` tool changes the current agent by writing a synthetic user message,
- the prompt layer sees that agent and inserts the right phase instructions.

## What Is Not Happening In This Chain

- It does not use child sessions for phase-to-phase transitions.
- It does not use the subagent `task` handoff model for the SDLC phases.
- It does not automatically skip phases.
- It does not auto-advance without explicit user approval at each exit tool.
