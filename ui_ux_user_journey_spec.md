# UI UX And User Journey Spec

## Purpose

This document defines how users should interact with the SDLC desktop app before deeper implementation begins.

The goal is to make the product feel like a serious local-first workflow tool, not a generic chatbot and not a static dashboard.

## Product Interaction Model

The app should be built around four main objects:

- `Project`
- `Session`
- `Workflow`
- `Artifact`

These objects should stay separate in the product model.

### Project

A project is the long-lived container.

It owns:

- local workspace path
- imported or created folder
- workflow state
- generated artifacts
- project metadata
- all sessions inside that project

### Session

A session is a conversation thread inside a project.

It owns:

- messages
- current task focus
- temporary reasoning trail
- user instructions for a specific goal

A project should support multiple sessions.

Examples:

- `Project setup`
- `Initial Discovery`
- `Architecture Rework`
- `Frontend Scaffold`
- `Testing Follow-up`

### Workflow

The workflow belongs to the project, not to a specific session.

That means:

- phase approvals update project state
- all sessions in the same project can see current phase status
- one session can trigger a phase while another session reviews outputs

### Artifact

Artifacts are the source of truth for work outputs.

Examples:

- `requirements.md`
- `architecture.md`
- `user-journeys.md`
- `wireframes.md`
- `implementation-summary.md`
- `test-plan.md`
- `client-handover.md`

Artifacts should exist as files in the local workspace, not only as chat messages.

## High-Level UX Direction

The app should use a light theme and a split workspace layout inspired by the interaction model of `tauri embos`, but adapted for a more workflow-oriented SDLC product.

The recommended structure is:

- left side = chat and session control
- center = artifact workspace
- right side = workflow and agent status

This is the right balance because:

- chat gives flexibility and low-friction control
- the center panel gives users a real review surface
- the right panel keeps workflow state visible at all times

## Layout Model

### Far Left Rail

This should be a narrow vertical rail for app-level navigation.

Suggested items:

- home
- projects
- current project avatar/icon
- settings

This rail should remain compact and persistent.

### Left Panel

This is the conversational control area.

It should contain:

- project title
- session switcher or session list
- active session thread
- chat composer at the bottom
- quick actions related to the current phase

This panel should feel familiar to users of ChatGPT or Codex, but grounded in project workflow rather than open-ended chat.

### Center Panel

This is the main work surface.

It should show the currently selected artifact or output.

Examples:

- requirements document
- architecture document
- JSON handoff view
- wireframe spec
- code map
- logs

This should be the dominant panel visually.

### Right Panel

This is the workflow and agent status rail.

It should contain:

- all SDLC phases
- active phase
- status of each phase
- warnings or blockers
- approval state
- currently running agent or subtask

This panel gives structure and confidence to the workflow.

## Visual Direction

The app should use a light theme by default.

Recommended design direction:

- warm off-white background instead of pure white
- pale neutral surfaces for panels
- charcoal text
- muted teal or rust as the primary accent
- green for approved/success
- amber for review/warning
- red for blocked/failed
- subtle borders instead of heavy shadows

The UI should feel focused and editorial, not like a generic SaaS admin dashboard.

## Primary User Modes

The product should support three entry intentions:

- `Plan with SDLC workflow`
- `Generate scaffold`
- `Analyze existing project`

These are not separate products. They are different entry paths into the same local workflow system.

## First-Run User Journey

The user journey should begin with project creation or project import before any SDLC phase starts.

This is important because the workflow needs a concrete workspace.

### Step 1: Landing Screen

The user should first see two primary actions:

- `Create New Project`
- `Import Existing Folder`

This decision should come before opening a chat thread.

### Step 2: Project Setup

If the user chooses `Create New Project`, the app should ask for:

- project name
- local folder location
- desired outcome

Suggested outcome choices:

- `Build from scratch`
- `Generate scaffold only`
- `Run full SDLC workflow`

If the user chooses `Import Existing Folder`, the app should ask for:

- folder path
- desired outcome

Suggested outcome choices:

- `Understand existing codebase`
- `Continue with SDLC planning`
- `Scaffold missing pieces`
- `Prepare testing, devops, or handover`

### Step 3: Workflow Intent

Before opening the main workspace, the app should ask:

`What do you want this workspace to produce?`

Examples:

- requirements
- technical architecture
- UI planning
- starter code
- full delivery workflow

This keeps the system adaptable without forcing every user through the full eight-phase flow immediately.

### Step 4: Workspace Initialization

After setup, the app should:

- create or import the project
- initialize `.project-workflow`
- create workflow state
- create artifact folders
- create the first session

The first default session should be:

- `Project setup`

### Step 5: Open Main Workspace

Once initialized, the app should open the three-pane workspace:

- left = session and chat
- center = artifact viewer
- right = workflow status

From here the user can begin real work.

## Main Workspace User Journey

Once inside a project, the user should work in a continuous loop:

1. Talk to the assistant in the left panel.
2. Review generated output in the center panel.
3. Track phase progress and approvals in the right panel.
4. Approve, revise, retry, or continue.

This should be the core interaction model of the product.

## Session Model

A project should support multiple sessions or chats.

This is essential because one long chat per project becomes hard to manage.

### Why Multiple Sessions Matter

Without multiple sessions:

- unrelated tasks mix together
- conversations become too long
- approvals are harder to track
- revisions become messy

With multiple sessions:

- users can separate tasks
- users can revisit specific topics
- the app feels more professional and organized

### Session Rules

Each project should support:

- creating a new session
- renaming a session
- switching between sessions
- optionally forking a session
- archiving old sessions

All sessions in a project should still share:

- the same local workspace
- the same artifacts
- the same workflow state
- the same phase history

### Important Distinction

The workflow belongs to the project.

Sessions do not each get separate SDLC workflows by default.

That means:

- approving `Discovery` in one session updates the entire project workflow
- another session can immediately see that `Discovery` is approved
- sessions are task-level
- project state is workflow-level

## Entry Paths

The app should support two strong user paths from the start.

### 1. Guided SDLC Path

Best for users with rough ideas or early-stage product inputs.

Flow:

1. Create or import project
2. Describe the product
3. Start `Discovery`
4. Review generated requirements
5. Approve or request changes
6. Continue phase by phase

### 2. Scaffold-First Path

Best for users who want output quickly.

Flow:

1. Create or import project
2. State the technical goal
3. Run a shorter path such as:
   - Discovery lite
   - Architecture lite
   - Scaffold generation
4. Review generated structure
5. Continue into deeper SDLC phases later if needed

This path is important because many users will not want the full ceremony at the beginning.

## Left Panel UX

The left panel should act as the command surface.

It should support:

- conversational input
- structured clarifying questions
- quick phase actions
- session switching
- lightweight history

Users should be able to say things like:

- `Build a clinic CRM`
- `Use React and Node`
- `Only scaffold the repo first`
- `Why is Architecture blocked?`
- `Approve and continue`

The assistant should always remain aware of:

- current project
- active session
- current phase
- current artifact under review

## Center Panel UX

The center panel should be the main review surface.

It should show the actual output being worked on.

Recommended tabs:

- `Document`
- `JSON`
- `Files`
- `Logs`

Later, it may support:

- `Diff`
- `Compare`
- `Preview`

Important rule:

The center panel should never feel secondary to the chat.

Artifacts are the source of truth.

## Right Panel UX

The right panel should answer three questions at all times:

- What is running?
- What is blocked?
- What needs approval?

It should show:

- phase list from `Discovery` to `Handover`
- phase status badges
- active agent or current subtask
- warnings and blockers
- approval state

This panel should stay concise and structured.

It should not become a second file tree.

## Interaction Rules

The product should support both conversational and button-driven control.

Examples:

- user says `looks good, continue`
- UI also offers `Approve Discovery`

Both should work.

Phase changes should immediately update:

- the right panel state
- the active artifact in the center panel
- the session context in the left panel

## Suggested First Session Experience

The first session should guide the user without excessive friction.

Recommended sequence:

1. User creates or imports a project.
2. The app opens `Project setup`.
3. The assistant asks one or two focused setup questions.
4. The user states whether they want:
   - full SDLC workflow
   - scaffold only
   - existing codebase analysis
5. The app starts the appropriate initial workflow.
6. The first artifact opens in the center panel.

## What To Avoid

- do not open directly into a blank generic chatbot
- do not hide project state behind conversation only
- do not make the center panel optional
- do not tie workflow state to a single session
- do not force every user through all phases immediately
- do not make the right rail overly technical or cluttered

## Final UX Position

The product should feel like:

- a project workspace first
- a conversational assistant second
- a phase-based orchestration system throughout

The best short description is:

> A local-first SDLC workspace where users create or import a project, open multiple task-focused sessions, review artifacts in a central work area, and guide a shared project workflow through structured approvals.
