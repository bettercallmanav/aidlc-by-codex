import { app } from "electron"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

type ProjectType = "new_project" | "existing_codebase"
type WorkflowMode = "full_sdlc" | "scaffold_first" | "analyze_existing"
type SessionKind = "setup" | "analysis" | "discovery" | "architecture" | "implementation" | "general"
type SessionStatus = "active" | "idle" | "archived"
type PhaseStatus =
  | "not_started"
  | "running"
  | "review_ready"
  | "approved"
  | "changes_requested"
  | "failed"

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

type WorkflowState = {
  projectId: string
  activePhaseId: string | null
  phases: WorkflowPhase[]
  artifacts: ArtifactRecord[]
}

type StoreState = {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
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

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    projectType,
    workflowMode:
      project.workflowMode ??
      (projectType === "existing_codebase" ? "analyze_existing" : "full_sdlc"),
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

const normalizeStoreState = (state: Partial<StoreState> | null | undefined): StoreState => {
  const projects = (state?.projects ?? []).map(normalizeProject).filter(Boolean) as ProjectRecord[]
  const sessions = (state?.sessions ?? []).map(normalizeSession).filter(Boolean) as SessionRecord[]

  return {
    projects,
    sessions,
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

  await fs.writeFile(filePath, value, "utf8")
}

const initializeWorkspace = async (
  project: ProjectRecord,
  workflowState: WorkflowState
) => {
  await ensureDirectory(project.workspacePath)
  await ensureDirectory(project.workflowPath)

  for (const folderName of Object.values(workflowFolderNames)) {
    await ensureDirectory(path.join(project.workflowPath, folderName))
  }

  await writeWorkflowState(project.workflowPath, workflowState)
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

- Project type: New project
- Mode: ${project.workflowMode}
- Workflow state: .project-workflow/workflow-state.json
- Artifacts: .project-workflow/

## Next step

Open the project in the desktop app and start the Discovery session.
`
    )
  }
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

const getProjectFromState = (state: StoreState, projectId: string) => {
  const project = state.projects.find((item) => item.id === projectId)

  if (!project) {
    throw new Error("Project not found")
  }

  return project
}

const getSessionsForProject = (state: StoreState, projectId: string) =>
  state.sessions
    .filter((session) => session.projectId === projectId)
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

const touchProject = async (state: StoreState, projectId: string) => {
  const updatedAt = new Date().toISOString()
  const projects = state.projects.map((project) =>
    project.id === projectId ? { ...project, updatedAt } : project
  )

  const nextState = {
    ...state,
    projects,
    activeProjectId: projectId
  }

  await writeStoreState(nextState)
  return nextState
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
      activeSession: null
    }
  }

  const ensured = ensureProjectSessions(state, activeProject)

  if (ensured.changed) {
    await writeStoreState(ensured.state)
  }

  const workflow = await readWorkflowState(activeProject.workflowPath)

  return {
    projects: ensured.state.projects,
    activeProject,
    workflow,
    sessions: ensured.sessions,
    activeSession: ensured.activeSession
  }
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
    activeProjectId: projectId,
    activeSessionIdByProject: {
      ...state.activeSessionIdByProject,
      [projectId]: initialSession.id
    }
  }

  await writeStoreState(nextState)

  return {
    projects: nextState.projects,
    activeProject: project,
    workflow,
    sessions: [initialSession],
    activeSession: initialSession
  }
}

export const getDashboardData = async (): Promise<DashboardData> => {
  const state = await readStoreState()
  return buildDashboardData(state)
}

export const selectProject = async (projectId: string): Promise<DashboardData> => {
  const state = await readStoreState()
  getProjectFromState(state, projectId)

  const nextState = {
    ...state,
    activeProjectId: projectId
  }

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

  const nextState = await touchProject(
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

  return buildDashboardData(nextState)
}

export const selectSession = async (
  projectId: string,
  sessionId: string
): Promise<DashboardData> => {
  const state = await readStoreState()
  getProjectFromState(state, projectId)
  const session = state.sessions.find((item) => item.id === sessionId && item.projectId === projectId)

  if (!session) {
    throw new Error("Session not found")
  }

  const now = new Date().toISOString()
  const nextState = await touchProject(
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

  await writeWorkflowState(project.workflowPath, workflow)
  const nextState = await touchProject(state, projectId)

  return buildDashboardData(nextState)
}
