#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import {
  REPO_ROOT,
  appendLog,
  createInitialAgentState,
  getActivePhaseRecord,
  getActiveWorkspace,
  getAgentLogPath,
  getAgentStatePath,
  getWorkflowStatePath,
  isProcessAlive,
  normalizeWorkspace,
  pathExists,
  readAgentState,
  readJson,
  resolveWorkspaceOrFail,
  setActiveWorkspace,
  writeAgentState,
} from "./common.mjs";

const SDLC_CLI_PATH = path.join(REPO_ROOT, "scripts/sdlc/cli.mjs");
const DAEMON_PATH = path.join(REPO_ROOT, "scripts/agent/daemon.mjs");
const KNOWN_COMMANDS = new Set([
  "start",
  "chat",
  "status",
  "logs",
  "stop",
  "approve",
  "changes",
  "help",
  "--help",
  "-h",
]);

async function main() {
  const argv = process.argv.slice(2);
  const [command = "", ...args] = argv;

  try {
    if (!command) {
      await commandOpen(args);
      return;
    }

    if (!KNOWN_COMMANDS.has(command) && !command.startsWith("--")) {
      await commandChat(argv, { implicitWorkspace: getImplicitWorkspace() });
      return;
    }

    switch (command) {
      case "start":
        commandStart(args);
        break;
      case "chat":
        await commandChat(args);
        break;
      case "status":
        commandStatus(args);
        break;
      case "logs":
        commandLogs(args);
        break;
      case "stop":
        commandStop(args);
        break;
      case "approve":
        commandApprove(args);
        break;
      case "changes":
        commandChanges(args);
        break;
      case "help":
      case "--help":
      case "-h":
        printHelp();
        break;
      default:
        fail(`Unknown command: ${command}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function commandStart(args) {
  return commandStartInternal(args, {});
}

function commandStartInternal(args, config) {
  const options = parseOptions(args);
  const workspaceRoot = normalizeWorkspace(options._[0] ?? getImplicitWorkspace());

  if (!pathExists(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    fail(`Workspace folder not found: ${workspaceRoot}`);
  }

  ensureWorkflowInitialized(workspaceRoot);
  ensureAgentState(workspaceRoot);
  setActiveWorkspace(workspaceRoot);

  const agentState = readAgentState(workspaceRoot);
  if (isProcessAlive(agentState.daemon.pid)) {
    if (!config.silent) {
      console.log(`Agent already running for ${workspaceRoot}`);
      console.log(`PID: ${agentState.daemon.pid}`);
    }
    return { workspaceRoot, started: false, pid: agentState.daemon.pid };
  }

  agentState.stopRequested = false;
  agentState.daemon.status = "starting";
  agentState.daemon.currentPhase = null;
  agentState.lastError = null;
  writeAgentState(workspaceRoot, agentState);

  const child = spawn(process.execPath, [DAEMON_PATH, "--workspace", workspaceRoot], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
    },
  });
  child.unref();
  agentState.daemon.pid = child.pid ?? null;
  agentState.daemon.startedAt = new Date().toISOString();
  writeAgentState(workspaceRoot, agentState);

  appendLog(workspaceRoot, `Start requested from CLI for ${workspaceRoot}`);
  if (!config.silent) {
    console.log(`Started autonomous agent for ${workspaceRoot}`);
    console.log('Use `buildathon chat "your goal"` or just `buildathon "your goal"` to give it work.');
  }
  return { workspaceRoot, started: true, pid: child.pid ?? null };
}

async function commandChat(args, config = {}) {
  const options = parseOptions(args);
  const workspaceRoot = resolveWorkspaceOrFail(
    options.workspace ?? config.implicitWorkspace ?? getImplicitWorkspace(),
  );
  const message = options._.join(" ").trim();

  if (!message) {
    fail('Usage: buildathon chat "analyze this repo and start discovery"');
  }

  ensureWorkflowInitialized(workspaceRoot);
  ensureAgentState(workspaceRoot);
  setActiveWorkspace(workspaceRoot);
  ensureDaemonRunning(workspaceRoot);

  const agentState = readAgentState(workspaceRoot);
  agentState.chat.push({
    id: cryptoRandomId(),
    role: "user",
    body: message,
    createdAt: new Date().toISOString(),
    processedAt: null,
  });
  writeAgentState(workspaceRoot, agentState);
  appendLog(workspaceRoot, `Chat received: ${message}`);

  if (!config.silent) {
    console.log(`Queued for agent in ${workspaceRoot}`);
    console.log(message);
  }

  return { workspaceRoot, message };
}

async function commandOpen(args) {
  const options = parseOptions(args);
  const workspaceRoot = normalizeWorkspace(options.workspace ?? getImplicitWorkspace());
  const workflowWasNew = !pathExists(getWorkflowStatePath(workspaceRoot));

  if (!pathExists(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    fail(`Workspace folder not found: ${workspaceRoot}`);
  }

  ensureWorkflowInitialized(workspaceRoot);
  ensureAgentState(workspaceRoot);
  setActiveWorkspace(workspaceRoot);
  const daemonResult = ensureDaemonRunningInternal(workspaceRoot, { silent: true });

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    commandStatus(["--workspace", workspaceRoot]);
    return;
  }
  await runInteractiveShell(workspaceRoot, {
    workflowWasNew,
    daemonStarted: daemonResult?.started ?? false,
  });
}

function commandStatus(args) {
  const options = parseOptions(args);
  const workspaceRoot = resolveWorkspaceOrFail(options.workspace ?? getImplicitWorkspaceForStatus());
  setActiveWorkspace(workspaceRoot);
  printStatusSnapshot(getStatusSnapshot(workspaceRoot));
}

function commandLogs(args) {
  const options = parseOptions(args);
  const workspaceRoot = resolveWorkspaceOrFail(options.workspace ?? getImplicitWorkspaceForStatus());
  const lines = Number(options.lines ?? 60);
  console.log(getRecentLogLines(workspaceRoot, lines).join("\n"));
}

function commandStop(args) {
  const options = parseOptions(args);
  const workspaceRoot = resolveWorkspaceOrFail(options.workspace ?? getImplicitWorkspaceForStatus());
  const agentState = readAgentState(workspaceRoot);

  agentState.stopRequested = true;
  writeAgentState(workspaceRoot, agentState);
  appendLog(workspaceRoot, "Stop requested from CLI");

  if (isProcessAlive(agentState.daemon.pid)) {
    process.kill(agentState.daemon.pid, "SIGTERM");
    console.log(`Sent stop signal to pid ${agentState.daemon.pid}`);
  } else {
    console.log("Agent is not running.");
  }
}

function commandApprove(args) {
  const options = parseOptions(args);
  const workspaceRoot = resolveWorkspaceOrFail(options.workspace ?? getImplicitWorkspaceForStatus());
  const agentState = readAgentState(workspaceRoot);
  const phaseId = agentState.approvals.requiredPhaseId;
  const notes = options.notes ?? "";

  if (!phaseId) {
    fail("No phase is currently awaiting approval.");
  }

  runSdlcCommand(workspaceRoot, ["approve", phaseId, ...(notes ? ["--notes", notes] : [])]);

  const nextState = readAgentState(workspaceRoot);
  nextState.approvals.requiredPhaseId = null;
  nextState.approvals.requestedAt = null;
  nextState.lastError = null;
  writeAgentState(workspaceRoot, nextState);
  appendLog(workspaceRoot, `Approved ${phaseId}${notes ? ` with notes: ${notes}` : ""}`);

  console.log(`Approved ${phaseId}`);
}

function commandChanges(args) {
  const options = parseOptions(args);
  const workspaceRoot = resolveWorkspaceOrFail(options.workspace ?? getImplicitWorkspaceForStatus());
  const agentState = readAgentState(workspaceRoot);
  const phaseId = agentState.approvals.requiredPhaseId;
  const notes = options.notes ?? "";

  if (!phaseId) {
    fail("No phase is currently awaiting revision.");
  }

  runSdlcCommand(workspaceRoot, ["changes", phaseId, ...(notes ? ["--notes", notes] : [])]);

  const nextState = readAgentState(workspaceRoot);
  nextState.approvals.requiredPhaseId = null;
  nextState.approvals.requestedAt = null;
  nextState.lastError = null;
  if (notes) {
    nextState.chat.push({
      id: cryptoRandomId(),
      role: "user",
      body: `Revision request for ${phaseId}: ${notes}`,
      createdAt: new Date().toISOString(),
      processedAt: null,
    });
  }
  writeAgentState(workspaceRoot, nextState);
  appendLog(workspaceRoot, `Requested changes for ${phaseId}${notes ? `: ${notes}` : ""}`);

  console.log(`Requested changes for ${phaseId}`);
}

function ensureWorkflowInitialized(workspaceRoot) {
  if (pathExists(getWorkflowStatePath(workspaceRoot))) {
    return;
  }

  runSdlcCommand(workspaceRoot, [
    "init",
    "--name",
    path.basename(workspaceRoot),
    "--project-type",
    "existing-codebase",
  ]);
}

function ensureAgentState(workspaceRoot) {
  const statePath = getAgentStatePath(workspaceRoot);
  if (pathExists(statePath)) {
    return;
  }
  writeAgentState(workspaceRoot, createInitialAgentState(workspaceRoot));
}

function ensureDaemonRunning(workspaceRoot) {
  return ensureDaemonRunningInternal(workspaceRoot, {});
}

function ensureDaemonRunningInternal(workspaceRoot, config) {
  const agentState = readAgentState(workspaceRoot);
  if (isProcessAlive(agentState.daemon.pid)) {
    return { workspaceRoot, started: false, pid: agentState.daemon.pid };
  }
  return commandStartInternal([workspaceRoot], config);
}

async function runInteractiveShell(workspaceRoot, metadata) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let lastMessage = metadata.workflowWasNew
    ? `Initialized workspace in ${workspaceRoot}`
    : `Attached to ${workspaceRoot}`;

  if (metadata.daemonStarted) {
    lastMessage = `${lastMessage}\nAgent daemon started.`;
  }

  let closed = false;
  let lastSnapshot = getStatusSnapshot(workspaceRoot);
  let lastSignature = snapshotSignature(lastSnapshot);

  printInteractiveWelcome(lastSnapshot, lastMessage);

  const stopInterval = setInterval(() => {
    if (closed) {
      return;
    }

    const nextSnapshot = getStatusSnapshot(workspaceRoot);
    const nextSignature = snapshotSignature(nextSnapshot);

    if (nextSignature === lastSignature) {
      return;
    }

    lastSnapshot = nextSnapshot;
    lastSignature = nextSignature;
    printInteractiveUpdate(nextSnapshot);
    rl.prompt(true);
  }, 2000);

  rl.on("SIGINT", () => {
    closed = true;
    clearInterval(stopInterval);
    rl.close();
  });

  rl.on("close", () => {
    closed = true;
    clearInterval(stopInterval);
    process.stdout.write("\n");
  });

  rl.on("line", async (input) => {
    const line = input.trim();

    try {
      if (!line) {
        lastMessage = "No message sent.";
      } else if (line.startsWith("/")) {
        lastMessage = await handleInteractiveCommand(workspaceRoot, line);
      } else {
        await commandChat([line, "--workspace", workspaceRoot], { silent: true });
        lastMessage = `Queued: ${line}`;
      }
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }

    printInteractiveUpdate(getStatusSnapshot(workspaceRoot), lastMessage);
    rl.prompt(true);
  });

  rl.setPrompt("you> ");
  rl.prompt();
}

async function handleInteractiveCommand(workspaceRoot, line) {
  const [command, ...rest] = line.split(" ");
  const payload = rest.join(" ").trim();

  switch (command) {
    case "/help":
      return "Commands: /status, /logs, /approve [notes], /changes <notes>, /stop, /exit";
    case "/status":
      return formatStatusSummary(getStatusSnapshot(workspaceRoot));
    case "/logs":
      return "Recent logs refreshed.";
    case "/approve":
      commandApprove(["--workspace", workspaceRoot, ...(payload ? ["--notes", payload] : [])]);
      return payload ? `Approved with notes: ${payload}` : "Approved current review gate.";
    case "/changes":
      if (!payload) {
        throw new Error("Usage: /changes <notes>");
      }
      commandChanges(["--workspace", workspaceRoot, "--notes", payload]);
      return `Requested changes: ${payload}`;
    case "/stop":
      commandStop(["--workspace", workspaceRoot]);
      return "Stop requested.";
    case "/exit":
    case "/quit":
      process.exit(0);
      return "Exiting.";
    default:
      throw new Error(`Unknown slash command: ${command}`);
  }
}

function getStatusSnapshot(workspaceRoot) {
  const workflowState = readJson(getWorkflowStatePath(workspaceRoot), null);
  const agentState = readAgentState(workspaceRoot);
  const running = isProcessAlive(agentState.daemon.pid);
  const activePhaseRecord = workflowState ? getActivePhaseRecord(workflowState) : null;
  const queuedMessages = Array.isArray(agentState.chat)
    ? agentState.chat.filter((message) => message.role === "user" && !message.processedAt).length
    : 0;

  return {
    workspaceRoot,
    daemonPid: agentState.daemon.pid,
    daemonRunning: running,
    daemonStatus: agentState.daemon.status,
    objective: agentState.objective || "none",
    queuedMessages,
    activePhaseId: activePhaseRecord?.phaseId ?? null,
    activePhaseStatus: activePhaseRecord?.phaseState.status ?? "complete",
    approvalRequired: agentState.approvals.requiredPhaseId,
    lastError: agentState.lastError,
  };
}

function printStatusSnapshot(snapshot) {
  console.log(formatStatusSummary(snapshot));

  if (snapshot.approvalRequired) {
    console.log(`Approval required: ${snapshot.approvalRequired}`);
  }

  if (snapshot.lastError) {
    console.log(`Last error: ${snapshot.lastError}`);
  }
}

function formatStatusSummary(snapshot) {
  return [
    `Workspace: ${snapshot.workspaceRoot}`,
    `Daemon: ${snapshot.daemonRunning ? "running" : "stopped"}${snapshot.daemonPid ? ` (pid ${snapshot.daemonPid})` : ""}`,
    `Agent status: ${snapshot.daemonStatus}`,
    `Objective: ${snapshot.objective}`,
    `Queued chat messages: ${snapshot.queuedMessages}`,
    `Active phase: ${snapshot.activePhaseId ?? "complete"}`,
    `Phase status: ${snapshot.activePhaseStatus}`,
  ].join("\n");
}

function getRecentLogLines(workspaceRoot, lines) {
  const logPath = getAgentLogPath(workspaceRoot);
  if (!pathExists(logPath)) {
    return ["No agent logs yet."];
  }

  const content = fs.readFileSync(logPath, "utf8").trimEnd();
  const filtered = content
    ? content
        .split("\n")
        .filter((line) => !isNoisyLogLine(line))
        .slice(-Math.max(lines, 1))
    : [];

  return filtered.length > 0 ? filtered : ["No agent logs yet."];
}

function printInteractiveWelcome(snapshot, lastMessage) {
  console.log("Buildathon CLI");
  console.log(`Workspace: ${snapshot.workspaceRoot}`);
  console.log(compactStatusLine(snapshot));
  if (snapshot.approvalRequired) {
    console.log(`Approval required: ${snapshot.approvalRequired}  (/approve or /changes <notes>)`);
  }
  if (snapshot.lastError) {
    console.log(`Last error: ${snapshot.lastError}`);
  }
  console.log(lastMessage);
  console.log("Commands: /status  /logs  /approve [notes]  /changes <notes>  /stop  /exit");
  console.log("");
}

function printInteractiveUpdate(snapshot, lastMessage = "") {
  console.log("");
  console.log(`[status] ${compactStatusLine(snapshot)}`);
  if (snapshot.approvalRequired) {
    console.log(`[approval] ${snapshot.approvalRequired} is ready. Use /approve or /changes <notes>.`);
  }
  if (snapshot.lastError) {
    console.log(`[error] ${snapshot.lastError}`);
  }
  if (lastMessage) {
    console.log(`[action] ${lastMessage}`);
  }
}

function compactStatusLine(snapshot) {
  return [
    `daemon=${snapshot.daemonRunning ? "running" : "stopped"}`,
    `agent=${snapshot.daemonStatus}`,
    `phase=${snapshot.activePhaseId ?? "complete"}`,
    `phase_status=${snapshot.activePhaseStatus}`,
    `queued=${snapshot.queuedMessages}`,
  ].join(" | ");
}

function snapshotSignature(snapshot) {
  return JSON.stringify({
    daemonRunning: snapshot.daemonRunning,
    daemonStatus: snapshot.daemonStatus,
    objective: snapshot.objective,
    queuedMessages: snapshot.queuedMessages,
    activePhaseId: snapshot.activePhaseId,
    activePhaseStatus: snapshot.activePhaseStatus,
    approvalRequired: snapshot.approvalRequired,
    lastError: snapshot.lastError,
  });
}

function isNoisyLogLine(line) {
  const trimmed = line.trim();

  if (!trimmed) {
    return true;
  }

  if (trimmed === "thinking") {
    return true;
  }

  if (trimmed.startsWith("**")) {
    return true;
  }

  if (
    trimmed.startsWith("I need to") ||
    trimmed.startsWith("I should") ||
    trimmed.startsWith("I’ll") ||
    trimmed.startsWith("I'll") ||
    trimmed.startsWith("Let me")
  ) {
    return true;
  }

  return false;
}

function getImplicitWorkspace() {
  const cwd = normalizeWorkspace(process.cwd());
  const activeWorkspace = getActiveWorkspace();
  const home = normalizeWorkspace(process.env.HOME ?? path.join(process.env.USERPROFILE ?? "", ""));

  if (cwd === home && activeWorkspace) {
    return activeWorkspace;
  }

  return cwd;
}

function getImplicitWorkspaceForStatus() {
  const cwd = normalizeWorkspace(process.cwd());
  const workflowStatePath = getWorkflowStatePath(cwd);

  if (pathExists(workflowStatePath)) {
    return cwd;
  }

  return getActiveWorkspace() ?? cwd;
}

function runSdlcCommand(workspaceRoot, commandArgs) {
  const result = spawnSync(process.execPath, [SDLC_CLI_PATH, ...commandArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      BUILDATHON_WORKSPACE_ROOT: workspaceRoot,
    },
  });

  if (result.stdout?.trim()) {
    appendLog(workspaceRoot, result.stdout.trim());
  }
  if (result.stderr?.trim()) {
    appendLog(workspaceRoot, result.stderr.trim());
  }

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `SDLC command failed: ${commandArgs.join(" ")}`);
  }
}

function parseOptions(args) {
  const options = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    const name = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[name] = true;
      continue;
    }

    options[name] = next;
    index += 1;
  }

  return options;
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Buildathon Autonomous Agent

Usage:
  buildathon
  buildathon "analyze this repo and start discovery"
  buildathon start [folder]
  buildathon chat "analyze this repo and start discovery"
  buildathon status
  buildathon logs [--lines 80]
  buildathon approve --notes "Looks good"
  buildathon changes --notes "Revise edge cases"
  buildathon stop

Notes:
  - Running "buildathon" inside a folder auto-attaches that folder as the workspace
  - Bare "buildathon" opens an interactive CLI chat shell when run in a TTY
  - Plain text after "buildathon" is treated as chat input
  - "start" launches a local daemon for the workspace
  - "chat" queues user input for the autonomous loop
  - approvals pause the agent at review gates`);
}

await main();
