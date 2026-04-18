#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { PHASES, getNextPhaseId, getPhase } from "./phases.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "../..");
const ROOT = path.resolve(process.env.BUILDATHON_WORKSPACE_ROOT ?? DEFAULT_ROOT);
const WORKFLOW_ROOT = path.join(ROOT, ".project-workflow");
const STATE_PATH = path.join(WORKFLOW_ROOT, "workflow-state.json");
const RUNS_ROOT = path.join(WORKFLOW_ROOT, "runs");
const AGENT_STATE_PATH = path.join(WORKFLOW_ROOT, "agent-state.json");
const SCHEMA_PATH = path.join(__dirname, "handoff.schema.json");
const PHASE_STATUS = {
  NOT_STARTED: "not_started",
  RUNNING: "running",
  REVIEW_READY: "review_ready",
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  FAILED: "failed",
};

function main() {
  const [command = "help", ...args] = process.argv.slice(2);

  try {
    switch (command) {
      case "init":
        commandInit(args);
        break;
      case "status":
        commandStatus();
        break;
      case "run":
        commandRun(args);
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

function commandInit(args) {
  const options = parseOptions(args);
  const name = options.name ?? path.basename(ROOT);
  const projectType = options["project-type"] ?? "existing-codebase";

  ensureWorkflowLayout();
  const state = createInitialState({ name, projectType });
  writeJson(STATE_PATH, state);

  console.log(`Initialized SDLC workflow for "${name}".`);
  console.log(`Root: ${ROOT}`);
  console.log(`State: ${STATE_PATH}`);
  console.log(`Active phase: ${state.workflow.activePhase}`);
}

function commandStatus() {
  const state = readState();

  console.log(`Project: ${state.project.name}`);
  console.log(`Type: ${state.project.projectType}`);
  console.log(`Active phase: ${state.workflow.activePhase ?? "complete"}`);
  console.log("");
  console.log("Phases:");

  for (const phase of PHASES) {
    const phaseState = state.phases[phase.id];
    const marker = state.workflow.activePhase === phase.id ? "*" : " ";
    const updatedAt = phaseState.updatedAt ? ` (${phaseState.updatedAt})` : "";
    console.log(`${marker} ${phase.id.padEnd(12)} ${phaseState.status}${updatedAt}`);
  }

  if (state.approvals.length > 0) {
    const latest = state.approvals[state.approvals.length - 1];
    console.log("");
    console.log(`Latest approval: ${latest.phase} -> ${latest.decision} at ${latest.at}`);
  }
}

function commandRun(args) {
  const options = parseOptions(args);
  const phaseId = options._[0];
  const state = readState();
  const activePhaseId = phaseId ?? state.workflow.activePhase;

  if (!activePhaseId) {
    fail("Workflow is complete. Reinitialize or inspect past runs under .project-workflow/runs.");
  }

  const phase = getPhase(activePhaseId);
  if (!phase) {
    fail(`Unknown phase: ${activePhaseId}`);
  }

  if (state.workflow.activePhase !== activePhaseId) {
    fail(`Phase "${activePhaseId}" is not active. Active phase is "${state.workflow.activePhase}".`);
  }

  const phaseState = state.phases[activePhaseId];
  if (phaseState.status === PHASE_STATUS.APPROVED) {
    fail(`Phase "${activePhaseId}" is already approved.`);
  }

  const previousPhaseId = getPreviousPhaseId(activePhaseId);
  if (previousPhaseId && state.phases[previousPhaseId].status !== PHASE_STATUS.APPROVED) {
    fail(`Previous phase "${previousPhaseId}" must be approved before running "${activePhaseId}".`);
  }

  const runId = createRunId(activePhaseId);
  const runDir = path.join(RUNS_ROOT, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const prompt = buildPhasePrompt({ phase, state, runDir });
  const outputPath = path.join(runDir, "handoff.json");
  fs.writeFileSync(path.join(runDir, "prompt.md"), prompt);

  phaseState.status = PHASE_STATUS.RUNNING;
  phaseState.lastRunId = runId;
  phaseState.updatedAt = now();
  state.runs.push({
    id: runId,
    phase: activePhaseId,
    startedAt: phaseState.updatedAt,
    status: PHASE_STATUS.RUNNING,
    promptPath: path.relative(ROOT, path.join(runDir, "prompt.md")),
  });
  writeState(state);

  const commandArgs = [
    "exec",
    "--cd",
    ROOT,
    "--output-schema",
    SCHEMA_PATH,
    "-o",
    outputPath,
    "--sandbox",
    process.env.SDLC_CODEX_SANDBOX ?? "workspace-write",
    "-",
  ];

  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    commandArgs.splice(3, 0, "--skip-git-repo-check");
  }

  if (options.search || process.env.SDLC_CODEX_SEARCH === "1") {
    commandArgs.push("--search");
  }

  if (options.model || process.env.SDLC_CODEX_MODEL) {
    commandArgs.push("--model", options.model ?? process.env.SDLC_CODEX_MODEL);
  }

  if (options["full-auto"] || process.env.SDLC_CODEX_FULL_AUTO === "1") {
    removeArgPair(commandArgs, "--sandbox");
    commandArgs.push("--full-auto");
  }

  console.log(`Running ${activePhaseId} via Codex...`);
  const result = spawnSync("codex", commandArgs, {
    cwd: ROOT,
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  });

  if (result.error) {
    markRunFailed(state, activePhaseId, runId, result.error.message);
    throw result.error;
  }

  if (result.status !== 0) {
    markRunFailed(state, activePhaseId, runId, `Codex exited with status ${result.status}.`);
    fail(`Codex exited with status ${result.status}.`);
  }

  if (!fs.existsSync(outputPath)) {
    markRunFailed(state, activePhaseId, runId, "Codex did not produce a handoff output file.");
    fail("Codex did not produce a handoff output file.");
  }

  let handoff;
  try {
    handoff = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch (error) {
    markRunFailed(state, activePhaseId, runId, "Failed to parse handoff JSON.");
    throw error;
  }

  phaseState.status = PHASE_STATUS.REVIEW_READY;
  phaseState.updatedAt = now();
  phaseState.lastSummary = handoff.summary;
  phaseState.lastOutputPath = path.relative(ROOT, outputPath);
  updateRunRecord(state, runId, {
    status: PHASE_STATUS.REVIEW_READY,
    finishedAt: phaseState.updatedAt,
    outputPath: path.relative(ROOT, outputPath),
    summary: handoff.summary,
  });
  writeState(state);

  console.log("");
  console.log(`Phase ${activePhaseId} is ready for review.`);
  console.log(`Summary: ${handoff.summary}`);
  console.log(`Artifacts: ${handoff.artifacts.map((artifact) => artifact.path).join(", ") || "none listed"}`);
}

function commandApprove(args) {
  const options = parseOptions(args);
  const state = readState();
  const phaseId = options._[0] ?? state.workflow.activePhase;
  const notes = options.notes ?? "";
  const phase = getPhase(phaseId);

  if (!phase) {
    fail(`Unknown phase: ${phaseId}`);
  }

  const phaseState = state.phases[phaseId];
  if (phaseState.status !== PHASE_STATUS.REVIEW_READY) {
    fail(`Phase "${phaseId}" must be in review_ready before approval. Current status: ${phaseState.status}`);
  }

  phaseState.status = PHASE_STATUS.APPROVED;
  phaseState.updatedAt = now();
  phaseState.approvedAt = phaseState.updatedAt;

  const nextPhaseId = getNextPhaseId(phaseId);
  state.workflow.activePhase = nextPhaseId;
  state.workflow.status = nextPhaseId ? "active" : "complete";
  state.workflow.updatedAt = phaseState.updatedAt;
  state.approvals.push({
    phase: phaseId,
    decision: "approved",
    notes,
    at: phaseState.updatedAt,
  });
  writeState(state);

  console.log(`Approved ${phaseId}.`);
  if (nextPhaseId) {
    console.log(`Next phase: ${nextPhaseId}`);
  } else {
    console.log("Workflow complete.");
  }
}

function commandChanges(args) {
  const options = parseOptions(args);
  const state = readState();
  const phaseId = options._[0] ?? state.workflow.activePhase;
  const notes = options.notes ?? "";
  const phase = getPhase(phaseId);

  if (!phase) {
    fail(`Unknown phase: ${phaseId}`);
  }

  const phaseState = state.phases[phaseId];
  if (phaseState.status !== PHASE_STATUS.REVIEW_READY) {
    fail(`Phase "${phaseId}" must be in review_ready before requesting changes. Current status: ${phaseState.status}`);
  }

  phaseState.status = PHASE_STATUS.CHANGES_REQUESTED;
  phaseState.updatedAt = now();
  state.workflow.updatedAt = phaseState.updatedAt;
  state.approvals.push({
    phase: phaseId,
    decision: "changes_requested",
    notes,
    at: phaseState.updatedAt,
  });
  writeState(state);

  console.log(`Marked ${phaseId} as changes_requested.`);
}

function createInitialState({ name, projectType }) {
  const timestamp = now();
  return {
    version: 1,
    project: {
      name,
      rootPath: ROOT,
      workflowRoot: WORKFLOW_ROOT,
      projectType,
      createdAt: timestamp,
    },
    workflow: {
      activePhase: PHASES[0].id,
      status: "active",
      updatedAt: timestamp,
    },
    phases: Object.fromEntries(
      PHASES.map((phase, index) => [
        phase.id,
        {
          status: index === 0 ? PHASE_STATUS.NOT_STARTED : PHASE_STATUS.NOT_STARTED,
          updatedAt: timestamp,
          lastRunId: null,
          lastOutputPath: null,
          lastSummary: "",
          approvedAt: null,
        },
      ]),
    ),
    approvals: [],
    runs: [],
  };
}

function ensureWorkflowLayout() {
  fs.mkdirSync(WORKFLOW_ROOT, { recursive: true });
  fs.mkdirSync(RUNS_ROOT, { recursive: true });
  for (const phase of PHASES) {
    fs.mkdirSync(path.join(WORKFLOW_ROOT, phase.dir), { recursive: true });
  }
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) {
    fail(`Workflow not initialized. Run: npm run sdlc:init -- --name "${path.basename(ROOT)}"`);
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function writeState(state) {
  ensureWorkflowLayout();
  writeJson(STATE_PATH, state);
}

function buildPhasePrompt({ phase, state, runDir }) {
  const workflowRelative = path.relative(ROOT, WORKFLOW_ROOT);
  const outputDir = path.join(workflowRelative, phase.dir);
  const activeNotes = latestDecisionNote(state, phase.id);
  const agentContext = readAgentContext();
  const reads = phase.reads.length > 0 ? phase.reads.map((item) => `- ${path.join(workflowRelative, item)}`).join("\n") : "- No prior artifacts are required.";
  const deliverables = phase.deliverables.map((name) => `- ${path.join(outputDir, name)}`).join("\n");
  const runRelative = path.relative(ROOT, runDir);
  const recentMessages =
    agentContext.messages.length > 0
      ? agentContext.messages.map((message) => `- ${message}`).join("\n")
      : "- No user chat guidance has been recorded yet.";

  return `You are the ${phase.label} phase of a gated SDLC workflow running locally in a Codex CLI workspace.

Project root:
- ${ROOT}

Workflow workspace:
- ${workflowRelative}

Current phase:
- ${phase.id}

Phase objective:
- ${phase.objective}

Required deliverables for this run:
${deliverables}

Artifacts to read before you start:
${reads}

Review context:
- Active phase in workflow state: ${state.workflow.activePhase}
- Current phase status: ${state.phases[phase.id].status}
- Latest review note for this phase: ${activeNotes || "none"}

Agent context:
- High-level objective: ${agentContext.objective || "No explicit objective set yet."}
- Recent user guidance:
${recentMessages}

Execution rules:
- Read and update files locally in the repository.
- Write this phase's artifacts into ${outputDir}.
- If a required JSON artifact does not exist yet, create it.
- Keep outputs concrete and delivery-oriented, not generic.
- Do not approve or advance the workflow yourself.
- Do not modify workflow-state.json directly.
- Save any auxiliary notes for this run under ${runRelative} if useful.

Final response rules:
- Your final response must be valid JSON matching the provided schema.
- Do not wrap the JSON in markdown fences.
- In "artifacts", list the files you wrote or materially updated for this phase.
- Put unresolved issues in "open_questions" and "risks".
- Set eval.confidence between 0 and 1.
- For next_input, always provide the string keys "recommended_next_phase", "focus", and "notes". Use empty strings when you have nothing to add.`;
}

function readAgentContext() {
  if (!fs.existsSync(AGENT_STATE_PATH)) {
    return {
      objective: "",
      messages: [],
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(AGENT_STATE_PATH, "utf8"));
    const messages = Array.isArray(raw.chat)
      ? raw.chat
          .filter((entry) => entry && entry.role === "user" && typeof entry.body === "string")
          .slice(-5)
          .map((entry) => entry.body.trim())
          .filter(Boolean)
      : [];

    return {
      objective: typeof raw.objective === "string" ? raw.objective.trim() : "",
      messages,
    };
  } catch {
    return {
      objective: "",
      messages: [],
    };
  }
}

function latestDecisionNote(state, phaseId) {
  const entry = [...state.approvals].reverse().find((approval) => approval.phase === phaseId && approval.notes);
  return entry?.notes ?? "";
}

function markRunFailed(state, phaseId, runId, reason) {
  const phaseState = state.phases[phaseId];
  phaseState.status = PHASE_STATUS.FAILED;
  phaseState.updatedAt = now();
  updateRunRecord(state, runId, {
    status: PHASE_STATUS.FAILED,
    finishedAt: phaseState.updatedAt,
    error: reason,
  });
  writeState(state);
}

function updateRunRecord(state, runId, patch) {
  const run = state.runs.find((entry) => entry.id === runId);
  if (run) {
    Object.assign(run, patch);
  }
}

function createRunId(phaseId) {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${phaseId}`;
}

function getPreviousPhaseId(phaseId) {
  const index = PHASES.findIndex((phase) => phase.id === phaseId);
  if (index <= 0) {
    return null;
  }
  return PHASES[index - 1].id;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function removeArgPair(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) {
    args.splice(index, 2);
  }
}

function now() {
  return new Date().toISOString();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`SDLC CLI Orchestrator

Usage:
  node scripts/sdlc/cli.mjs init --name "Project Name" [--project-type new-project|existing-codebase]
  node scripts/sdlc/cli.mjs status
  node scripts/sdlc/cli.mjs run [phase] [--search] [--model MODEL] [--full-auto]
  node scripts/sdlc/cli.mjs approve [phase] [--notes "Approved with caveats"]
  node scripts/sdlc/cli.mjs changes [phase] [--notes "Revise edge cases"]

Notes:
  - The active phase is tracked in .project-workflow/workflow-state.json
  - "run" defaults to the currently active phase
  - Phase execution is delegated to codex exec with a structured JSON handoff`);
}

main();
