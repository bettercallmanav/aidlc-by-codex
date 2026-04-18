#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SANDBOX_MODE="${CODEX_SANDBOX:-workspace-write}"
APPROVAL_POLICY="${CODEX_APPROVAL:-on-request}"

args=(
  --cd "$ROOT"
)

if [[ "${CODEX_FULL_AUTO:-0}" == "1" ]]; then
  args+=(--full-auto)
else
  args+=(--sandbox "$SANDBOX_MODE" --ask-for-approval "$APPROVAL_POLICY")
fi

if [[ -n "${CODEX_MODEL:-}" ]]; then
  args+=(--model "$CODEX_MODEL")
fi

if [[ "${CODEX_ENABLE_SEARCH:-0}" == "1" ]]; then
  args+=(--search)
fi

exec codex "${args[@]}" "$@"
