import { app } from "electron"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

type ProjectType = "new_project" | "existing_codebase"
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
  workspacePath: string
  workflowPath: string
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
  activeProjectId: string | null
}

type CreateProjectInput = {
  name: string
  projectType: ProjectType
  workspacePath?: string
}

type DashboardData = {
  projects: ProjectRecord[]
  activeProject: ProjectRecord | null
  workflow: WorkflowState | null
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

const readStoreState = async (): Promise<StoreState> => {
  return readJsonFile<StoreState>(getStoreFilePath(), {
    projects: [],
    activeProjectId: null
  })
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

const initializeWorkspace = async (workflowPath: string, workflowState: WorkflowState) => {
  await ensureDirectory(workflowPath)

  for (const folderName of Object.values(workflowFolderNames)) {
    await ensureDirectory(path.join(workflowPath, folderName))
  }

  await writeWorkflowState(workflowPath, workflowState)
}

const resolveWorkspacePath = async (input: CreateProjectInput, slug: string) => {
  const trimmedWorkspacePath = input.workspacePath?.trim()

  if (trimmedWorkspacePath) {
    return path.resolve(trimmedWorkspacePath)
  }

  const defaultBasePath = getDefaultProjectsBasePath()
  await ensureDirectory(defaultBasePath)
  return path.join(defaultBasePath, slug)
}

const touchProject = async (projectId: string) => {
  const state = await readStoreState()
  const updatedAt = new Date().toISOString()
  const projects = state.projects.map((project) =>
    project.id === projectId ? { ...project, updatedAt } : project
  )

  await writeStoreState({
    projects,
    activeProjectId: projectId
  })
}

const getProjectFromState = (state: StoreState, projectId: string) => {
  const project = state.projects.find((item) => item.id === projectId)

  if (!project) {
    throw new Error("Project not found")
  }

  return project
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
    workspacePath,
    workflowPath,
    createdAt: now,
    updatedAt: now
  }

  const workflow = buildInitialWorkflowState(projectId)

  await initializeWorkspace(workflowPath, workflow)
  await writeStoreState({
    projects: [project, ...state.projects],
    activeProjectId: projectId
  })

  return {
    projects: [project, ...state.projects],
    activeProject: project,
    workflow
  }
}

export const getDashboardData = async (): Promise<DashboardData> => {
  const state = await readStoreState()
  const activeProject = state.activeProjectId
    ? state.projects.find((project) => project.id === state.activeProjectId) ?? null
    : state.projects[0] ?? null

  if (!activeProject) {
    return {
      projects: state.projects,
      activeProject: null,
      workflow: null
    }
  }

  const workflow = await readWorkflowState(activeProject.workflowPath)

  return {
    projects: state.projects,
    activeProject,
    workflow
  }
}

export const selectProject = async (projectId: string): Promise<DashboardData> => {
  const state = await readStoreState()
  const project = getProjectFromState(state, projectId)
  const workflow = await readWorkflowState(project.workflowPath)

  await writeStoreState({
    ...state,
    activeProjectId: projectId
  })

  return {
    projects: state.projects,
    activeProject: project,
    workflow
  }
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

  workflow.phases = workflow.phases.map((phase, index) => {
    if (index !== phaseIndex) {
      return phase
    }

    return {
      ...phase,
      status,
      lastUpdatedAt: now
    }
  })

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
  await touchProject(projectId)

  const refreshedState = await readStoreState()

  return {
    projects: refreshedState.projects,
    activeProject: {
      ...project,
      updatedAt: now
    },
    workflow
  }
}
