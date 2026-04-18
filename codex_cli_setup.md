# Codex CLI Setup

This repository now includes a minimal Codex CLI scaffold aimed at local agent work.

## Included Files
- `AGENTS.md` gives Codex project-specific instructions about structure, commands, and delivery expectations.
- `scripts/codex/run.sh` starts Codex from the repository root with sensible defaults.
- `scripts/codex/review.sh` runs non-interactive code reviews from the repository root.
- `scripts/codex/setup.sh` installs the OpenAI developer docs MCP server if it is missing.

## npm Commands
- `npm run codex` starts Codex in this repository.
- `npm run codex:search` starts Codex with web search enabled.
- `npm run codex:full` starts Codex in the lower-friction `--full-auto` mode.
- `npm run codex:review` reviews uncommitted changes in this repository.
- `npm run codex:setup` installs the docs MCP server and prints the recommended entry points.

## Common Usage
```bash
npm run codex -- "Audit the Electron preload bridge for security issues"
npm run codex:search -- "Check the latest Electron guidance before changing preload APIs"
npm run codex:review
```

## Notes
- The Codex CLI itself reads defaults from `~/.codex/config.toml`.
- This workspace already works well with the current trusted-project model because the wrapper always targets the repository root.
- If you want a different default model or approval policy for this repo, set `CODEX_MODEL`, `CODEX_SANDBOX`, or `CODEX_APPROVAL` before running the wrapper scripts.
