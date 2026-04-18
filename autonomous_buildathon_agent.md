# Autonomous Buildathon Agent

`buildathon` now acts as a workspace-scoped autonomous agent client.

## Commands

```bash
buildathon
buildathon "analyze this repo and start discovery"
buildathon start /path/to/project
buildathon chat "analyze this repo and start discovery"
buildathon status
buildathon logs
buildathon approve --notes "Looks good"
buildathon changes --notes "Revise edge cases"
buildathon stop
```

## Runtime Model

- `buildathon start` initializes `.project-workflow/` if missing and launches a detached daemon.
- bare `buildathon` inside a terminal opens an interactive CLI chat shell for the current folder
- plain text after `buildathon` is treated as chat input automatically
- `buildathon chat` appends user input to the workspace agent state.
- the daemon ingests queued messages, updates the objective, and autonomously runs the active SDLC phase
- when a phase reaches `review_ready`, the daemon pauses and waits for `approve` or `changes`
- after approval, the daemon automatically continues into the next phase

## Interactive Shell

When you run `buildathon` in a TTY, the CLI opens a chat-oriented terminal UI with:

- workspace and daemon status
- active phase and approval status
- recent agent logs
- a persistent `you>` prompt

Inside that shell:

- normal text is sent as chat input
- `/status` refreshes the current state summary
- `/logs` refreshes the log tail
- `/approve [notes]` approves the current review gate
- `/changes <notes>` requests revisions
- `/stop` stops the daemon
- `/exit` leaves the shell

## Files

- `.project-workflow/workflow-state.json`
- `.project-workflow/agent-state.json`
- `.project-workflow/agent.log`
- `.project-workflow/runs/...`

## Important Constraint

The daemon is autonomous between approval gates, but it still uses the existing SDLC phase runner under the hood. That means review checkpoints remain explicit rather than silently skipped.
