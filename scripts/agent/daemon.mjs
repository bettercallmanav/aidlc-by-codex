#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
import {
  REPO_ROOT,
  appendLog,
  getActivePhaseRecord,
  getWorkflowStatePath,
  isProcessAlive,
  listRecentUserMessages,
  pathExists,
  readAgentState,
  readJson,
  resolveWorkspaceOrFail,
  writeAgentState,
} from "./common.mjs";

const PHASE_POLL_MS = 2000;
const SDLC_CLI_PATH = path.join(REPO_ROOT, "scripts/sdlc/cli.mjs");

let stopping = false;

function main() {
  const args = process.argv.slice(2);
  const workspaceArgIndex = args.indexOf("--workspace");
  const workspaceRoot = resolveWorkspaceOrFail(
    workspaceArgIndex >= 0 ? args[workspaceArgIndex + 1] : null,
  );

  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });

  runLoop(workspaceRoot);
}

async function runLoop(workspaceRoot) {
  appendLog(workspaceRoot, `Daemon booting for ${workspaceRoot}`);

  while (!stopping) {
    const agentState = readAgentState(workspaceRoot);
    agentState.daemon.pid = process.pid;
    agentState.daemon.startedAt = agentState.daemon.startedAt ?? new Date().toISOString();
    agentState.daemon.lastHeartbeatAt = new Date().toISOString();
    agentState.lastError = null;

    if (agentState.stopRequested) {
      break;
    }

    const workflowState = readJson(getWorkflowStatePath(workspaceRoot), null);
    if (!workflowState) {
      agentState.daemon.status = "waiting_for_init";
      writeAgentState(workspaceRoot, agentState);
      await sleep(PHASE_POLL_MS);
      continue;
    }

    ingestQueuedChat(workspaceRoot, agentState);

    const activePhaseRecord = getActivePhaseRecord(workflowState);
    if (!activePhaseRecord) {
      agentState.daemon.status = "completed";
      agentState.daemon.currentPhase = null;
      agentState.approvals.requiredPhaseId = null;
      agentState.approvals.requestedAt = null;
      writeAgentState(workspaceRoot, agentState);
      await sleep(PHASE_POLL_MS);
      continue;
    }

    const { phaseId, phaseState } = activePhaseRecord;
    agentState.daemon.currentPhase = phaseId;

    if (phaseState.status === "review_ready") {
      if (agentState.approvals.requiredPhaseId !== phaseId) {
        appendLog(workspaceRoot, `${phaseId} is ready for approval`);
      }
      agentState.daemon.status = "awaiting_approval";
      agentState.approvals.requiredPhaseId = phaseId;
      agentState.approvals.requestedAt = new Date().toISOString();
      writeAgentState(workspaceRoot, agentState);
      await sleep(PHASE_POLL_MS);
      continue;
    }

    if (phaseState.status === "running") {
      agentState.daemon.status = "running_phase";
      writeAgentState(workspaceRoot, agentState);
      await sleep(PHASE_POLL_MS);
      continue;
    }

    if (!shouldAutoRun(agentState, phaseState.status)) {
      agentState.daemon.status = "idle";
      writeAgentState(workspaceRoot, agentState);
      await sleep(PHASE_POLL_MS);
      continue;
    }

    agentState.daemon.status = "running_phase";
    agentState.approvals.requiredPhaseId = null;
    agentState.approvals.requestedAt = null;
    writeAgentState(workspaceRoot, agentState);
    appendLog(workspaceRoot, `Running phase ${phaseId}`);

    const result = spawnSync(process.execPath, [SDLC_CLI_PATH, "run", phaseId], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        BUILDATHON_WORKSPACE_ROOT: workspaceRoot,
        SDLC_CODEX_APPROVAL: process.env.SDLC_CODEX_APPROVAL ?? "never",
        SDLC_CODEX_SANDBOX: process.env.SDLC_CODEX_SANDBOX ?? "workspace-write",
      },
    });

    if (result.stdout?.trim()) {
      appendLog(workspaceRoot, result.stdout.trim());
    }
    if (result.stderr?.trim()) {
      appendLog(workspaceRoot, result.stderr.trim());
    }

    if (result.status !== 0) {
      const failedState = readAgentState(workspaceRoot);
      failedState.daemon.status = "error";
      failedState.lastError = `Phase ${phaseId} failed with exit status ${result.status}`;
      writeAgentState(workspaceRoot, failedState);
      appendLog(workspaceRoot, failedState.lastError);
      await sleep(PHASE_POLL_MS);
      continue;
    }
  }

  const finalState = readAgentState(workspaceRoot);
  finalState.daemon.status = "stopped";
  finalState.daemon.lastHeartbeatAt = new Date().toISOString();
  finalState.stopRequested = false;
  writeAgentState(workspaceRoot, finalState);
  appendLog(workspaceRoot, "Daemon stopped");
}

function ingestQueuedChat(workspaceRoot, agentState) {
  if (!Array.isArray(agentState.chat)) {
    agentState.chat = [];
  }

  let changed = false;
  for (const message of agentState.chat) {
    if (message.role !== "user" || message.processedAt) {
      continue;
    }
    message.processedAt = new Date().toISOString();
    changed = true;
    appendLog(workspaceRoot, `Queued user input: ${message.body}`);
  }

  const recentMessages = listRecentUserMessages(agentState, 5);
  agentState.objective = recentMessages.join("\n\n");

  if (changed) {
    writeAgentState(workspaceRoot, agentState);
  }
}

function shouldAutoRun(agentState, phaseStatus) {
  if (!["not_started", "changes_requested", "failed"].includes(phaseStatus)) {
    return false;
  }

  return Boolean(agentState.objective || listRecentUserMessages(agentState, 1).length > 0);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main();
