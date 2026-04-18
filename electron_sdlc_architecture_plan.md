# Electron SDLC Orchestrator Plan

## Purpose

This document defines the main user-facing deliverable, product surface, system architecture, and phase-wise implementation plan for the SDLC orchestrator.

The goal is to build a serious local-first product that helps a user turn rough project input into structured SDLC artifacts through gated phases with approval checkpoints.

## Main Deliverable

The main deliverable is not the agent chain itself.

The main deliverable is a user-facing project workspace that:

- accepts messy project input
- runs structured SDLC phases locally
- produces inspectable artifacts at each phase
- pauses for approval before moving forward
- ends with a delivery-ready handover package

In practical terms, the user should walk away with:

- a live project dashboard
- a structured artifact pack
- a clear approval and review flow
- a final handover package for engineering or clients

## Product Surface

The preferred surface for this MVP is a desktop application built with Electron and React.

This direction fits the product better than a web-only app because:

- `Coder`, `Testing`, and `DevOps` need real local filesystem and command access
- existing codebase workflows are more credible when execution stays local
- users do not need to upload private repositories to a remote service
- the product can feel like a serious working tool instead of a browser demo

## High-Level Product Model

The product should behave as:

- a desktop application for UI and orchestration
- a local execution environment for agents
- a structured artifact system for review and handoff

The clean product statement is:

> A local-first SDLC orchestration desktop app that turns rough software input into approved artifacts, implementation outputs, and handover documentation through gated AI-assisted phases.

## Core User Experience

The user journey should look like this:

1. Open the Electron app.
2. Create a new project or connect an existing codebase.
3. Paste a brief or upload source material.
4. Start the `Discovery` phase.
5. Review generated artifacts in the app.
6. Approve or request changes.
7. Continue phase by phase until handover is complete.

The user should always understand:

- what phase is active
- what was generated
- what risks or missing details exist
- what approval decision is required next

## System Architecture

The architecture should be split into the following layers:

### 1. Electron Shell

Responsibilities:

- desktop packaging
- native filesystem access
- process management
- secure IPC
- local workspace coordination

### 2. React Frontend

Responsibilities:

- project intake UI
- pipeline dashboard
- artifact viewer
- approval panel
- eval panel
- logs and execution visibility

### 3. Local Orchestration Layer

This is the product brain.

Responsibilities:

- project creation
- workflow state management
- phase transitions
- approval gates
- artifact registration
- event emission to UI
- run history

This should be owned by the app, not by Codex.

### 4. Codex App Server

This is the execution worker.

Responsibilities:

- run phase-specific agent tasks
- read and write local files
- inspect codebases
- generate structured phase outputs
- execute coding, testing, and devops actions

Codex should be the worker runtime, not the source of product state.

### 5. Local Workspace

This is the canonical output location.

Responsibilities:

- store artifact files
- store generated implementation files
- preserve project outputs on disk

### 6. Local Database

Prefer `SQLite` for MVP.

Responsibilities:

- projects
- workflow runs
- phase runs
- approvals
- artifact metadata
- eval results
- logs and event pointers

## Recommended Runtime Layout

The app can be modeled as:

- `Electron main process` for app lifecycle, orchestration services, and execution control
- `React renderer` for UI
- `IPC layer` for frontend-backend communication
- `Codex app server bridge` for phase execution
- `SQLite` for state
- filesystem workspace for artifacts

## Ownership Boundaries

### App-owned responsibilities

- project state
- phase lifecycle
- handoff contracts
- approval gating
- artifact registry
- logs and execution status
- local persistence

### Codex-owned responsibilities

- phase execution
- artifact generation
- file edits
- code generation
- test execution
- deployment guidance generation

## Phase State Model

Use explicit phase states:

- `not_started`
- `running`
- `review_ready`
- `approved`
- `changes_requested`
- `failed`

This is better than only `active` and `complete` because the UI and orchestration need more detail.

## Standard Handoff Contract

Each phase should emit a structured handoff object like this:

```json
{
  "phase": "architecture",
  "summary": "Technical direction selected",
  "artifacts": [
    { "type": "markdown", "path": "architecture/architecture.md" },
    { "type": "json", "path": "architecture/architecture.json" }
  ],
  "assumptions": [],
  "risks": [],
  "open_questions": [],
  "eval": {
    "warnings": [],
    "blockers": [],
    "confidence": 0.86
  },
  "next_input": {}
}
```

This contract should power both the next phase and the UI review surface.

## Suggested Local Workspace Structure

```text
.project-workflow/
  workflow-state.json
  discovery/
    requirements.md
    discovery-summary.json
  architecture/
    architecture.md
    architecture-diagram.md
    architecture.json
  journeys/
    user-journeys.md
    screens-list.md
    journeys.json
  wireframes/
    wireframes.md
    components.md
    wireframe-spec.json
  coder/
    implementation-summary.md
    code-map.json
  testing/
    test-plan.md
    test-results.md
    qa-summary.json
  devops/
    deployment-guide.md
    infrastructure.md
    devops-summary.json
  handover/
    client-handover.md
    developer-guide.md
    credentials-and-access.md
    future-roadmap.md
```

## Core UI Screens

### 1. Project Intake

Capabilities:

- paste brief
- upload PRD or notes
- choose `New Project` or `Existing Codebase`
- select local workspace path

### 2. Pipeline Dashboard

Capabilities:

- show all phases
- show active phase
- show phase status
- show warnings and blockers
- show approval history

### 3. Phase Detail View

Capabilities:

- phase summary
- artifact list
- assumptions
- risks
- open questions
- eval results
- start, retry, or review actions

### 4. Artifact Viewer

Capabilities:

- markdown viewer
- JSON viewer
- file path visibility
- quick compare across phases

### 5. Review and Approval Panel

Capabilities:

- approve phase
- request changes
- add review notes

### 6. Logs and Execution Panel

Capabilities:

- live execution logs
- command/task status
- failure visibility

## MVP Phase-Wise Build Plan

### Phase 1: Desktop Foundation

Goal:
Create a usable Electron shell with a React UI and local persistence base.

Build:

- Electron app shell
- React app inside Electron
- base layout with sidebar and main content panel
- project creation flow
- local workspace creation on disk
- SQLite integration
- basic artifact file viewer for `.md` and `.json`
- pipeline UI with placeholder phases

Output:

- user can create a project
- user can see the workflow shell
- user can browse artifacts in-app

### Phase 2: Workflow Orchestration

Goal:
Turn the static shell into a real gated workflow system.

Build:

- workflow state machine
- phase run model
- approval panel
- artifact registry
- run history
- review status handling
- event streaming to UI

Output:

- app can track phases properly
- app can hold a project in review state
- app can move forward only after explicit approval

### Phase 3: Codex Integration

Goal:
Integrate Codex app server as the execution engine.

Build:

- Electron-side bridge to Codex app server
- phase runner interface
- structured phase payload builder
- output parser
- log streaming to UI
- retry and cancel support

Output:

- a phase can be started from the UI
- the app can run local AI-assisted tasks
- results can return into the workflow state and viewer

### Phase 4: Discovery End-to-End

Goal:
Ship the first real value-producing phase.

Build:

- project intake form
- discovery payload generation
- discovery phase execution flow
- output creation:
  - `requirements.md`
  - `discovery-summary.json`
- review screen with:
  - summary
  - assumptions
  - risks
  - missing information
  - approval actions

Output:

- user can submit rough input
- app generates structured requirements
- user can approve or request changes

### Phase 5: Architecture End-to-End

Goal:
Prove the product is a multi-phase chain and not a single prompt.

Build:

- approved discovery handoff to architecture
- architecture phase execution
- output creation:
  - `architecture.md`
  - `architecture-diagram.md`
  - `architecture.json`
- review and approval flow for architecture

Output:

- user sees a real phase transition
- structured outputs from discovery feed architecture

### Phase 6: Journey and Wireframe

Goal:
Convert planning into product and UI structure.

Build:

- journey phase
- wireframe phase
- outputs:
  - `user-journeys.md`
  - `screens-list.md`
  - `journeys.json`
  - `wireframes.md`
  - `components.md`
  - `wireframe-spec.json`
- stronger artifact navigation in UI

Output:

- user sees flow definitions and screen planning generated from prior work

### Phase 7: Coder

Goal:
Move from planning into implementation.

Build:

- workspace repo linking
- implementation summary generation
- code map output
- starter code generation
- changed files panel
- safe write boundaries for generated code

Output:

- app can scaffold or update implementation locally

### Phase 8: Testing and DevOps

Goal:
Make the product delivery-oriented rather than planning-only.

Build:

- testing phase outputs:
  - `test-plan.md`
  - `test-results.md`
  - `qa-summary.json`
- devops phase outputs:
  - `deployment-guide.md`
  - `infrastructure.md`
  - `devops-summary.json`
- logs for command execution
- failure and warning surfacing

Output:

- app can validate quality and propose delivery setup

### Phase 9: Handover

Goal:
Complete the SDLC loop with a final package.

Build:

- handover phase outputs:
  - `client-handover.md`
  - `developer-guide.md`
  - `credentials-and-access.md`
  - `future-roadmap.md`
  - updated `README.md`
- final summary screen
- packaged export view

Output:

- user ends with a clear, delivery-ready project package

### Phase 10: Eval Layer and Polish

Goal:
Make the product more trustworthy and demo-ready.

Build:

- eval checks before approval
- blocker and warning badges
- confidence scoring
- revision timeline
- per-phase rerun
- UI polish and improved loading states

Output:

- app feels more serious, inspectable, and production-minded

## Recommended MVP Cut

For the first strong version, stop after:

- Phase 1
- Phase 2
- Phase 3
- Phase 4
- Phase 5

This gives a credible MVP with:

- Electron + React app
- local orchestration
- Codex-powered execution
- Discovery and Architecture working end to end
- approvals, artifacts, and structured handoffs

That is enough to demonstrate the core product clearly without overbuilding every later phase.

## Key Design Rules

- do not position the product as fake full autonomy
- do not skip approval gates
- do not let artifacts live only in chat or logs
- do not let Codex own project state
- do not make the UI secondary to execution
- do keep all outputs inspectable
- do preserve local ownership of files and artifacts

## Final Recommendation

Build the MVP as an Electron desktop app with a React frontend, a local orchestration layer owned by the app, and Codex app server used as the phase execution backend.

This gives the cleanest fit for:

- local code access
- gated SDLC workflows
- artifact generation
- review and approvals
- delivery-oriented execution
