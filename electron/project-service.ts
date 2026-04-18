import { app } from "electron"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

type ProjectType = "new_project" | "existing_codebase"
type WorkflowMode = "full_sdlc" | "scaffold_first" | "analyze_existing"
type SessionKind = "setup" | "analysis" | "discovery" | "architecture" | "implementation" | "general"
type SessionStatus = "active" | "idle" | "archived"
type SessionMessageRole = "system" | "user" | "assistant"
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
  | "directory"
  | "unsupported"
  | "not_found"

type PhaseDefinition = {
  id: string
  name: string
  summary: string
}

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
  kind: SessionKind
  status: SessionStatus
  summary: string
  preview: string
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

type WorkflowState = {
  projectId: string
  activePhaseId: string | null
  phases: WorkflowPhase[]
  artifacts: ArtifactRecord[]
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
}

const phaseDefinitions: PhaseDefinition[] = [
  {
    id: "discovery",
    name: "Discovery",
    summary: "Collect the brief, clarify scope, and generate structured requirements."
  },
  {
    id: "architecture",
    name: "Architecture",
    summary: "Translate approved requirements into modules, APIs, and infrastructure."
  },
  {
    id: "journey",
    name: "Journey",
    summary: "Map user and admin flows, screens, and navigation edge cases."
  },
  {
    id: "wireframe",
    name: "Wireframe",
    summary: "Define screens, component inventory, and low-fi UI planning."
  },
  {
    id: "coder",
    name: "Coder",
    summary: "Prepare implementation structure, starter code, and code map outputs."
  },
  {
    id: "testing",
    name: "Testing",
    summary: "Review quality, generate test plans, and capture result summaries."
  },
  {
    id: "devops",
    name: "DevOps",
    summary: "Prepare deployment guidance, environment setup, and operational checks."
  },
  {
    id: "handover",
    name: "Handover",
    summary: "Package final project outputs into delivery-ready documentation."
  }
]

const workflowFolderNames: Record<string, string> = {
  discovery: "discovery",
  architecture: "architecture",
  journey: "journeys",
  wireframe: "wireframes",
  coder: "coder",
  testing: "testing",
  devops: "devops",
  handover: "handover"
}

const phasePrimaryArtifacts: Record<string, string> = {
  discovery: "requirements.md",
  architecture: "architecture.md",
  journey: "user-journeys.md",
  wireframe: "wireframes.md",
  coder: "implementation-summary.md",
  testing: "test-plan.md",
  devops: "deployment-guide.md",
  handover: "client-handover.md"
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

const workflowModeLabels: Record<WorkflowMode, string> = {
  full_sdlc: "Full SDLC workflow",
  scaffold_first: "Scaffold-first flow",
  analyze_existing: "Analyze existing codebase"
}

const projectTypeLabels: Record<ProjectType, string> = {
  new_project: "New project",
  existing_codebase: "Imported existing folder"
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

const getPhaseFolderRelativePath = (phaseId: string) =>
  `.project-workflow/${workflowFolderNames[phaseId] ?? phaseId}`

const getPhaseArtifactRelativePath = (phaseId: string) =>
  `${getPhaseFolderRelativePath(phaseId)}/${phasePrimaryArtifacts[phaseId] ?? "artifact.md"}`

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
    artifacts: []
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

const normalizeSession = (session: Partial<SessionRecord>): SessionRecord | null => {
  if (!session.id || !session.projectId || !session.title) {
    return null
  }

  const kind: SessionKind =
    session.kind &&
    ["setup", "analysis", "discovery", "architecture", "implementation", "general"].includes(
      session.kind
    )
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
    kind,
    status,
    summary: session.summary ?? "Task-focused thread inside the project workspace.",
    preview: session.preview ?? "Use this session to guide a specific workflow task.",
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

const getActiveOrFocusedPhase = (workflow: WorkflowState) =>
  workflow.phases.find((phase) => phase.id === workflow.activePhaseId) ??
  workflow.phases.find((phase) =>
    ["running", "review_ready", "changes_requested", "failed"].includes(phase.status)
  ) ??
  workflow.phases[0] ??
  null

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
    title: "Project setup",
    kind: "setup" as const,
    summary: "Define the local workspace and start the shared SDLC flow.",
    preview: "Clarify goals, roles, and the first artifact before Architecture begins."
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
  }
): SessionRecord => {
  const now = new Date().toISOString()

  return {
    id: randomUUID(),
    projectId: project.id,
    title,
    kind: options?.kind ?? "general",
    status: options?.status ?? "active",
    summary: options?.summary ?? `Task-focused session for ${title.toLowerCase()}.`,
    preview:
      options?.preview ??
      "Use this thread to revise artifacts, clarify scope, or explore implementation options.",
    createdAt: now,
    updatedAt: now
  }
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
      preview: seed.preview
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
  const kickoffBody =
    project.workflowMode === "analyze_existing"
      ? "Import this repo, inspect the existing structure, and tell me the shortest path to a delivery-ready handover."
      : project.workflowMode === "scaffold_first"
        ? "Start with a scaffold, keep the workflow trail intact, and move toward useful implementation structure quickly."
        : "Set up a project workspace where artifacts, approvals, and handoffs stay visible from Discovery through Handover."

  const assistantBody = activePhase
    ? `This session is anchored to ${activePhase.name}. I’ll keep the chat, the workspace files, and the review state aligned around ${phasePrimaryArtifacts[activePhase.id]}.`
    : "This session is anchored to the shared workspace. I’ll keep the chat and the artifact trail aligned."

  return [
    {
      id: randomUUID(),
      sessionId: session.id,
      role: "system",
      label: "Workspace context",
      body: `${project.name} is running in ${workflowModeLabels[project.workflowMode]} against ${projectTypeLabels[project.projectType].toLowerCase()}. Files live under ${project.workspacePath}.`,
      chips: [workflowModeLabels[project.workflowMode], projectTypeLabels[project.projectType]],
      createdAt: now
    },
    {
      id: randomUUID(),
      sessionId: session.id,
      role: "user",
      label: session.title,
      body: kickoffBody,
      chips: activePhase ? [activePhase.name] : [],
      createdAt: now
    },
    {
      id: randomUUID(),
      sessionId: session.id,
      role: "assistant",
      label: "Workspace",
      body: assistantBody,
      chips: activePhase ? [phasePrimaryArtifacts[activePhase.id]] : [],
      createdAt: now
    }
  ]
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
    preview: sessionSeed.preview
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

export const createSession = async (projectId: string, title: string): Promise<DashboardData> => {
  const trimmedTitle = title.trim()

  if (!trimmedTitle) {
    throw new Error("Session title is required")
  }

  const state = await readStoreState()
  const project = getProjectFromState(state, projectId)
  const session = createSessionRecord(project, trimmedTitle, {
    status: "active"
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

  const nextState = updateProjectTimestamp(state, projectId)
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
  const activePhase = getActiveOrFocusedPhase(syncedWorkflow.workflow)
  const now = new Date().toISOString()

  const userMessage: SessionMessageRecord = {
    id: randomUUID(),
    sessionId,
    role: "user",
    label: "You",
    body: trimmedBody,
    chips: activePhase ? [activePhase.name] : [],
    createdAt: now
  }

  const assistantMessage: SessionMessageRecord = {
    id: randomUUID(),
    sessionId,
    role: "assistant",
    label: "Workspace",
    body: activePhase
      ? `Saved to this session. I’m keeping ${activePhase.name} centered in the workspace and the inspector around ${phasePrimaryArtifacts[activePhase.id]}.`
      : "Saved to this session. I’m keeping the workspace context and artifact trail aligned.",
    chips: activePhase ? [phasePrimaryArtifacts[activePhase.id]] : [],
    createdAt: new Date(Date.now() + 1).toISOString()
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
            status: "active" as const,
            preview: trimmedBody.slice(0, 160),
            summary: activePhase
              ? `${activePhase.name} discussion updated in this session.`
              : "Project discussion updated in this session.",
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
    messages: [...ensuredMessages.messages, userMessage, assistantMessage]
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
    return {
      path: target.relativePath,
      name: path.basename(target.relativePath),
      kind: "unsupported"
    }
  }

  const descriptor = getTextFileDescriptor(target.relativePath)

  if (!descriptor) {
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
