#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not installed or not on PATH." >&2
  exit 1
fi

if codex mcp list | awk 'NR > 2 { print $1 }' | grep -qx "openaiDeveloperDocs"; then
  docs_status="already configured"
else
  codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp >/dev/null
  docs_status="installed"
fi

cat <<EOF
Codex CLI scaffold is ready for:
  $ROOT

OpenAI developer docs MCP:
  $docs_status

Suggested commands:
  npm run codex -- "Inspect this repo and suggest the next task"
  npm run codex:search -- "Check the latest official docs before changing this integration"
  npm run codex:review
EOF
