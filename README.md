# Codex Buildathon

Codex Buildathon is a local-first Electron app for running an AI-assisted SDLC workflow against a real project folder.

It is built around one idea:

Take a rough software brief or an existing codebase, run it through structured phases, keep all artifacts on disk, and let the user supervise the workflow from one desktop workspace.

## What This App Does

The app gives you:

- a desktop workspace with chat on the left, active work in the middle, and review/files/SDLC state on the right
- real project folders on disk, not in-memory demo state
- multiple chat sessions inside one project
- SDLC phase agents that work against local files
- local artifact generation under `.project-workflow/`
- Codex-backed chat with file edits, command execution, and agent handoff support
- wireframe image generation for the `Wireframe` phase

## Core Concepts

### Project

A project is the long-lived container.

It owns:

- the workspace root on disk
- the `.project-workflow/` folder
- the SDLC state
- all artifacts
- all chat sessions

### Session

A session is one conversation thread inside a project.

Use separate sessions for different tasks such as:

- Discovery clarification
- Architecture rework
- Frontend build
- Testing follow-up

Sessions share the same project state, artifacts, and workflow.

### Workflow

The workflow belongs to the project, not to a single session.

Current phases:

1. Discovery
2. Architecture
3. Journey
4. Wireframe
5. Coder
6. Testing
7. DevOps
8. Handover

### Artifacts

Artifacts are the source of truth.

Examples:

- `requirements.md`
- `architecture.md`
- `user-journeys.md`
- `wireframes.md`
- `implementation-summary.md`
- `test-plan.md`
- `deployment-guide.md`
- `client-handover.md`

These are stored in the project workspace under `.project-workflow/`.

## Folder Structure

When you create a new project or import an existing folder, the app creates:

```text
.project-workflow/
  project-context.json
  workflow-state.json
  discovery/
  architecture/
  journeys/
  wireframes/
  coder/
  testing/
  devops/
  handover/
```

Each phase writes its own artifacts into its own folder.

## How The Workflow Behaves

This app is not a generic chatbot.

The active agent is phase-aware and artifact-aware:

- Discovery asks scoped questions and writes requirements
- Architecture writes the technical design
- Journey maps flows and screens
- Wireframe writes screen/component planning and can generate wireframe images
- Coder edits the real workspace
- Testing writes and runs tests where possible
- DevOps prepares deployment and infra artifacts
- Handover packages final delivery documentation

Agents can suggest handoff to the next phase in chat.
The user confirms in chat, and the app moves the workflow forward.

## Current UI Model

### Left rail

- home
- project shortcuts
- session creation for the active project

### Left workspace column

- active chat session
- model selector
- agent selector
- ChatGPT-style composer with send/stop behavior

### Right inspector

- `Review`
- `Files`
- `SDLC`

The file viewer can render:

- markdown
- JSON
- code/text files
- images
- Mermaid diagrams inside markdown

## Running The App

### Requirements

- Node.js
- npm
- Electron-compatible desktop environment
- `codex` installed and available in `PATH` if you want live Codex App Server integration

### Install

```bash
npm install
```

### Start in development

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Codex Integration

The chat UI is backed by Codex App Server through the Electron main process.

That means the app can:

- read files
- write files
- run workspace-scoped commands
- stream responses live
- interrupt active turns
- keep one Codex conversation per session

## Image Generation

Wireframe image generation requires an API key in a local env file.

Create:

```text
.env.local
```

Add one of:

```bash
OPENAI_API_KEY=...
```

or

```bash
CODEX_API_KEY=...
```

The env file is ignored by Git.

## Helpful Scripts

### App

- `npm run dev`
- `npm run build`

### Codex helpers

- `npm run codex`
- `npm run codex:full`
- `npm run codex:review`
- `npm run codex:search`
- `npm run codex:setup`

### SDLC CLI helpers

- `npm run sdlc:init`
- `npm run sdlc:status`
- `npm run sdlc:run`
- `npm run sdlc:approve`
- `npm run sdlc:changes`

## What Is Implemented Today

- Electron + React desktop shell
- Finder-backed project creation/import
- multiple sessions per project
- local project/workflow persistence
- Codex-backed chat
- model and agent switching from the composer
- automatic phase handoff suggestions in chat
- right-side review/files/SDLC inspector
- markdown and Mermaid rendering in the file viewer
- wireframe image generation

## Current Gaps

This is still an active build.

Important gaps:

- phase exit is app-orchestrated, not yet a full Tauri-style explicit tool registry per phase
- per-agent tool permissions are not as strict as the reference Tauri implementation
- some advanced workspace polish and runtime guardrails still need refinement

## Why This Exists

The point of this project is not “chat with AI about software.”

The point is:

Use AI as a structured SDLC workspace that produces reviewable artifacts, implementation progress, and handover outputs against a real local project folder.
