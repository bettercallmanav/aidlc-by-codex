import { app } from "electron"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { emitCodexUiEvent, sendCodexSessionMessage } from "./codex-app-server.js"
import {
  getPhaseDefinition,
  getNextPhaseId,
  getSupplementalAgentDefinition,
  phaseDefinitions,
  phasePrimaryArtifacts,
  projectTypeLabels,
  supplementalAgentDefinitions,
  workflowFolderNames,
  workflowModeLabels,
  type PhaseDefinition,
  type PhaseId,
  type ProjectType,
  type SupplementalAgentId,
  type WorkflowMode
} from "./sdlc-phases.js"

type SessionKind =
  | "setup"
  | "analysis"
  | "discovery"
  | "architecture"
  | "journey"
  | "wireframe"
  | "implementation"
  | "testing"
  | "devops"
  | "handover"
  | "general"
type SessionStatus = "active" | "idle" | "archived"
type SessionTitleSource = "seeded" | "pending_first_message" | "message" | "manual"
type SessionMessageRole = "system" | "user" | "assistant"
type SessionAgentId = "auto" | "workspace" | PhaseId | SupplementalAgentId
type PhaseStatus =
  | "not_started"
  | "running"
  | "review_ready"
  | "approved"
  | "changes_requested"
  | "failed"
type WorkspaceScope = "all" | "changes"
type WorkspaceEntryKind = "markdown" | "json" | "code" | "text" | "other"
type WorkspaceFileKind =
  | "markdown"
  | "json"
  | "code"
  | "text"
  | "image"
  | "directory"
  | "unsupported"
  | "not_found"

type WorkflowPhase = PhaseDefinition & {
  status: PhaseStatus
  lastUpdatedAt: string
}

type ArtifactRecord = {
  id: string
  phaseId: string
  path: string
  kind: "markdown" | "json" | "code" | "other"
  createdAt: string
}

type ProjectRecord = {
  id: string
  name: string
  slug: string
  projectType: ProjectType
  workflowMode: WorkflowMode
  workspacePath: string
  workflowPath: string
  createdAt: string
  updatedAt: string
}

type SessionRecord = {
  id: string
  projectId: string
  title: string
  titleSource: SessionTitleSource
  kind: SessionKind
  status: SessionStatus
  summary: string
  preview: string
  selectedModel: string | null
  selectedAgentId: SessionAgentId
  codexConversationId?: string | null
  codexRolloutPath?: string | null
  createdAt: string
  updatedAt: string
}

type SessionMessageRecord = {
  id: string
  sessionId: string
  role: SessionMessageRole
  label: string
  body: string
  chips: string[]
  createdAt: string
}

type ToolUiAction =
  | {
      type: "open_file"
      relativePath: string
      targetTab: "files" | "review"
    }
  | null

type PendingHandoff = {
  fromPhaseId: PhaseId
  toPhaseId: PhaseId
  reason?: string
  createdAt: string
}

type WorkflowState = {
  projectId: string
  activePhaseId: string | null
  phases: WorkflowPhase[]
  artifacts: ArtifactRecord[]
  pendingHandoff?: PendingHandoff | null
}

type WorkspaceEntry = {
  name: string
  path: string
  type: "directory" | "file"
  kind?: WorkspaceEntryKind
  children?: WorkspaceEntry[]
}

type WorkspaceFileContent = {
  path: string
  name: string
  kind: WorkspaceFileKind
  language?: string
  content?: string
  dataUrl?: string
}

type StoreState = {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  sessionMessages: SessionMessageRecord[]
  activeProjectId: string | null
  activeSessionIdByProject: Record<string, string>
}

type CreateProjectInput = {
  name: string
  projectType: ProjectType
  workflowMode: WorkflowMode
  workspacePath?: string
}

type DashboardData = {
  projects: ProjectRecord[]
  activeProject: ProjectRecord | null
  workflow: WorkflowState | null
  sessions: SessionRecord[]
  activeSession: SessionRecord | null
  allSessions: SessionRecord[]
}

type SendSessionMessageResult = {
  dashboard: DashboardData
  messages: SessionMessageRecord[]
  uiAction?: ToolUiAction
}

const ignoredWorkspaceEntries = new Set([
  ".DS_Store",
  ".git",
  "coverage",
  "dist",
  "dist-electron",
  "node_modules"
])

const textExtensionMap: Record<
  string,
  {
    kind: Exclude<WorkspaceFileKind, "directory" | "unsupported" | "not_found">
    language?: string
  }
> = {
  ".css": { kind: "code", language: "css" },
  ".html": { kind: "code", language: "html" },
  ".js": { kind: "code", language: "javascript" },
  ".json": { kind: "json", language: "json" },
  ".jsx": { kind: "code", language: "jsx" },
  ".md": { kind: "markdown", language: "markdown" },
  ".mjs": { kind: "code", language: "javascript" },
  ".ts": { kind: "code", language: "typescript" },
  ".tsx": { kind: "code", language: "tsx" },
  ".txt": { kind: "text", language: "text" }
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const ensureDirectory = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true })
}

const pathExists = async (targetPath: string) => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const assertDirectory = async (targetPath: string) => {
  const stats = await fs.stat(targetPath).catch(() => null)

  if (!stats || !stats.isDirectory()) {
    throw new Error("Workspace path must point to an existing folder")
  }
}

const getStoreFilePath = () => path.join(app.getPath("userData"), "projects-state.json")

const getDefaultProjectsBasePath = () =>
  path.join(app.getPath("documents"), "Codex Buildathon Projects")

const getWorkflowStatePath = (workflowPath: string) => path.join(workflowPath, "workflow-state.json")

const normalizeRelativePath = (value: string | undefined) =>
  (value ?? "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")

const pendingSessionTitle = "New session"

const isSessionTitleSource = (value: unknown): value is SessionTitleSource =>
  value === "seeded" ||
  value === "pending_first_message" ||
  value === "message" ||
  value === "manual"

const normalizeSessionTitleSource = (
  titleSource: unknown,
  title: string | null | undefined
): SessionTitleSource => {
  if (isSessionTitleSource(titleSource)) {
    return titleSource
  }

  return title?.trim() === pendingSessionTitle ? "pending_first_message" : "manual"
}

const deriveSessionTitleFromMessage = (message: string) => {
  const normalized = message.replace(/\s+/g, " ").trim()

  if (!normalized) {
    return pendingSessionTitle
  }

  const maxLength = 56
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`
}

const toWorkspaceRelativePath = (workspacePath: string, absolutePath: string) =>
  path.relative(workspacePath, absolutePath).split(path.sep).join("/")

const fromWorkspaceRelativePath = (workspacePath: string, relativePath: string) =>
  path.join(workspacePath, ...normalizeRelativePath(relativePath).split("/").filter(Boolean))

const resolveWorkspaceTarget = (workspacePath: string, relativePath?: string) => {
  const basePath = path.resolve(workspacePath)
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  const absolutePath = path.resolve(basePath, normalizedRelativePath)

  if (absolutePath !== basePath && !absolutePath.startsWith(`${basePath}${path.sep}`)) {
    throw new Error("Path must stay inside the project workspace")
  }

  return {
    basePath,
    absolutePath,
    relativePath: normalizedRelativePath
  }
}

const getPhaseFolderRelativePath = (phaseId: string) => {
  const typedPhaseId = phaseId as PhaseId
  return `.project-workflow/${workflowFolderNames[typedPhaseId] ?? phaseId}`
}

const getPhaseArtifactRelativePath = (phaseId: string) => {
  const typedPhaseId = phaseId as PhaseId
  return `${getPhaseFolderRelativePath(phaseId)}/${phasePrimaryArtifacts[typedPhaseId] ?? "artifact.md"}`
}

const buildInitialWorkflowState = (projectId: string): WorkflowState => {
  const now = new Date().toISOString()

  return {
    projectId,
    activePhaseId: "discovery",
    phases: phaseDefinitions.map((phase, index) => ({
      ...phase,
      status: index === 0 ? "running" : "not_started",
      lastUpdatedAt: now
    })),
    artifacts: [],
    pendingHandoff: null
  }
}

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const content = await fs.readFile(filePath, "utf8")
    return JSON.parse(content) as T
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException

    if (nodeError.code === "ENOENT") {
      return fallback
    }

    throw error
  }
}

const writeJsonFile = async (filePath: string, value: unknown) => {
  await ensureDirectory(path.dirname(filePath))
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8")
}

const normalizeProject = (project: Partial<ProjectRecord>): ProjectRecord | null => {
  if (!project.id || !project.name || !project.slug || !project.workspacePath || !project.workflowPath) {
    return null
  }

  const projectType =
    project.projectType === "existing_codebase" ? "existing_codebase" : "new_project"

  const workflowMode =
    project.workflowMode &&
    ["full_sdlc", "scaffold_first", "analyze_existing"].includes(project.workflowMode)
      ? project.workflowMode
      : projectType === "existing_codebase"
        ? "analyze_existing"
        : "full_sdlc"

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    projectType,
    workflowMode,
    workspacePath: project.workspacePath,
    workflowPath: project.workflowPath,
    createdAt: project.createdAt ?? new Date().toISOString(),
    updatedAt: project.updatedAt ?? project.createdAt ?? new Date().toISOString()
  }
}

const isSessionAgentId = (value: string | null | undefined): value is SessionAgentId =>
  value === "auto" ||
  value === "workspace" ||
  Boolean(getPhaseDefinition(value)) ||
  Boolean(getSupplementalAgentDefinition(value))

const normalizeSession = (session: Partial<SessionRecord>): SessionRecord | null => {
  if (!session.id || !session.projectId || !session.title) {
    return null
  }

  const kind: SessionKind =
    session.kind &&
    [
      "setup",
      "analysis",
      "discovery",
      "architecture",
      "journey",
      "wireframe",
      "implementation",
      "testing",
      "devops",
      "handover",
      "general"
    ].includes(session.kind)
      ? session.kind
      : "general"

  const status: SessionStatus =
    session.status && ["active", "idle", "archived"].includes(session.status)
      ? session.status
      : "idle"

  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    titleSource: normalizeSessionTitleSource(session.titleSource, session.title),
    kind,
    status,
    summary: session.summary ?? "Task-focused thread inside the project workspace.",
    preview: session.preview ?? "Use this session to guide a specific workflow task.",
    selectedModel:
      typeof session.selectedModel === "string" ? session.selectedModel.trim() || null : null,
    selectedAgentId: isSessionAgentId(session.selectedAgentId) ? session.selectedAgentId : "auto",
    codexConversationId:
      typeof session.codexConversationId === "string" ? session.codexConversationId : null,
    codexRolloutPath: typeof session.codexRolloutPath === "string" ? session.codexRolloutPath : null,
    createdAt: session.createdAt ?? new Date().toISOString(),
    updatedAt: session.updatedAt ?? session.createdAt ?? new Date().toISOString()
  }
}

const normalizeMessage = (message: Partial<SessionMessageRecord>): SessionMessageRecord | null => {
  if (!message.id || !message.sessionId || !message.role || !message.label || !message.body) {
    return null
  }

  const role: SessionMessageRole =
    ["system", "user", "assistant"].includes(message.role) ? message.role : "assistant"

  return {
    id: message.id,
    sessionId: message.sessionId,
    role,
    label: message.label,
    body: message.body,
    chips: Array.isArray(message.chips)
      ? message.chips.filter((chip): chip is string => typeof chip === "string")
      : [],
    createdAt: message.createdAt ?? new Date().toISOString()
  }
}

const normalizeStoreState = (state: Partial<StoreState> | null | undefined): StoreState => {
  const projects = (state?.projects ?? []).map(normalizeProject).filter(Boolean) as ProjectRecord[]
  const sessions = (state?.sessions ?? []).map(normalizeSession).filter(Boolean) as SessionRecord[]
  const sessionMessages = (state?.sessionMessages ?? [])
    .map(normalizeMessage)
    .filter(Boolean) as SessionMessageRecord[]

  return {
    projects,
    sessions,
    sessionMessages,
    activeProjectId:
      state?.activeProjectId && projects.some((project) => project.id === state.activeProjectId)
        ? state.activeProjectId
        : projects[0]?.id ?? null,
    activeSessionIdByProject: state?.activeSessionIdByProject ?? {}
  }
}

const readStoreState = async (): Promise<StoreState> => {
  const rawState = await readJsonFile<Partial<StoreState>>(getStoreFilePath(), {
    projects: [],
    sessions: [],
    sessionMessages: [],
    activeProjectId: null,
    activeSessionIdByProject: {}
  })

  return normalizeStoreState(rawState)
}

const writeStoreState = async (state: StoreState) => {
  await writeJsonFile(getStoreFilePath(), state)
}

const readWorkflowState = async (workflowPath: string): Promise<WorkflowState> => {
  return readJsonFile<WorkflowState>(
    getWorkflowStatePath(workflowPath),
    buildInitialWorkflowState("missing-project")
  )
}

const writeWorkflowState = async (workflowPath: string, workflow: WorkflowState) => {
  await writeJsonFile(getWorkflowStatePath(workflowPath), workflow)
}

const writeFileIfMissing = async (filePath: string, value: string) => {
  if (await pathExists(filePath)) {
    return
  }

  await ensureDirectory(path.dirname(filePath))
  await fs.writeFile(filePath, value, "utf8")
}

const inferArtifactKind = (relativePath: string): ArtifactRecord["kind"] => {
  const extension = path.extname(relativePath).toLowerCase()

  if (extension === ".md") {
    return "markdown"
  }

  if (extension === ".json") {
    return "json"
  }

  if ([".css", ".html", ".js", ".jsx", ".mjs", ".ts", ".tsx"].includes(extension)) {
    return "code"
  }

  return "other"
}

const inferWorkspaceEntryKind = (relativePath: string): WorkspaceEntryKind => {
  const artifactKind = inferArtifactKind(relativePath)

  if (artifactKind === "other" && path.extname(relativePath).toLowerCase() === ".txt") {
    return "text"
  }

  return artifactKind === "other" ? "other" : artifactKind
}

const getTextFileDescriptor = (relativePath: string) =>
  textExtensionMap[path.extname(relativePath).toLowerCase()] ?? null

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"])

const getImageFileDescriptor = (relativePath: string) =>
  imageExtensions.has(path.extname(relativePath).toLowerCase()) ? { kind: "image" as const } : null

const resolveImageApiKey = () =>
  process.env.OPENAI_API_KEY?.trim() || process.env.CODEX_API_KEY?.trim() || null

const normalizeGeneratedImageFilename = (value: string | undefined) => {
  const fallback = `wireframe-${Date.now()}.png`
  if (!value) {
    return fallback
  }

  const ext = path.extname(value).toLowerCase()
  const base = slugify(path.basename(value, ext)) || "wireframe"
  const safeExt = ext === ".jpg" || ext === ".jpeg" || ext === ".webp" || ext === ".png" ? ext : ".png"
  return `${base}${safeExt}`
}

const getActiveOrFocusedPhase = (workflow: WorkflowState) =>
  workflow.phases.find((phase) => phase.id === workflow.activePhaseId) ??
  workflow.phases.find((phase) =>
    ["running", "review_ready", "changes_requested", "failed"].includes(phase.status)
  ) ??
  workflow.phases[0] ??
  null

const findPhase = (workflow: WorkflowState, phaseToken?: string | null) => {
  if (!phaseToken) {
    return getActiveOrFocusedPhase(workflow)
  }

  const normalized = phaseToken.trim().toLowerCase()

  return (
    workflow.phases.find((phase) => phase.id === normalized) ??
    workflow.phases.find((phase) => phase.name.toLowerCase() === normalized) ??
    workflow.phases.find((phase) => phase.name.toLowerCase().startsWith(normalized)) ??
    null
  )
}

const getPrimaryArtifactForPhase = (workflow: WorkflowState, phaseId: string) => {
  const typedPhaseId = phaseId as PhaseId
  const preferredSuffix = `/${phasePrimaryArtifacts[typedPhaseId] ?? "artifact.md"}`

  return (
    workflow.artifacts.find(
      (artifact) => artifact.phaseId === phaseId && artifact.path.endsWith(preferredSuffix)
    )?.path ??
    workflow.artifacts.find((artifact) => artifact.phaseId === phaseId)?.path ??
    getPhaseArtifactRelativePath(phaseId)
  )
}

const parseToolCommand = (input: string): { name: string; args: string[] } | null => {
  if (!input.startsWith("/")) {
    return null
  }

  const tokens = input
    .slice(1)
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (tokens.length === 0) {
    return null
  }

  return {
    name: tokens[0].toLowerCase(),
    args: tokens.slice(1)
  }
}

type ParsedHandoffDirective = {
  nextAgent: PhaseId
  reason?: string
}

type ParsedImageDirective = {
  prompt: string
  filename?: string
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto"
  quality?: "low" | "medium" | "high" | "auto"
}

const handoffDirectivePattern = /\[\[SDLC_HANDOFF\s+(\{[\s\S]*?\})\]\]/m
const imageDirectivePattern = /\[\[GENERATE_WIREFRAME_IMAGE\s+(\{[\s\S]*?\})\]\]/g

const parseHandoffDirective = (input: string): {
  cleanedText: string
  directive: ParsedHandoffDirective | null
} => {
  const match = input.match(handoffDirectivePattern)

  if (!match) {
    return {
      cleanedText: input,
      directive: null
    }
  }

  try {
    const parsed = JSON.parse(match[1]) as { nextAgent?: string; reason?: string }
    if (!parsed.nextAgent || !getPhaseDefinition(parsed.nextAgent)) {
      return {
        cleanedText: input.replace(match[0], "").trim(),
        directive: null
      }
    }

    return {
      cleanedText: input.replace(match[0], "").trim(),
      directive: {
        nextAgent: parsed.nextAgent as PhaseId,
        reason: typeof parsed.reason === "string" ? parsed.reason.trim() : undefined
      }
    }
  } catch {
    return {
      cleanedText: input.replace(match[0], "").trim(),
      directive: null
    }
  }
}

const affirmativeHandoffPattern =
  /^(?:yes|yep|yeah|sure|ok|okay|continue|proceed|go ahead|move ahead|move to next|next|start it|do it|switch)\b/i
const negativeHandoffPattern =
  /^(?:no|not yet|hold|wait|stop|don'?t|do not|needs changes|request changes|revise|change this|fix)\b/i

const isAffirmativeHandoffReply = (input: string) => affirmativeHandoffPattern.test(input.trim())

const isNegativeHandoffReply = (input: string) => negativeHandoffPattern.test(input.trim())

const markPhaseReadyForHandoff = (
  workflow: WorkflowState,
  fromPhaseId: PhaseId,
  toPhaseId: PhaseId,
  reason?: string
): WorkflowState => {
  const expectedNextPhaseId = getNextPhaseId(fromPhaseId)

  if (!expectedNextPhaseId || expectedNextPhaseId !== toPhaseId) {
    return workflow
  }

  const now = new Date().toISOString()

  return {
    ...workflow,
    activePhaseId: fromPhaseId,
    phases: workflow.phases.map((phase) =>
      phase.id === fromPhaseId
        ? {
            ...phase,
            status: "review_ready" as const,
            lastUpdatedAt: now
          }
        : phase
    ),
    pendingHandoff: {
      fromPhaseId,
      toPhaseId,
      reason,
      createdAt: now
    }
  }
}

const clearPendingHandoff = (workflow: WorkflowState): WorkflowState => ({
  ...workflow,
  pendingHandoff: null
})

const parseImageDirectives = (input: string): {
  cleanedText: string
  directives: ParsedImageDirective[]
} => {
  const matches = [...input.matchAll(imageDirectivePattern)]

  if (matches.length === 0) {
    return {
      cleanedText: input,
      directives: []
    }
  }

  const directives = matches.flatMap((match) => {
    try {
      const parsed = JSON.parse(match[1]) as {
        prompt?: string
        filename?: string
        size?: string
        quality?: string
      }

      if (!parsed.prompt?.trim()) {
        return []
      }

      return [
        {
          prompt: parsed.prompt.trim(),
          filename: typeof parsed.filename === "string" ? parsed.filename.trim() : undefined,
          size:
            parsed.size === "1024x1024" ||
            parsed.size === "1536x1024" ||
            parsed.size === "1024x1536" ||
            parsed.size === "auto"
              ? parsed.size
              : undefined,
          quality:
            parsed.quality === "low" ||
            parsed.quality === "medium" ||
            parsed.quality === "high" ||
            parsed.quality === "auto"
              ? parsed.quality
              : undefined
        } satisfies ParsedImageDirective
      ]
    } catch {
      return []
    }
  })

  return {
    cleanedText: input.replaceAll(imageDirectivePattern, "").trim(),
    directives
  }
}

const formatGeneratedImageSummary = (paths: string[]) => {
  if (paths.length === 1) {
    return `Generated wireframe image: ${paths[0]}.`
  }

  return [
    `Generated ${paths.length} wireframe images:`,
    ...paths.map((relativePath) => `- ${relativePath}`)
  ].join("\n")
}

const formatImageGenerationFailureSummary = (errors: string[]) => {
  if (errors.length === 1) {
    return `Wireframe image generation was requested but failed: ${errors[0]}.`
  }

  return [
    `Some wireframe images failed to generate (${errors.length}):`,
    ...errors.map((message) => `- ${message}`)
  ].join("\n")
}

const getProjectFromState = (state: StoreState, projectId: string) => {
  const project = state.projects.find((item) => item.id === projectId)

  if (!project) {
    throw new Error("Project not found")
  }

  return project
}

const getSessionFromState = (state: StoreState, projectId: string, sessionId: string) => {
  const session = state.sessions.find((item) => item.id === sessionId && item.projectId === projectId)

  if (!session) {
    throw new Error("Session not found")
  }

  return session
}

const getSessionsForProject = (state: StoreState, projectId: string) =>
  state.sessions
    .filter((session) => session.projectId === projectId && session.status !== "archived")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

const getDefaultSessionSeed = (project: ProjectRecord) => {
  if (project.workflowMode === "analyze_existing") {
    return {
      title: "Repository intake",
      kind: "analysis" as const,
      summary: "Read the imported workspace and propose the shortest useful flow.",
      preview: "Index the codebase, surface risks, and suggest the next meaningful phase."
    }
  }

  if (project.workflowMode === "scaffold_first") {
    return {
      title: "Scaffold kickoff",
      kind: "implementation" as const,
      summary: "Compress early planning and move quickly toward implementation structure.",
      preview: "Define the starter stack, routes, and folder structure before deeper phases."
    }
  }

  return {
    title: "Discovery",
    kind: "discovery" as const,
    summary: "Gather requirements, clarify scope, and prepare the first reviewable artifact.",
    preview: "Start Discovery by clarifying the problem, users, and must-have features."
  }
}

const getSessionKindForPhase = (phaseId: string | null | undefined): SessionKind => {
  switch (phaseId) {
    case "discovery":
      return "discovery"
    case "architecture":
      return "architecture"
    case "journey":
      return "journey"
    case "wireframe":
      return "wireframe"
    case "coder":
      return "implementation"
    case "testing":
      return "testing"
    case "devops":
      return "devops"
    case "handover":
      return "handover"
    default:
      return "general"
  }
}

const getSessionSeedForPhase = (
  project: ProjectRecord,
  phaseId: string | null | undefined
): {
  title: string
  kind: SessionKind
  summary: string
  preview: string
} | null => {
  const phase = getPhaseDefinition(phaseId)

  if (!phase) {
    return null
  }

  return {
    title: phase.name,
    kind: getSessionKindForPhase(phase.id),
    summary: phase.summary,
    preview:
      phase.id === "discovery"
        ? "Clarify requirements, trim scope, and produce a reviewable requirements document."
        : phase.id === "architecture"
          ? "Turn approved requirements into a concrete technical design and artifact set."
          : phase.id === "journey"
            ? "Map flows, users, and screens before visual design begins."
            : phase.id === "wireframe"
              ? "Define layouts, components, and UI planning artifacts."
              : phase.id === "coder"
                ? "Implement the documented plan and keep the artifact trail up to date."
                : phase.id === "testing"
                  ? "Create and run tests, then document coverage and failures."
                  : phase.id === "devops"
                    ? "Prepare deployment and operational readiness artifacts."
                    : "Package final documentation and handover materials."
  }
}

const createSessionRecord = (
  project: ProjectRecord,
  title: string,
  options?: {
    kind?: SessionKind
    summary?: string
    preview?: string
    status?: SessionStatus
    titleSource?: SessionTitleSource
  }
): SessionRecord => {
  const now = new Date().toISOString()
  const titleSource = options?.titleSource ?? "manual"

  return {
    id: randomUUID(),
    projectId: project.id,
    title,
    titleSource,
    kind: options?.kind ?? "general",
    status: options?.status ?? "active",
    summary:
      options?.summary ??
      (titleSource === "pending_first_message"
        ? "Start a focused thread. The first message will set the session title."
        : `Task-focused session for ${title.toLowerCase()}.`),
    preview:
      options?.preview ??
      (titleSource === "pending_first_message"
        ? "Send the first message to title this session automatically, then rename it anytime."
        : "Use this thread to revise artifacts, clarify scope, or explore implementation options."),
    selectedModel: null,
    selectedAgentId: "auto",
    codexConversationId: null,
    codexRolloutPath: null,
    createdAt: now,
    updatedAt: now
  }
}

const getEffectiveAgentPhaseId = (
  session: SessionRecord,
  workflow: WorkflowState
): PhaseId | null => {
  if (session.selectedAgentId === "workspace") {
    return null
  }

  if (session.selectedAgentId !== "auto") {
    const phaseDefinition = getPhaseDefinition(session.selectedAgentId)

    if (phaseDefinition) {
      return phaseDefinition.id
    }
  }

  const activePhase = getActiveOrFocusedPhase(workflow)
  return activePhase ? (activePhase.id as PhaseId) : null
}

const getSelectedAgentLabel = (session: SessionRecord, workflow: WorkflowState) => {
  if (session.selectedAgentId === "workspace") {
    return "Workspace"
  }

  if (session.selectedAgentId !== "auto") {
    return (
      getPhaseDefinition(session.selectedAgentId)?.name ??
      getSupplementalAgentDefinition(session.selectedAgentId)?.name ??
      "Assistant"
    )
  }

  return getPhaseDefinition(getEffectiveAgentPhaseId(session, workflow))?.name ?? "Assistant"
}

const buildPhaseSeedArtifact = (project: ProjectRecord, phase: WorkflowPhase) => `# ${phase.name} - ${project.name}

## Purpose
${phase.summary}

## Project Context
- Project type: ${projectTypeLabels[project.projectType]}
- Workflow mode: ${workflowModeLabels[project.workflowMode]}
- Workspace root: ${project.workspacePath}

## What This Artifact Will Hold
- Decisions that belong to ${phase.name}
- Notes that should remain reviewable outside chat
- Handoff context for the next phase

## Current Starting Point
This file was seeded automatically so the workspace has a real artifact surface before Codex execution is wired in.
`

const ensureSeedArtifactForActivePhase = async (project: ProjectRecord, workflow: WorkflowState) => {
  const phase = getActiveOrFocusedPhase(workflow)

  if (!phase) {
    return false
  }

  const relativePath = getPhaseArtifactRelativePath(phase.id)
  const absolutePath = fromWorkspaceRelativePath(project.workspacePath, relativePath)

  if (await pathExists(absolutePath)) {
    return false
  }

  await ensureDirectory(path.dirname(absolutePath))
  await fs.writeFile(absolutePath, buildPhaseSeedArtifact(project, phase), "utf8")
  return true
}

const listFilesRecursive = async (directoryPath: string): Promise<string[]> => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(absolutePath)))
      continue
    }

    if (entry.isFile()) {
      files.push(absolutePath)
    }
  }

  return files
}

const syncWorkflowArtifacts = async (project: ProjectRecord, workflow: WorkflowState) => {
  let changed = await ensureSeedArtifactForActivePhase(project, workflow)
  const existingArtifacts = new Map(workflow.artifacts.map((artifact) => [artifact.path, artifact]))
  const nextArtifacts: ArtifactRecord[] = []

  for (const phase of phaseDefinitions) {
    const folderName = workflowFolderNames[phase.id]
    const phaseDirectory = path.join(project.workflowPath, folderName)
    const filePaths = await listFilesRecursive(phaseDirectory)

    for (const absoluteFilePath of filePaths) {
      const relativePath = toWorkspaceRelativePath(project.workspacePath, absoluteFilePath)
      const existingArtifact = existingArtifacts.get(relativePath)
      const stats = await fs.stat(absoluteFilePath)

      nextArtifacts.push({
        id: existingArtifact?.id ?? randomUUID(),
        phaseId: phase.id,
        path: relativePath,
        kind: inferArtifactKind(relativePath),
        createdAt: existingArtifact?.createdAt ?? stats.birthtime.toISOString()
      })
    }
  }

  nextArtifacts.sort((left, right) => left.path.localeCompare(right.path))

  const hasChangedArtifacts =
    nextArtifacts.length !== workflow.artifacts.length ||
    nextArtifacts.some((artifact, index) => {
      const currentArtifact = workflow.artifacts[index]
      return (
        !currentArtifact ||
        artifact.path !== currentArtifact.path ||
        artifact.phaseId !== currentArtifact.phaseId ||
        artifact.kind !== currentArtifact.kind
      )
    })

  if (hasChangedArtifacts) {
    workflow.artifacts = nextArtifacts
    changed = true
  }

  return {
    workflow,
    changed
  }
}

const initializeWorkspace = async (project: ProjectRecord, workflowState: WorkflowState) => {
  await ensureDirectory(project.workspacePath)
  await ensureDirectory(project.workflowPath)

  for (const folderName of Object.values(workflowFolderNames)) {
    await ensureDirectory(path.join(project.workflowPath, folderName))
  }

  await writeJsonFile(path.join(project.workflowPath, "project-context.json"), {
    id: project.id,
    name: project.name,
    slug: project.slug,
    projectType: project.projectType,
    workflowMode: project.workflowMode,
    workspacePath: project.workspacePath,
    workflowPath: project.workflowPath,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  })

  if (project.projectType === "new_project") {
    await writeFileIfMissing(
      path.join(project.workspacePath, "README.md"),
      `# ${project.name}

This project workspace was created by Codex Buildathon.

## Workflow
- Project type: ${projectTypeLabels[project.projectType]}
- Mode: ${workflowModeLabels[project.workflowMode]}
- Workflow state: .project-workflow/workflow-state.json
- Artifacts: .project-workflow/
`
    )
  }

  const syncedWorkflow = await syncWorkflowArtifacts(project, workflowState)
  await writeWorkflowState(project.workflowPath, syncedWorkflow.workflow)
}

const resolveWorkspacePath = async (input: CreateProjectInput, slug: string) => {
  const trimmedWorkspacePath = input.workspacePath?.trim()

  if (input.projectType === "existing_codebase") {
    if (!trimmedWorkspacePath) {
      throw new Error("Importing an existing codebase requires a folder path")
    }

    const resolvedPath = path.resolve(trimmedWorkspacePath)
    await assertDirectory(resolvedPath)
    return resolvedPath
  }

  if (trimmedWorkspacePath) {
    return path.join(path.resolve(trimmedWorkspacePath), slug)
  }

  const defaultBasePath = getDefaultProjectsBasePath()
  await ensureDirectory(defaultBasePath)
  return path.join(defaultBasePath, slug)
}

const ensureProjectSessions = (state: StoreState, project: ProjectRecord) => {
  let nextState = state
  let changed = false
  let sessions = getSessionsForProject(nextState, project.id)

  if (sessions.length === 0) {
    const seed = getDefaultSessionSeed(project)
    const session = createSessionRecord(project, seed.title, {
      kind: seed.kind,
      status: "active",
      summary: seed.summary,
      preview: seed.preview,
      titleSource: "seeded"
    })

    nextState = {
      ...nextState,
      sessions: [session, ...nextState.sessions],
      activeSessionIdByProject: {
        ...nextState.activeSessionIdByProject,
        [project.id]: session.id
      }
    }
    sessions = [session]
    changed = true
  }

  const activeSessionId = nextState.activeSessionIdByProject[project.id]
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ??
    sessions.find((session) => session.status === "active") ??
    sessions[0]

  if (!activeSession) {
    throw new Error("Unable to resolve an active session")
  }

  if (activeSessionId !== activeSession.id) {
    nextState = {
      ...nextState,
      activeSessionIdByProject: {
        ...nextState.activeSessionIdByProject,
        [project.id]: activeSession.id
      }
    }
    changed = true
  }

  if (activeSession.status !== "active") {
    nextState = {
      ...nextState,
      sessions: nextState.sessions.map((session) =>
        session.id === activeSession.id ? { ...session, status: "active" } : session
      )
    }
    changed = true
  }

  return {
    state: nextState,
    sessions: getSessionsForProject(nextState, project.id),
    activeSession: {
      ...activeSession,
      status: "active" as const
    },
    changed
  }
}

const buildSeedMessages = (
  project: ProjectRecord,
  workflow: WorkflowState,
  session: SessionRecord
): SessionMessageRecord[] => {
  const now = new Date().toISOString()
  const activePhase = getActiveOrFocusedPhase(workflow)
  const effectiveAgentPhaseId = getEffectiveAgentPhaseId(session, workflow)
  const effectiveAgent = getPhaseDefinition(effectiveAgentPhaseId)
  const assistantLabel = getSelectedAgentLabel(session, workflow)
  const phaseArtifact = effectiveAgent ? phasePrimaryArtifacts[effectiveAgent.id] : null
  const kickoffBody =
    activePhase?.id === "discovery"
      ? project.projectType === "existing_codebase"
        ? "Inspect the existing workspace first, then turn that into a clear Discovery artifact."
        : "Start Discovery. Clarify the problem, the users, and the must-have scope before anything else."
      : activePhase?.id === "architecture"
        ? "Discovery is approved. Convert requirements into a concrete architecture and stack recommendation."
        : activePhase?.id === "journey"
          ? "Architecture is approved. Map user journeys, flows, and the full screen list."
          : activePhase?.id === "wireframe"
            ? "Journey is approved. Plan the UI layouts, structure, and component inventory."
            : activePhase?.id === "coder"
              ? "Wireframes are approved. Implement the documented product incrementally."
              : activePhase?.id === "testing"
                ? "Implementation is ready for validation. Create and run the right tests."
                : activePhase?.id === "devops"
                  ? "Testing is complete. Prepare deployment and operational readiness."
                  : activePhase?.id === "handover"
                    ? "The project is near delivery. Package handover documentation."
                    : project.workflowMode === "analyze_existing"
                      ? "Import this repo, inspect the existing structure, and tell me the shortest path to a delivery-ready handover."
                      : project.workflowMode === "scaffold_first"
                        ? "Start with a scaffold, keep the workflow trail intact, and move toward useful implementation structure quickly."
                        : "Set up a project workspace where artifacts, approvals, and handoffs stay visible from Discovery through Handover."

  return [
    {
      id: randomUUID(),
      sessionId: session.id,
      role: "system",
      label: "Workspace",
      body: `Attached to ${project.workspacePath}.`,
      chips: [],
      createdAt: now
    },
    {
      id: randomUUID(),
      sessionId: session.id,
      role: "user",
      label: "You",
      body: kickoffBody,
      chips: [],
      createdAt: now
    },
    {
      id: randomUUID(),
      sessionId: session.id,
      role: "assistant",
      label: assistantLabel,
      body: phaseArtifact
        ? `This session is anchored to ${effectiveAgent?.name ?? activePhase?.name}. Keep ${phaseArtifact} reviewable and tell the user when it is ready for approval from the SDLC panel.`
        : "I’ll keep this session aligned with the shared workspace and current workflow phase.",
      chips: [],
      createdAt: now
    }
  ]
}

const persistSessionTurn = async (input: {
  state: StoreState
  project: ProjectRecord
  session: SessionRecord
  workflow: WorkflowState
  userBody: string
  assistantBody: string
  assistantLabel?: string
}): Promise<SendSessionMessageResult> => {
  const now = new Date().toISOString()
  const activePhase = getActiveOrFocusedPhase(input.workflow)
  const userMessage: SessionMessageRecord = {
    id: randomUUID(),
    sessionId: input.session.id,
    role: "user",
    label: "You",
    body: input.userBody,
    chips: [],
    createdAt: now
  }

  const assistantMessage: SessionMessageRecord = {
    id: randomUUID(),
    sessionId: input.session.id,
    role: "assistant",
    label: input.assistantLabel ?? activePhase?.name ?? "Assistant",
    body: input.assistantBody,
    chips: [],
    createdAt: new Date(Date.now() + 1).toISOString()
  }

  const nextState = updateProjectTimestamp(
    {
      ...input.state,
      sessions: input.state.sessions.map((item) => {
        if (item.projectId !== input.project.id) {
          return item
        }

        if (item.id === input.session.id) {
          return {
            ...item,
            title:
              item.titleSource === "pending_first_message"
                ? deriveSessionTitleFromMessage(input.userBody)
                : item.title,
            titleSource:
              item.titleSource === "pending_first_message" ? "message" : item.titleSource,
            status: "active" as const,
            preview: input.assistantBody.slice(0, 160) || input.userBody.slice(0, 160),
            summary: activePhase ? `${activePhase.name} session` : "Project session",
            updatedAt: now
          }
        }

        return item.status === "active" ? { ...item, status: "idle" as const } : item
      }),
      sessionMessages: [...input.state.sessionMessages, userMessage, assistantMessage],
      activeSessionIdByProject: {
        ...input.state.activeSessionIdByProject,
        [input.project.id]: input.session.id
      }
    },
    input.project.id
  )

  await writeStoreState(nextState)

  return {
    dashboard: await buildDashboardData(nextState),
    messages: nextState.sessionMessages
      .filter((message) => message.sessionId === input.session.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }
}

const appendSessionTurnToState = (input: {
  state: StoreState
  project: ProjectRecord
  session: SessionRecord
  workflow: WorkflowState
  userBody: string
  assistantBody: string
  assistantLabel?: string
  userRole?: SessionMessageRole
  userLabel?: string
}): StoreState => {
  const now = new Date().toISOString()
  const activePhase = getActiveOrFocusedPhase(input.workflow)
  const userMessage: SessionMessageRecord = {
    id: randomUUID(),
    sessionId: input.session.id,
    role: input.userRole ?? "user",
    label: input.userLabel ?? "You",
    body: input.userBody,
    chips: [],
    createdAt: now
  }

  const assistantMessage: SessionMessageRecord = {
    id: randomUUID(),
    sessionId: input.session.id,
    role: "assistant",
    label: input.assistantLabel ?? activePhase?.name ?? "Assistant",
    body: input.assistantBody,
    chips: [],
    createdAt: new Date(Date.now() + 1).toISOString()
  }

  return updateProjectTimestamp(
    {
      ...input.state,
      sessions: input.state.sessions.map((item) => {
        if (item.projectId !== input.project.id) {
          return item
        }

        if (item.id === input.session.id) {
          return {
            ...item,
            codexConversationId:
              input.session.codexConversationId === undefined
                ? item.codexConversationId
                : input.session.codexConversationId,
            codexRolloutPath:
              input.session.codexRolloutPath === undefined
                ? item.codexRolloutPath
                : input.session.codexRolloutPath,
            selectedAgentId: input.session.selectedAgentId,
            selectedModel: input.session.selectedModel,
            status: "active" as const,
            preview: input.assistantBody.slice(0, 160) || input.userBody.slice(0, 160),
            summary: activePhase ? `${activePhase.name} session` : "Project session",
            updatedAt: now
          }
        }

        return item.status === "active" ? { ...item, status: "idle" as const } : item
      }),
      sessionMessages: [...input.state.sessionMessages, userMessage, assistantMessage],
      activeSessionIdByProject: {
        ...input.state.activeSessionIdByProject,
        [input.project.id]: input.session.id
      }
    },
    input.project.id
  )
}

const executeWorkflowTool = async (input: {
  state: StoreState
  project: ProjectRecord
  session: SessionRecord
  workflow: WorkflowState
  command: { name: string; args: string[] }
  rawBody: string
}): Promise<SendSessionMessageResult> => {
  const { project, session, command, rawBody } = input
  let workflow = input.workflow
  let uiAction: ToolUiAction = null
  let assistantBody = ""

  switch (command.name) {
    case "sdlc_start": {
      const now = new Date().toISOString()
      workflow.activePhaseId = "discovery"
      workflow.phases = workflow.phases.map((phase, index) => ({
        ...phase,
        status: index === 0 ? "running" : "not_started",
        lastUpdatedAt: now
      }))
      const synced = await syncWorkflowArtifacts(project, workflow)
      workflow = synced.workflow
      await writeWorkflowState(project.workflowPath, workflow)

      let nextState = input.state
      const phaseSessionState = ensureActivePhaseSession(nextState, project, workflow)
      nextState = phaseSessionState.state
      const nextSession =
        nextState.sessions.find((item) => item.id === phaseSessionState.activeSessionId) ?? session
      assistantBody =
        "SDLC workflow reset to Discovery. Review `.project-workflow/discovery/requirements.md` as the first artifact and continue in the Discovery session."
      const persisted = await persistSessionTurn({
        state: nextState,
        project,
        session: nextSession,
        workflow,
        userBody: rawBody,
        assistantBody,
        assistantLabel: "SDLC Tool"
      })

      return {
        ...persisted,
        uiAction: {
          type: "open_file",
          relativePath: getPrimaryArtifactForPhase(workflow, "discovery"),
          targetTab: "files"
        }
      }
    }

    case "phase_approve": {
      const phase = findPhase(workflow, command.args[0])
      if (!phase) {
        throw new Error("Phase not found")
      }
      const dashboard = await updatePhaseStatus(project.id, phase.id, "approved")
      const refreshedState = await readStoreState()
      const refreshedProject = getProjectFromState(refreshedState, project.id)
      const refreshedWorkflow = await readWorkflowState(refreshedProject.workflowPath)
      const refreshedSession =
        refreshedState.sessions.find(
          (item) =>
            item.id === refreshedState.activeSessionIdByProject[project.id] &&
            item.projectId === project.id
        ) ?? session

      const persisted = await persistSessionTurn({
        state: refreshedState,
        project: refreshedProject,
        session: refreshedSession,
        workflow: refreshedWorkflow,
        userBody: rawBody,
        assistantBody: `${phase.name} approved. ${
          findPhase(refreshedWorkflow, refreshedWorkflow.activePhaseId)?.name ?? "Next phase"
        } is now active.`,
        assistantLabel: "SDLC Tool"
      })

      return {
        ...persisted,
        dashboard
      }
    }

    case "phase_request_changes": {
      const phase = findPhase(workflow, command.args[0])
      if (!phase) {
        throw new Error("Phase not found")
      }

      const dashboard = await updatePhaseStatus(project.id, phase.id, "changes_requested")
      const refreshedState = await readStoreState()
      const refreshedWorkflow = await readWorkflowState(project.workflowPath)
      const refreshedSession =
        refreshedState.sessions.find(
          (item) =>
            item.id === refreshedState.activeSessionIdByProject[project.id] &&
            item.projectId === project.id
        ) ?? session

      const persisted = await persistSessionTurn({
        state: refreshedState,
        project,
        session: refreshedSession,
        workflow: refreshedWorkflow,
        userBody: rawBody,
        assistantBody: `${phase.name} marked as changes requested. Keep working in this phase until the artifact is ready again.`,
        assistantLabel: "SDLC Tool"
      })

      return {
        ...persisted,
        dashboard
      }
    }

    case "phase_exit_to_next": {
      const phase = findPhase(workflow, command.args[0])
      if (!phase) {
        throw new Error("Phase not found")
      }

      const dashboard = await updatePhaseStatus(project.id, phase.id, "review_ready")
      const refreshedState = await readStoreState()
      const refreshedWorkflow = await readWorkflowState(project.workflowPath)
      const persisted = await persistSessionTurn({
        state: refreshedState,
        project,
        session,
        workflow: refreshedWorkflow,
        userBody: rawBody,
        assistantBody: `${phase.name} is now marked review ready. Open ${getPrimaryArtifactForPhase(
          refreshedWorkflow,
          phase.id
        )} and approve or request changes from the SDLC panel.`,
        assistantLabel: "SDLC Tool"
      })

      return {
        ...persisted,
        dashboard,
        uiAction: {
          type: "open_file",
          relativePath: getPrimaryArtifactForPhase(refreshedWorkflow, phase.id),
          targetTab: "files"
        }
      }
    }

    case "artifact_list": {
      const phase = findPhase(workflow, command.args[0])
      const artifacts = phase
        ? workflow.artifacts.filter((artifact) => artifact.phaseId === phase.id)
        : workflow.artifacts

      assistantBody =
        artifacts.length > 0
          ? `Artifacts${phase ? ` for ${phase.name}` : ""}:\n${artifacts
              .map((artifact) => `- ${artifact.path}`)
              .join("\n")}`
          : `No artifacts found${phase ? ` for ${phase.name}` : ""}.`

      return persistSessionTurn({
        state: input.state,
        project,
        session,
        workflow,
        userBody: rawBody,
        assistantBody,
        assistantLabel: "SDLC Tool"
      })
    }

    case "artifact_open": {
      const token = command.args.join(" ").trim()
      if (!token) {
        throw new Error("Provide a phase name or relative artifact path")
      }

      const phase = findPhase(workflow, token)
      const relativePath = phase
        ? getPrimaryArtifactForPhase(workflow, phase.id)
        : token.replace(/^\/+/, "")

      const file = await readWorkspaceFile(project.id, relativePath)
      if (file.kind === "not_found") {
        throw new Error(`Artifact not found: ${relativePath}`)
      }

      assistantBody = `Opened ${relativePath}. Use the Files tab to inspect it in the workspace.`
      const persisted = await persistSessionTurn({
        state: input.state,
        project,
        session,
        workflow,
        userBody: rawBody,
        assistantBody,
        assistantLabel: "SDLC Tool"
      })

      return {
        ...persisted,
        uiAction: {
          type: "open_file",
          relativePath,
          targetTab: "files"
        }
      }
    }

    default:
      throw new Error(
        "Unknown tool. Available commands: /sdlc_start, /phase_approve, /phase_request_changes, /phase_exit_to_next, /artifact_list, /artifact_open"
      )
  }
}

const ensureActivePhaseSession = (
  state: StoreState,
  project: ProjectRecord,
  workflow: WorkflowState,
  options?: {
    selectedModel?: string | null
  }
): {
  state: StoreState
  activeSessionId: string | null
  changed: boolean
} => {
  const activePhase = getActiveOrFocusedPhase(workflow)

  if (!activePhase) {
    return {
      state,
      activeSessionId: state.activeSessionIdByProject[project.id] ?? null,
      changed: false
    }
  }

  const phaseSeed = getSessionSeedForPhase(project, activePhase.id)
  if (!phaseSeed) {
    return {
      state,
      activeSessionId: state.activeSessionIdByProject[project.id] ?? null,
      changed: false
    }
  }

  const projectSessions = getSessionsForProject(state, project.id)
  const existingPhaseSession = projectSessions.find(
    (session) =>
      session.kind === phaseSeed.kind &&
      session.title.trim().toLowerCase() === phaseSeed.title.trim().toLowerCase()
  )

  if (existingPhaseSession) {
    const nextState = {
      ...state,
      sessions: state.sessions.map((session) => {
        if (session.projectId !== project.id) {
          return session
        }

        if (session.id === existingPhaseSession.id) {
          return {
            ...session,
            status: "active" as const,
            title: phaseSeed.title,
            titleSource: "seeded" as const,
            summary: phaseSeed.summary,
            preview: phaseSeed.preview,
            selectedAgentId: activePhase.id,
            selectedModel:
              options?.selectedModel === undefined ? session.selectedModel : options.selectedModel,
            codexConversationId:
              options?.selectedModel === undefined ? session.codexConversationId : null,
            codexRolloutPath:
              options?.selectedModel === undefined ? session.codexRolloutPath : null,
            updatedAt: new Date().toISOString()
          }
        }

        return session.status === "active" ? { ...session, status: "idle" as const } : session
      }),
      activeSessionIdByProject: {
        ...state.activeSessionIdByProject,
        [project.id]: existingPhaseSession.id
      }
    }

    return {
      state: nextState,
      activeSessionId: existingPhaseSession.id,
      changed: true
    }
  }

  const created = createSessionRecord(project, phaseSeed.title, {
    kind: phaseSeed.kind,
    status: "active",
    summary: phaseSeed.summary,
    preview: phaseSeed.preview,
    titleSource: "seeded"
  })
  created.selectedAgentId = activePhase.id
  created.selectedModel = options?.selectedModel ?? created.selectedModel

  return {
    state: {
      ...state,
      sessions: [created, ...state.sessions].map((session) =>
        session.projectId === project.id && session.id !== created.id && session.status === "active"
          ? { ...session, status: "idle" as const }
          : session
      ),
      activeSessionIdByProject: {
        ...state.activeSessionIdByProject,
        [project.id]: created.id
      }
    },
    activeSessionId: created.id,
    changed: true
  }
}

const ensureSessionMessages = (
  state: StoreState,
  project: ProjectRecord,
  workflow: WorkflowState,
  session: SessionRecord
) => {
  const existingMessages = state.sessionMessages
    .filter((message) => message.sessionId === session.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  if (existingMessages.length > 0) {
    return {
      state,
      messages: existingMessages,
      changed: false
    }
  }

  const seededMessages = buildSeedMessages(project, workflow, session)

  return {
    state: {
      ...state,
      sessionMessages: [...state.sessionMessages, ...seededMessages]
    },
    messages: seededMessages,
    changed: true
  }
}

const buildAutomaticPhaseKickoff = (input: {
  currentPhase: PhaseDefinition
  nextPhase: PhaseDefinition
  workflow: WorkflowState
  reason?: string
}) => {
  const currentArtifactPath = getPrimaryArtifactForPhase(input.workflow, input.currentPhase.id)
  const reasonLine = input.reason ? ` Reason: ${input.reason}.` : ""

  return `${input.currentPhase.name} phase completed.${reasonLine} The primary handoff artifact is at ${currentArtifactPath}. Begin the ${input.nextPhase.name} phase now and continue from those deliverables.`
}

const runAutomaticPhaseHandoff = async (input: {
  state: StoreState
  project: ProjectRecord
  session: SessionRecord
  workflow: WorkflowState
  userBody: string
  assistantBody: string
  assistantLabel: string
  directive: ParsedHandoffDirective
  selectedModel: string | null
}): Promise<SendSessionMessageResult> => {
  const currentPhase = getEffectiveAgentPhaseId(input.session, input.workflow)
    ? getPhaseDefinition(getEffectiveAgentPhaseId(input.session, input.workflow))
    : null

  if (!currentPhase) {
    throw new Error("Automatic handoff is only supported from phase agents")
  }

  const expectedNextPhaseId = getNextPhaseId(currentPhase.id)
  if (!expectedNextPhaseId || input.directive.nextAgent !== expectedNextPhaseId) {
    throw new Error(
      `Invalid handoff target. ${currentPhase.name} can only hand off to ${getPhaseDefinition(expectedNextPhaseId)?.name ?? "the next phase"}.`
    )
  }

  const nextPhase = getPhaseDefinition(input.directive.nextAgent)
  if (!nextPhase) {
    throw new Error("Next phase not found")
  }

  let nextState = appendSessionTurnToState({
    state: input.state,
    project: input.project,
    session: input.session,
    workflow: input.workflow,
    userBody: input.userBody,
    assistantBody:
      input.assistantBody ||
      `${currentPhase.name} complete. Handing off automatically to ${nextPhase.name}.`,
    assistantLabel: input.assistantLabel
  })

  const now = new Date().toISOString()
  const transitionedWorkflow: WorkflowState = {
    ...input.workflow,
    activePhaseId: nextPhase.id,
    phases: input.workflow.phases.map((phase) => {
      if (phase.id === currentPhase.id) {
        return {
          ...phase,
          status: "approved" as const,
          lastUpdatedAt: now
        }
      }

      if (phase.id === nextPhase.id) {
        return {
          ...phase,
          status: "running" as const,
          lastUpdatedAt: now
        }
      }

      return phase
    }),
    pendingHandoff: null
  }

  const syncedWorkflow = await syncWorkflowArtifacts(input.project, transitionedWorkflow)
  await writeWorkflowState(input.project.workflowPath, syncedWorkflow.workflow)

  const phaseSessionState = ensureActivePhaseSession(nextState, input.project, syncedWorkflow.workflow, {
    selectedModel: input.selectedModel
  })
  nextState = phaseSessionState.state
  const nextSession =
    nextState.sessions.find((item) => item.id === phaseSessionState.activeSessionId) ?? input.session

  const nextSessionMessages = ensureSessionMessages(
    nextState,
    input.project,
    syncedWorkflow.workflow,
    nextSession
  )
  nextState = nextSessionMessages.state

  emitCodexUiEvent({
    projectId: input.project.id,
    sessionId: nextSession.id,
    type: "handoff_started",
    phaseId: nextPhase.id,
    session: {
      id: nextSession.id,
      projectId: nextSession.projectId,
      title: nextSession.title,
      titleSource: nextSession.titleSource,
      kind: nextSession.kind,
      status: "active",
      summary: nextSession.summary,
      preview: nextSession.preview,
      selectedModel: input.selectedModel,
      selectedAgentId: nextPhase.id,
      createdAt: nextSession.createdAt,
      updatedAt: new Date().toISOString()
    }
  })

  const kickoffBody = buildAutomaticPhaseKickoff({
    currentPhase,
    nextPhase,
    workflow: syncedWorkflow.workflow,
    reason: input.directive.reason
  })

  const nextCodexResult = await sendCodexSessionMessage({
    projectId: input.project.id,
    sessionId: nextSession.id,
    body: kickoffBody,
    cwd: input.project.workspacePath,
    projectName: input.project.name,
    projectType: input.project.projectType,
    workflowMode: input.project.workflowMode,
    activePhaseId: nextPhase.id,
    activePhaseName: nextPhase.name,
    effectiveAgentPhaseId: nextPhase.id,
    effectiveAgentName: nextPhase.name,
    selectedAgentId: nextPhase.id,
    selectedModel: input.selectedModel,
    activeArtifactPath: getPhaseArtifactRelativePath(nextPhase.id),
    conversationId: nextSession.codexConversationId ?? null,
    rolloutPath: nextSession.codexRolloutPath ?? null
  })

  nextState = appendSessionTurnToState({
    state: nextState,
    project: input.project,
    session: {
      ...nextSession,
      codexConversationId: nextCodexResult.conversationId,
      codexRolloutPath: nextCodexResult.rolloutPath,
      selectedAgentId: nextPhase.id,
      selectedModel: input.selectedModel
    },
    workflow: syncedWorkflow.workflow,
    userBody: kickoffBody,
    userRole: "system",
    userLabel: "Workflow",
    assistantBody: nextCodexResult.assistantText,
    assistantLabel: nextPhase.name
  })

  await writeStoreState(nextState)

  return {
    dashboard: await buildDashboardData(nextState),
    messages: nextState.sessionMessages
      .filter((message) => message.sessionId === nextSession.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    uiAction: {
      type: "open_file",
      relativePath: getPrimaryArtifactForPhase(syncedWorkflow.workflow, nextPhase.id),
      targetTab: "files"
    }
  }
}

const generateWorkspaceImage = async (input: {
  project: ProjectRecord
  directive: ParsedImageDirective
}): Promise<string> => {
  const apiKey = resolveImageApiKey()

  if (!apiKey) {
    throw new Error("Set OPENAI_API_KEY or CODEX_API_KEY to enable wireframe image generation")
  }

  const outputFilename = normalizeGeneratedImageFilename(input.directive.filename)
  const outputFormat = path.extname(outputFilename).toLowerCase().replace(/^\./, "") || "png"
  const relativePath = `.project-workflow/wireframes/${outputFilename}`
  const absolutePath = fromWorkspaceRelativePath(input.project.workspacePath, relativePath)

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt: input.directive.prompt,
      size: input.directive.size ?? "1536x1024",
      quality: input.directive.quality ?? "medium",
      output_format: outputFormat
    })
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `Image generation failed with status ${response.status}`)
  }

  const payload = (await response.json()) as {
    data?: Array<{
      b64_json?: string
    }>
  }

  const base64Image = payload.data?.[0]?.b64_json
  if (!base64Image) {
    throw new Error("Image generation returned no image data")
  }

  await ensureDirectory(path.dirname(absolutePath))
  await fs.writeFile(absolutePath, Buffer.from(base64Image, "base64"))
  return relativePath
}

const updateProjectTimestamp = (state: StoreState, projectId: string) => {
  const updatedAt = new Date().toISOString()

  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === projectId ? { ...project, updatedAt } : project
    ),
    activeProjectId: projectId
  }
}

const buildDashboardData = async (state: StoreState): Promise<DashboardData> => {
  const activeProject = state.activeProjectId
    ? state.projects.find((project) => project.id === state.activeProjectId) ?? null
    : state.projects[0] ?? null

  if (!activeProject) {
    return {
      projects: state.projects,
      activeProject: null,
      workflow: null,
      sessions: [],
      activeSession: null,
      allSessions: state.sessions.filter((session) => session.status !== "archived")
    }
  }

  const ensuredSessions = ensureProjectSessions(state, activeProject)
  let nextState = ensuredSessions.state
  let workflow = await readWorkflowState(activeProject.workflowPath)
  const syncedWorkflow = await syncWorkflowArtifacts(activeProject, workflow)

  workflow = syncedWorkflow.workflow

  if (ensuredSessions.changed) {
    await writeStoreState(nextState)
  }

  if (syncedWorkflow.changed) {
    await writeWorkflowState(activeProject.workflowPath, workflow)
  }

  return {
    projects: nextState.projects,
    activeProject,
    workflow,
    sessions: ensuredSessions.sessions,
    activeSession: ensuredSessions.activeSession,
    allSessions: nextState.sessions.filter((session) => session.status !== "archived")
  }
}

const listEntriesInDirectory = async (
  workspacePath: string,
  directoryPath: string,
  currentRelativePath: string,
  allowedPaths?: Set<string>
): Promise<WorkspaceEntry[]> => {
  const directoryEntries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])

  const sortedEntries = [...directoryEntries].sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })

  const results: WorkspaceEntry[] = []

  for (const entry of sortedEntries) {
    const relativePath = currentRelativePath ? `${currentRelativePath}/${entry.name}` : entry.name
    const isWorkflowRoot = relativePath === ".project-workflow"

    if (!isWorkflowRoot && ignoredWorkspaceEntries.has(entry.name)) {
      continue
    }

    if (allowedPaths) {
      const hasAllowedDescendant = [...allowedPaths].some(
        (allowedPath) =>
          allowedPath === relativePath || allowedPath.startsWith(`${relativePath}/`)
      )

      if (!hasAllowedDescendant) {
        continue
      }
    }

    const absolutePath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      const children = await listEntriesInDirectory(
        workspacePath,
        absolutePath,
        relativePath,
        allowedPaths
      )

      results.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children
      })
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    results.push({
      name: entry.name,
      path: relativePath,
      type: "file",
      kind: inferWorkspaceEntryKind(relativePath)
    })
  }

  return results
}

const getChangedWorkspacePaths = async (project: ProjectRecord, workflow: WorkflowState) => {
  const allowedPaths = new Set<string>(workflow.artifacts.map((artifact) => artifact.path))
  const activePhase = getActiveOrFocusedPhase(workflow)

  if (!activePhase) {
    return allowedPaths
  }

  const phaseDirectory = fromWorkspaceRelativePath(
    project.workspacePath,
    getPhaseFolderRelativePath(activePhase.id)
  )
  const phaseFiles = await listFilesRecursive(phaseDirectory)

  for (const filePath of phaseFiles) {
    allowedPaths.add(toWorkspaceRelativePath(project.workspacePath, filePath))
  }

  const primaryArtifactPath = getPhaseArtifactRelativePath(activePhase.id)
  const absolutePrimaryArtifactPath = fromWorkspaceRelativePath(project.workspacePath, primaryArtifactPath)

  if (await pathExists(absolutePrimaryArtifactPath)) {
    allowedPaths.add(primaryArtifactPath)
  }

  return allowedPaths
}

const initializeMessageAwareState = async (
  state: StoreState,
  project: ProjectRecord,
  workflow: WorkflowState,
  session: SessionRecord
) => {
  const ensuredMessages = ensureSessionMessages(state, project, workflow, session)

  if (ensuredMessages.changed) {
    await writeStoreState(ensuredMessages.state)
  }

  return ensuredMessages
}

export const createProject = async (input: CreateProjectInput): Promise<DashboardData> => {
  const name = input.name.trim()

  if (!name) {
    throw new Error("Project name is required")
  }

  const slug = slugify(name)

  if (!slug) {
    throw new Error("Project name must include letters or numbers")
  }

  const state = await readStoreState()
  const workspacePath = await resolveWorkspacePath(input, slug)
  const workflowPath = path.join(workspacePath, ".project-workflow")
  const now = new Date().toISOString()
  const projectId = randomUUID()

  const duplicateProject = state.projects.find(
    (project) => project.workspacePath === workspacePath || project.slug === slug
  )

  if (duplicateProject) {
    throw new Error("A project with this name or workspace already exists")
  }

  await ensureDirectory(workspacePath)

  const project: ProjectRecord = {
    id: projectId,
    name,
    slug,
    projectType: input.projectType,
    workflowMode: input.workflowMode,
    workspacePath,
    workflowPath,
    createdAt: now,
    updatedAt: now
  }

  const workflow = buildInitialWorkflowState(projectId)
  await initializeWorkspace(project, workflow)

  const sessionSeed = getDefaultSessionSeed(project)
  const initialSession = createSessionRecord(project, sessionSeed.title, {
    kind: sessionSeed.kind,
    status: "active",
    summary: sessionSeed.summary,
    preview: sessionSeed.preview,
    titleSource: "seeded"
  })

  const nextState: StoreState = {
    projects: [project, ...state.projects],
    sessions: [initialSession, ...state.sessions],
    sessionMessages: state.sessionMessages,
    activeProjectId: projectId,
    activeSessionIdByProject: {
      ...state.activeSessionIdByProject,
      [projectId]: initialSession.id
    }
  }

  await writeStoreState(nextState)

  return buildDashboardData(nextState)
}

export const getDashboardData = async (): Promise<DashboardData> => {
  const state = await readStoreState()
  return buildDashboardData(state)
}

export const selectProject = async (projectId: string): Promise<DashboardData> => {
  const state = await readStoreState()
  getProjectFromState(state, projectId)
  const nextState = updateProjectTimestamp(
    {
      ...state,
      activeProjectId: projectId
    },
    projectId
  )

  await writeStoreState(nextState)
  return buildDashboardData(nextState)
}

export const createSession = async (projectId: string, title?: string): Promise<DashboardData> => {
  const trimmedTitle = title?.trim() ?? ""
  const state = await readStoreState()
  const project = getProjectFromState(state, projectId)
  const workflow = await readWorkflowState(project.workflowPath)
  const activePhase = getActiveOrFocusedPhase(workflow)
  const phaseSeed = getSessionSeedForPhase(project, activePhase?.id)
  const session = createSessionRecord(project, trimmedTitle || pendingSessionTitle, {
    status: "active",
    kind: phaseSeed?.kind ?? "general",
    summary:
      trimmedTitle || !phaseSeed
        ? phaseSeed?.summary
        : "Start a focused thread. The first message will set the session title.",
    preview:
      trimmedTitle || !phaseSeed
        ? phaseSeed?.preview
        : "Send the first message to title this session automatically, then rename it anytime.",
    titleSource: trimmedTitle ? "manual" : "pending_first_message"
  })

  const nextState = updateProjectTimestamp(
    {
      ...state,
      sessions: [session, ...state.sessions].map((item) =>
        item.projectId === projectId && item.id !== session.id && item.status === "active"
          ? { ...item, status: "idle" as const }
          : item
      ),
      activeSessionIdByProject: {
        ...state.activeSessionIdByProject,
        [projectId]: session.id
      }
    },
    projectId
  )

  await writeStoreState(nextState)
  return buildDashboardData(nextState)
}

export const selectSession = async (
  projectId: string,
  sessionId: string
): Promise<DashboardData> => {
  const state = await readStoreState()
  getProjectFromState(state, projectId)
  getSessionFromState(state, projectId, sessionId)
  const now = new Date().toISOString()

  const nextState = updateProjectTimestamp(
    {
      ...state,
      sessions: state.sessions.map((item) => {
        if (item.projectId !== projectId) {
          return item
        }

        if (item.id === sessionId) {
          return {
            ...item,
            status: "active" as const,
            updatedAt: now
          }
        }

        return item.status === "active" ? { ...item, status: "idle" as const } : item
      }),
      activeSessionIdByProject: {
        ...state.activeSessionIdByProject,
        [projectId]: sessionId
      }
    },
    projectId
  )

  await writeStoreState(nextState)
  return buildDashboardData(nextState)
}

export const renameProject = async (
  projectId: string,
  name: string
): Promise<DashboardData> => {
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error("Project name is required")
  }

  const state = await readStoreState()
  getProjectFromState(state, projectId)
  const updatedAt = new Date().toISOString()

  const nextState: StoreState = {
    ...state,
    projects: state.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            name: trimmedName,
            updatedAt
          }
        : project
    ),
    activeProjectId: projectId
  }

  await writeStoreState(nextState)
  return buildDashboardData(nextState)
}

export const renameSession = async (
  projectId: string,
  sessionId: string,
  title: string
): Promise<DashboardData> => {
  const trimmedTitle = title.trim()

  if (!trimmedTitle) {
    throw new Error("Session title is required")
  }

  const state = await readStoreState()
  getProjectFromState(state, projectId)
  getSessionFromState(state, projectId, sessionId)
  const now = new Date().toISOString()

  const nextState = updateProjectTimestamp(
    {
      ...state,
      sessions: state.sessions.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              title: trimmedTitle,
              titleSource: "manual" as const,
              updatedAt: now
            }
          : item
      )
    },
    projectId
  )

  await writeStoreState(nextState)
  return buildDashboardData(nextState)
}

export const updateSessionPreferences = async (
  projectId: string,
  sessionId: string,
  input: {
    selectedModel?: string | null
    selectedAgentId?: SessionAgentId
  }
): Promise<DashboardData> => {
  const state = await readStoreState()
  getProjectFromState(state, projectId)
  const session = getSessionFromState(state, projectId, sessionId)
  const now = new Date().toISOString()

  const nextSelectedModel =
    input.selectedModel === undefined ? session.selectedModel : input.selectedModel?.trim() || null
  const nextSelectedAgentId =
    input.selectedAgentId === undefined ? session.selectedAgentId : input.selectedAgentId

  if (!isSessionAgentId(nextSelectedAgentId)) {
    throw new Error("Unsupported session agent")
  }

  const shouldResetConversation =
    nextSelectedModel !== session.selectedModel || nextSelectedAgentId !== session.selectedAgentId

  const nextState = updateProjectTimestamp(
    {
      ...state,
      sessions: state.sessions.map((item) =>
        item.id === sessionId && item.projectId === projectId
          ? {
              ...item,
              selectedModel: nextSelectedModel,
              selectedAgentId: nextSelectedAgentId,
              codexConversationId: shouldResetConversation ? null : item.codexConversationId,
              codexRolloutPath: shouldResetConversation ? null : item.codexRolloutPath,
              updatedAt: now
            }
          : item
      )
    },
    projectId
  )

  await writeStoreState(nextState)
  return buildDashboardData(nextState)
}

export const archiveSession = async (
  projectId: string,
  sessionId: string
): Promise<DashboardData> => {
  const state = await readStoreState()
  getProjectFromState(state, projectId)
  getSessionFromState(state, projectId, sessionId)

  const nextState = updateProjectTimestamp(
    {
      ...state,
      sessions: state.sessions.map((item) =>
        item.id === sessionId
          ? {
              ...item,
              status: "archived" as const,
              updatedAt: new Date().toISOString()
            }
          : item
      ),
      activeSessionIdByProject:
        state.activeSessionIdByProject[projectId] === sessionId
          ? Object.fromEntries(
              Object.entries(state.activeSessionIdByProject).filter(([key]) => key !== projectId)
            )
          : state.activeSessionIdByProject
    },
    projectId
  )

  await writeStoreState(nextState)
  return buildDashboardData(nextState)
}

export const deleteSession = async (
  projectId: string,
  sessionId: string
): Promise<DashboardData> => {
  const state = await readStoreState()
  getProjectFromState(state, projectId)
  getSessionFromState(state, projectId, sessionId)

  const nextState = updateProjectTimestamp(
    {
      ...state,
      sessions: state.sessions.filter((item) => item.id !== sessionId),
      sessionMessages: state.sessionMessages.filter((message) => message.sessionId !== sessionId),
      activeSessionIdByProject:
        state.activeSessionIdByProject[projectId] === sessionId
          ? Object.fromEntries(
              Object.entries(state.activeSessionIdByProject).filter(([key]) => key !== projectId)
            )
          : state.activeSessionIdByProject
    },
    projectId
  )

  await writeStoreState(nextState)
  return buildDashboardData(nextState)
}

export const updatePhaseStatus = async (
  projectId: string,
  phaseId: string,
  status: Exclude<PhaseStatus, "not_started">
): Promise<DashboardData> => {
  const state = await readStoreState()
  const project = getProjectFromState(state, projectId)
  const workflow = await readWorkflowState(project.workflowPath)
  const phaseIndex = workflow.phases.findIndex((phase) => phase.id === phaseId)

  if (phaseIndex === -1) {
    throw new Error("Phase not found")
  }

  const nextPhase = workflow.phases[phaseIndex + 1] ?? null
  const now = new Date().toISOString()

  workflow.phases = workflow.phases.map((phase, index) =>
    index === phaseIndex
      ? {
          ...phase,
          status,
          lastUpdatedAt: now
        }
      : phase
  )
  workflow.pendingHandoff = null

  if (status === "approved") {
    workflow.activePhaseId = nextPhase?.id ?? null

    if (nextPhase && nextPhase.status === "not_started") {
      workflow.phases = workflow.phases.map((phase, index) =>
        index === phaseIndex + 1
          ? {
              ...phase,
              status: "running",
              lastUpdatedAt: now
            }
          : phase
      )
    }
  } else {
    workflow.activePhaseId = phaseId
  }

  const syncedWorkflow = await syncWorkflowArtifacts(project, workflow)
  await writeWorkflowState(project.workflowPath, syncedWorkflow.workflow)

  let nextState: StoreState = updateProjectTimestamp(state, projectId)

  if (status === "approved") {
    const phaseSessionState = ensureActivePhaseSession(nextState, project, syncedWorkflow.workflow)
    nextState = phaseSessionState.state
  }

  await writeStoreState(nextState)

  return buildDashboardData(nextState)
}

export const getSessionMessages = async (
  projectId: string,
  sessionId: string
): Promise<SessionMessageRecord[]> => {
  const state = await readStoreState()
  const project = getProjectFromState(state, projectId)
  const session = getSessionFromState(state, projectId, sessionId)
  const workflow = await readWorkflowState(project.workflowPath)
  const syncedWorkflow = await syncWorkflowArtifacts(project, workflow)

  if (syncedWorkflow.changed) {
    await writeWorkflowState(project.workflowPath, syncedWorkflow.workflow)
  }

  const ensuredMessages = await initializeMessageAwareState(
    state,
    project,
    syncedWorkflow.workflow,
    session
  )

  return ensuredMessages.messages
}

export const sendSessionMessage = async (
  projectId: string,
  sessionId: string,
  body: string
): Promise<SendSessionMessageResult> => {
  const trimmedBody = body.trim()

  if (!trimmedBody) {
    throw new Error("Message body is required")
  }

  const state = await readStoreState()
  const project = getProjectFromState(state, projectId)
  const session = getSessionFromState(state, projectId, sessionId)
  const workflow = await readWorkflowState(project.workflowPath)
  const syncedWorkflow = await syncWorkflowArtifacts(project, workflow)

  if (syncedWorkflow.changed) {
    await writeWorkflowState(project.workflowPath, syncedWorkflow.workflow)
  }

  const ensuredMessages = await initializeMessageAwareState(
    state,
    project,
    syncedWorkflow.workflow,
    session
  )
  const toolCommand = parseToolCommand(trimmedBody)

  if (toolCommand) {
    return executeWorkflowTool({
      state: ensuredMessages.state,
      project,
      session,
      workflow: syncedWorkflow.workflow,
      command: toolCommand,
      rawBody: trimmedBody
    })
  }

  if (
    syncedWorkflow.workflow.pendingHandoff &&
    isAffirmativeHandoffReply(trimmedBody) &&
    session.projectId === projectId
  ) {
    const pendingHandoff = syncedWorkflow.workflow.pendingHandoff

    return runAutomaticPhaseHandoff({
      state: ensuredMessages.state,
      project,
      session,
      workflow: syncedWorkflow.workflow,
      userBody: trimmedBody,
      assistantBody: `Proceeding to ${getPhaseDefinition(pendingHandoff.toPhaseId)?.name ?? "the next phase"}.`,
      assistantLabel: "Workflow",
      directive: {
        nextAgent: pendingHandoff.toPhaseId,
        reason: pendingHandoff.reason
      },
      selectedModel: session.selectedModel
    })
  }

  let workflowForTurn = syncedWorkflow.workflow

  if (workflowForTurn.pendingHandoff && isNegativeHandoffReply(trimmedBody)) {
    const now = new Date().toISOString()
    workflowForTurn = {
      ...clearPendingHandoff(workflowForTurn),
      activePhaseId: workflowForTurn.pendingHandoff.fromPhaseId,
      phases: workflowForTurn.phases.map((phase) =>
        phase.id === workflowForTurn.pendingHandoff?.fromPhaseId
          ? {
              ...phase,
              status: "changes_requested" as const,
              lastUpdatedAt: now
            }
          : phase
      )
    }
    await writeWorkflowState(project.workflowPath, workflowForTurn)
  }

  const activePhase = getActiveOrFocusedPhase(workflowForTurn)
  const effectiveAgentPhaseId = getEffectiveAgentPhaseId(session, workflowForTurn)
  const selectedAgentLabel = getSelectedAgentLabel(session, workflowForTurn)
  const now = new Date().toISOString()
  const codexResult = await sendCodexSessionMessage({
    projectId,
    sessionId,
    body: trimmedBody,
    cwd: project.workspacePath,
    projectName: project.name,
    projectType: project.projectType,
    workflowMode: project.workflowMode,
    activePhaseId: (activePhase?.id as PhaseId | undefined) ?? null,
    activePhaseName: activePhase?.name ?? null,
    effectiveAgentPhaseId,
    effectiveAgentName: getPhaseDefinition(effectiveAgentPhaseId)?.name ?? selectedAgentLabel,
    selectedAgentId: session.selectedAgentId,
    selectedModel: session.selectedModel,
    activeArtifactPath: activePhase ? getPhaseArtifactRelativePath(activePhase.id) : null,
    conversationId: session.codexConversationId ?? null,
    rolloutPath: session.codexRolloutPath ?? null
  })
  const imageDirective = parseImageDirectives(codexResult.assistantText)
  const handoff = parseHandoffDirective(imageDirective.cleanedText)
  let cleanedAssistantText =
    handoff.cleanedText || imageDirective.cleanedText || codexResult.assistantText
  const generatedImagePaths: string[] = []
  const imageGenerationErrors: string[] = []
  let generatedWorkflow = workflowForTurn

  if (imageDirective.directives.length > 0) {
    for (const directive of imageDirective.directives) {
      try {
        const generatedImagePath = await generateWorkspaceImage({
          project,
          directive
        })
        generatedImagePaths.push(generatedImagePath)
        const syncedAfterImage = await syncWorkflowArtifacts(project, generatedWorkflow)
        generatedWorkflow = syncedAfterImage.workflow

        if (syncedAfterImage.changed) {
          await writeWorkflowState(project.workflowPath, generatedWorkflow)
        }
      } catch (imageError) {
        imageGenerationErrors.push(imageError instanceof Error ? imageError.message : "unknown error")
      }
    }

    cleanedAssistantText = [
      cleanedAssistantText,
      generatedImagePaths.length > 0 ? formatGeneratedImageSummary(generatedImagePaths) : null,
      imageGenerationErrors.length > 0
        ? formatImageGenerationFailureSummary(imageGenerationErrors)
        : null
    ]
      .filter(Boolean)
      .join("\n\n")
  }

  const userMessage: SessionMessageRecord = {
    id: randomUUID(),
    sessionId,
    role: "user",
    label: "You",
    body: trimmedBody,
    chips: [],
    createdAt: now
  }

  const assistantMessage: SessionMessageRecord = {
    id: randomUUID(),
    sessionId,
    role: "assistant",
    label: selectedAgentLabel,
    body: cleanedAssistantText,
    chips: [],
    createdAt: new Date(Date.now() + 1).toISOString()
  }

  if (handoff.directive && effectiveAgentPhaseId) {
    generatedWorkflow = markPhaseReadyForHandoff(
      generatedWorkflow,
      effectiveAgentPhaseId,
      handoff.directive.nextAgent,
      handoff.directive.reason
    )
    await writeWorkflowState(project.workflowPath, generatedWorkflow)
  }

  const nextState = updateProjectTimestamp(
    {
      ...ensuredMessages.state,
      sessions: ensuredMessages.state.sessions.map((item) => {
        if (item.projectId !== projectId) {
          return item
        }

        if (item.id === sessionId) {
          return {
            ...item,
            title:
              item.titleSource === "pending_first_message"
                ? deriveSessionTitleFromMessage(trimmedBody)
                : item.title,
            titleSource:
              item.titleSource === "pending_first_message" ? "message" : item.titleSource,
            status: "active" as const,
            preview: cleanedAssistantText.slice(0, 160) || trimmedBody.slice(0, 160),
            summary: selectedAgentLabel
              ? `${selectedAgentLabel} session`
              : "Project session",
            codexConversationId: codexResult.conversationId,
            codexRolloutPath: codexResult.rolloutPath,
            updatedAt: now
          }
        }

        return item.status === "active" ? { ...item, status: "idle" as const } : item
      }),
      sessionMessages: [...ensuredMessages.state.sessionMessages, userMessage, assistantMessage],
      activeSessionIdByProject: {
        ...ensuredMessages.state.activeSessionIdByProject,
        [projectId]: sessionId
      }
    },
    projectId
  )

  await writeStoreState(nextState)

  return {
    dashboard: await buildDashboardData(nextState),
    messages: [...ensuredMessages.messages, userMessage, assistantMessage],
    uiAction: generatedImagePaths.length > 0
      ? {
          type: "open_file",
          relativePath: generatedImagePaths[generatedImagePaths.length - 1],
          targetTab: "files"
        }
      : undefined
  }
}

export const listWorkspaceEntries = async (
  projectId: string,
  relativePath = "",
  scope: WorkspaceScope
): Promise<WorkspaceEntry[]> => {
  const state = await readStoreState()
  const project = getProjectFromState(state, projectId)
  const workflow = await readWorkflowState(project.workflowPath)
  const syncedWorkflow = await syncWorkflowArtifacts(project, workflow)

  if (syncedWorkflow.changed) {
    await writeWorkflowState(project.workflowPath, syncedWorkflow.workflow)
  }

  const target = resolveWorkspaceTarget(project.workspacePath, relativePath)
  const stats = await fs.stat(target.absolutePath).catch(() => null)

  if (!stats || !stats.isDirectory()) {
    return []
  }

  const allowedPaths =
    scope === "changes" ? await getChangedWorkspacePaths(project, syncedWorkflow.workflow) : undefined

  return listEntriesInDirectory(
    project.workspacePath,
    target.absolutePath,
    target.relativePath,
    allowedPaths
  )
}

export const readWorkspaceFile = async (
  projectId: string,
  relativePath: string
): Promise<WorkspaceFileContent> => {
  const state = await readStoreState()
  const project = getProjectFromState(state, projectId)
  const target = resolveWorkspaceTarget(project.workspacePath, relativePath)
  const stats = await fs.stat(target.absolutePath).catch(() => null)

  if (!stats) {
    return {
      path: target.relativePath,
      name: path.basename(target.relativePath || project.workspacePath),
      kind: "not_found"
    }
  }

  if (stats.isDirectory()) {
    return {
      path: target.relativePath,
      name: path.basename(target.relativePath || project.workspacePath),
      kind: "directory"
    }
  }

  if (stats.size > 1024 * 1024) {
    const imageDescriptor = getImageFileDescriptor(target.relativePath)
    if (imageDescriptor) {
      return {
        path: target.relativePath,
        name: path.basename(target.relativePath),
        kind: imageDescriptor.kind,
        dataUrl: `data:image/${path
          .extname(target.relativePath)
          .toLowerCase()
          .replace(".", "")
          .replace("jpg", "jpeg")};base64,${(await fs.readFile(target.absolutePath)).toString("base64")}`
      }
    }

    return {
      path: target.relativePath,
      name: path.basename(target.relativePath),
      kind: "unsupported"
    }
  }

  const descriptor = getTextFileDescriptor(target.relativePath)

  if (!descriptor) {
    const imageDescriptor = getImageFileDescriptor(target.relativePath)

    if (imageDescriptor) {
      return {
        path: target.relativePath,
        name: path.basename(target.relativePath),
        kind: imageDescriptor.kind,
        dataUrl: `data:image/${path
          .extname(target.relativePath)
          .toLowerCase()
          .replace(".", "")
          .replace("jpg", "jpeg")};base64,${(await fs.readFile(target.absolutePath)).toString("base64")}`
      }
    }

    return {
      path: target.relativePath,
      name: path.basename(target.relativePath),
      kind: "unsupported"
    }
  }

  return {
    path: target.relativePath,
    name: path.basename(target.relativePath),
    kind: descriptor.kind,
    language: descriptor.language,
    content: await fs.readFile(target.absolutePath, "utf8")
  }
}
