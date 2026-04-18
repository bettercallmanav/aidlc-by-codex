import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, "../..");
export const GLOBAL_ROOT = path.join(os.homedir(), ".buildathon");
export const ACTIVE_WORKSPACE_PATH = path.join(GLOBAL_ROOT, "active-workspace.json");

export function now() {
  return new Date().toISOString();
}

export function normalizeWorkspace(inputPath) {
  return path.resolve(inputPath);
}

export function getWorkflowRoot(workspaceRoot) {
  return path.join(workspaceRoot, ".project-workflow");
}

export function getWorkflowStatePath(workspaceRoot) {
  return path.join(getWorkflowRoot(workspaceRoot), "workflow-state.json");
}

export function getAgentStatePath(workspaceRoot) {
  return path.join(getWorkflowRoot(workspaceRoot), "agent-state.json");
}

export function getAgentLogPath(workspaceRoot) {
  return path.join(getWorkflowRoot(workspaceRoot), "agent.log");
}

export function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

export function pathExists(targetPath) {
  return fs.existsSync(targetPath);
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function appendLog(workspaceRoot, message) {
  const line = `[${now()}] ${message}\n`;
  const logPath = getAgentLogPath(workspaceRoot);
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, line);
}

export function readAgentState(workspaceRoot) {
  return readJson(getAgentStatePath(workspaceRoot), createInitialAgentState(workspaceRoot));
}

export function writeAgentState(workspaceRoot, state) {
  state.updatedAt = now();
  writeJson(getAgentStatePath(workspaceRoot), state);
}

export function createInitialAgentState(workspaceRoot) {
  const timestamp = now();

  return {
    version: 1,
    workspaceRoot,
    updatedAt: timestamp,
    objective: "",
    daemon: {
      pid: null,
      status: "stopped",
      startedAt: null,
      lastHeartbeatAt: null,
      currentPhase: null,
    },
    approvals: {
      requiredPhaseId: null,
      requestedAt: null,
    },
    chat: [],
    stopRequested: false,
    lastError: null,
  };
}

export function setActiveWorkspace(workspaceRoot) {
  ensureDir(GLOBAL_ROOT);
  writeJson(ACTIVE_WORKSPACE_PATH, {
    workspaceRoot,
    updatedAt: now(),
  });
}

export function getActiveWorkspace() {
  const state = readJson(ACTIVE_WORKSPACE_PATH, null);
  if (!state || typeof state.workspaceRoot !== "string" || !state.workspaceRoot) {
    return null;
  }
  return state.workspaceRoot;
}

export function resolveWorkspaceOrFail(inputPath) {
  const workspaceRoot = inputPath ? normalizeWorkspace(inputPath) : getActiveWorkspace();

  if (!workspaceRoot) {
    throw new Error("No active workspace. Run: buildathon start /path/to/project");
  }

  return workspaceRoot;
}

export function isProcessAlive(pid) {
  if (!pid || typeof pid !== "number") {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getActivePhaseRecord(workflowState) {
  if (!workflowState?.workflow?.activePhase) {
    return null;
  }

  const phaseId = workflowState.workflow.activePhase;
  const phaseState = workflowState.phases?.[phaseId] ?? null;

  return phaseState
    ? {
        phaseId,
        phaseState,
      }
    : null;
}

export function listRecentUserMessages(agentState, limit = 5) {
  return Array.isArray(agentState.chat)
    ? agentState.chat
        .filter((message) => message.role === "user" && typeof message.body === "string")
        .slice(-limit)
        .map((message) => message.body.trim())
        .filter(Boolean)
    : [];
}
