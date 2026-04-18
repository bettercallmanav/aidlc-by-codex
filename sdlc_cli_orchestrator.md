# SDLC CLI Orchestrator

This repository now includes a minimal real-world SDLC orchestrator for Codex CLI.

## What It Is

This is not a fake multi-agent chat chain.

It is a local orchestrator that owns:
- workflow state
- phase status
- approvals
- artifact folders
- run history

Codex is used only as the execution worker for a phase run.

## Files

- `scripts/sdlc/cli.mjs` is the main CLI entry point.
- `scripts/sdlc/phases.mjs` defines the phase order, deliverables, and upstream artifacts.
- `scripts/sdlc/handoff.schema.json` enforces a structured JSON response from `codex exec`.

## Workspace Layout

The orchestrator creates `.project-workflow/` with:

- `workflow-state.json`
- one folder per SDLC phase
- `runs/` with per-run prompts and handoff outputs

## Commands

```bash
npm run sdlc:init -- --name "Codex Buildathon" --project-type existing-codebase
npm run sdlc:status
npm run sdlc:run
npm run sdlc:approve -- --notes "Discovery looks good"
npm run sdlc:changes -- --notes "Revise missing edge cases"
```

You can also run a specific phase explicitly:

```bash
npm run sdlc:run -- architecture --search
```

## Run Model

When you run a phase:

1. the orchestrator checks workflow state
2. it writes a phase prompt into `.project-workflow/runs/.../prompt.md`
3. it invokes `codex exec`
4. Codex writes artifacts into `.project-workflow/<phase>/`
5. Codex returns a structured handoff JSON object
6. the orchestrator marks the phase `review_ready`

Approvals and change requests happen through the orchestrator, not inside the agent.

## Environment Overrides

- `SDLC_CODEX_MODEL`
- `SDLC_CODEX_SANDBOX`
- `SDLC_CODEX_APPROVAL`
- `SDLC_CODEX_SEARCH=1`
- `SDLC_CODEX_FULL_AUTO=1`

## Why This Matches The Product Docs

This follows the direction in the planning docs:
- app or orchestrator owns state
- artifacts are persisted on disk
- phases are gated
- approvals are explicit
- Codex is the worker, not the product state machine
