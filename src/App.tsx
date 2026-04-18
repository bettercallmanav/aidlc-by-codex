import { startTransition, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react"

type ShellInfo = {
  appName: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
}

type ProjectType = "new_project" | "existing_codebase"
type WorkflowMode = "full_sdlc" | "scaffold_first" | "analyze_existing"
type PhaseStatus =
  | "not_started"
  | "running"
  | "review_ready"
  | "approved"
  | "changes_requested"
  | "failed"
type SessionStatus = "active" | "idle" | "archived"
type SessionKind = "setup" | "analysis" | "discovery" | "architecture" | "implementation" | "general"
type SessionMessageRole = "system" | "user" | "assistant"
type ShellSurface = "home" | "setup" | "workspace"
type InspectorTab = "review" | "files" | "sdlc"
type UtilityPanel = "settings" | "help" | null

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

type WorkflowPhase = {
  id: string
  name: string
  summary: string
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
  kind?: "markdown" | "json" | "code" | "text" | "other"
  children?: WorkspaceEntry[]
}

type WorkspaceFileContent = {
  path: string
  name: string
  kind: "markdown" | "json" | "code" | "text" | "directory" | "unsupported" | "not_found"
  language?: string
  content?: string
}

type DashboardData = {
  projects: ProjectRecord[]
  activeProject: ProjectRecord | null
  workflow: WorkflowState | null
  sessions: SessionRecord[]
  activeSession: SessionRecord | null
  allSessions: SessionRecord[]
}

type EntryFormState = {
  name: string
  projectType: ProjectType
  workflowMode: WorkflowMode
  workspacePath: string
}

type BrowserStoreState = {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  sessionMessages: SessionMessageRecord[]
  workflows: Record<string, WorkflowState>
  activeProjectId: string | null
  activeSessionIdByProject: Record<string, string>
  virtualFiles: Record<string, Record<string, string>>
}

type WorkspaceLayoutState = {
  sidebarOpen: boolean
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  inspectorWidth: number
  reviewSidebarWidth: number
  openedFileTabs: string[]
  activeFileTab: string | null
  selectedReviewFile: string | null
  selectedSdlcPhase: string | null
  openedSdlcArtifactPath: string | null
}

type SendSessionMessageResult = {
  dashboard: DashboardData
  messages: SessionMessageRecord[]
}

type DesktopBridge = {
  getShellInfo: () => Promise<ShellInfo>
  getDashboardData: () => Promise<DashboardData>
  createProject: (payload: EntryFormState) => Promise<DashboardData>
  selectProject: (projectId: string) => Promise<DashboardData>
  createSession: (payload: { projectId: string; title: string }) => Promise<DashboardData>
  renameProject: (payload: { projectId: string; name: string }) => Promise<DashboardData>
  selectSession: (payload: { projectId: string; sessionId: string }) => Promise<DashboardData>
  renameSession: (payload: {
    projectId: string
    sessionId: string
    title: string
  }) => Promise<DashboardData>
  archiveSession: (payload: { projectId: string; sessionId: string }) => Promise<DashboardData>
  deleteSession: (payload: { projectId: string; sessionId: string }) => Promise<DashboardData>
  getSessionMessages: (payload: { projectId: string; sessionId: string }) => Promise<SessionMessageRecord[]>
  sendSessionMessage: (payload: {
    projectId: string
    sessionId: string
    body: string
  }) => Promise<SendSessionMessageResult>
  listWorkspaceEntries: (payload: {
    projectId: string
    relativePath?: string
    scope: "all" | "changes"
  }) => Promise<WorkspaceEntry[]>
  readWorkspaceFile: (payload: {
    projectId: string
    relativePath: string
  }) => Promise<WorkspaceFileContent>
  pickDirectory: (payload: {
    mode: ProjectType
    defaultPath?: string
  }) => Promise<string | null>
  updatePhaseStatus: (payload: {
    projectId: string
    phaseId: string
    status: Exclude<PhaseStatus, "not_started">
  }) => Promise<DashboardData>
}

declare global {
  interface Window {
    __CODEX_BUILDATHON__?: {
      runtime: "electron"
      bridgeName: string
    }
    desktopBridge?: DesktopBridge
  }
}

const emptyDashboard: DashboardData = {
  projects: [],
  activeProject: null,
  workflow: null,
  sessions: [],
  activeSession: null,
  allSessions: []
}

const initialEntryForm: EntryFormState = {
  name: "",
  projectType: "new_project",
  workflowMode: "full_sdlc",
  workspacePath: ""
}

const defaultWorkspaceLayout: WorkspaceLayoutState = {
  sidebarOpen: false,
  inspectorOpen: true,
  inspectorTab: "review",
  inspectorWidth: 560,
  reviewSidebarWidth: 240,
  openedFileTabs: [],
  activeFileTab: null,
  selectedReviewFile: null,
  selectedSdlcPhase: null,
  openedSdlcArtifactPath: null
}

const browserStoreKey = "codex-buildathon-browser-store"
const workspaceLayoutKey = "codex-buildathon-workspace-layout"

const phaseDefinitions: Array<Pick<WorkflowPhase, "id" | "name" | "summary">> = [
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

const phaseArtifactMap: Record<string, string> = {
  discovery: "requirements.md",
  architecture: "architecture.md",
  journey: "user-journeys.md",
  wireframe: "wireframes.md",
  coder: "implementation-summary.md",
  testing: "test-plan.md",
  devops: "deployment-guide.md",
  handover: "client-handover.md"
}

const workflowModeLabels: Record<WorkflowMode, string> = {
  full_sdlc: "Full SDLC workflow",
  scaffold_first: "Scaffold first",
  analyze_existing: "Analyze existing codebase"
}

const projectTypeLabels: Record<ProjectType, string> = {
  new_project: "Create new project",
  existing_codebase: "Import existing folder"
}

const phaseStatusLabels: Record<PhaseStatus, string> = {
  not_started: "Not started",
  running: "Running",
  review_ready: "Review ready",
  approved: "Approved",
  changes_requested: "Changes requested",
  failed: "Failed"
}

const entryCards = [
  {
    projectType: "new_project" as const,
    title: "Create new project",
    description:
      "Start from a parent folder in Finder, create a real workspace root, and open the first SDLC session inside it.",
    tags: ["greenfield", "scaffold", "delivery workflow"]
  },
  {
    projectType: "existing_codebase" as const,
    title: "Import existing folder",
    description:
      "Attach the app to a real repo, preserve that workspace root, and drive the rest of the workflow against those files.",
    tags: ["repo intake", "code audit", "handover prep"]
  }
]

const journeyStages = [
  "1. Create or import a workspace root",
  "2. Choose the workflow mode",
  "3. Open focused sessions inside the project",
  "4. Review artifacts and move phase by phase"
]

const fallbackShellInfo: ShellInfo = {
  appName: "Codex Buildathon (Browser Fallback)",
  electronVersion: "Unavailable",
  chromeVersion:
    typeof navigator !== "undefined"
      ? navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "Web"
      : "Web",
  nodeVersion: "Unavailable",
  platform: typeof navigator !== "undefined" ? navigator.platform : "browser"
}

const projectBadgePalette = [
  { background: "#dff1ec", color: "#1f6b63" },
  { background: "#f8e6dc", color: "#9b5935" },
  { background: "#e8ecfb", color: "#4e5fa6" },
  { background: "#efe7f7", color: "#6d4f9d" },
  { background: "#e4f0db", color: "#567536" },
  { background: "#fdebd2", color: "#a1651f" }
]

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value))

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const hashValue = (value: string) =>
  Array.from(value).reduce((sum, character) => sum + character.charCodeAt(0), 0)

const getProjectBadgeStyle = (seed: string): CSSProperties =>
  projectBadgePalette[hashValue(seed) % projectBadgePalette.length]

const getProjectInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "PR"

const getCacheKey = (projectId: string, relativePath: string) => `${projectId}:${relativePath}`

const getPhaseFolderRelativePath = (phaseId: string) =>
  `.project-workflow/${workflowFolderNames[phaseId] ?? phaseId}`

const getPhaseArtifactRelativePath = (phaseId: string) =>
  `${getPhaseFolderRelativePath(phaseId)}/${phaseArtifactMap[phaseId] ?? "artifact.md"}`

const displayTreeName = (name: string) => (name === ".project-workflow" ? "SDLC" : name)

const flattenFilePaths = (entries: WorkspaceEntry[]): string[] =>
  entries.flatMap((entry) =>
    entry.type === "file" ? [entry.path] : flattenFilePaths(entry.children ?? [])
  )

const clampLayout = (value: WorkspaceLayoutState): WorkspaceLayoutState => ({
  ...value,
  inspectorWidth: Math.max(420, Math.min(860, value.inspectorWidth)),
  reviewSidebarWidth: Math.max(180, Math.min(320, value.reviewSidebarWidth))
})

const readWorkspaceLayout = (): WorkspaceLayoutState => {
  if (typeof window === "undefined") {
    return defaultWorkspaceLayout
  }

  try {
    const rawValue = window.localStorage.getItem(workspaceLayoutKey)

    if (!rawValue) {
      return defaultWorkspaceLayout
    }

    return clampLayout({
      ...defaultWorkspaceLayout,
      ...(JSON.parse(rawValue) as Partial<WorkspaceLayoutState>),
      openedFileTabs: [],
      activeFileTab: null,
      selectedReviewFile: null,
      openedSdlcArtifactPath: null
    })
  } catch {
    return defaultWorkspaceLayout
  }
}

const writeWorkspaceLayout = (layout: WorkspaceLayoutState) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(workspaceLayoutKey, JSON.stringify(clampLayout(layout)))
  }
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
    artifacts: []
  }
}

const getActiveOrFocusedPhase = (workflow: WorkflowState | null) =>
  workflow?.phases.find((phase) => phase.id === workflow.activePhaseId) ??
  workflow?.phases.find((phase) =>
    ["running", "review_ready", "changes_requested", "failed"].includes(phase.status)
  ) ??
  workflow?.phases[0] ??
  null

const buildSeedArtifact = (project: ProjectRecord, phase: WorkflowPhase) => `# ${phase.name} - ${project.name}

## Purpose
${phase.summary}

## Project Context
- Project type: ${projectTypeLabels[project.projectType]}
- Workflow mode: ${workflowModeLabels[project.workflowMode]}
- Workspace root: ${project.workspacePath}

## Notes
This file is a seeded artifact so the workspace has a real review surface before full Codex phase execution is wired in.
`

const buildBrowserProjectContext = (project: ProjectRecord) =>
  JSON.stringify(
    {
      id: project.id,
      name: project.name,
      slug: project.slug,
      projectType: project.projectType,
      workflowMode: project.workflowMode,
      workspacePath: project.workspacePath,
      workflowPath: project.workflowPath,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    },
    null,
    2
  )

const getEmptyBrowserStore = (): BrowserStoreState => ({
  projects: [],
  sessions: [],
  sessionMessages: [],
  workflows: {},
  activeProjectId: null,
  activeSessionIdByProject: {},
  virtualFiles: {}
})

const readBrowserStore = (): BrowserStoreState => {
  if (typeof window === "undefined") {
    return getEmptyBrowserStore()
  }

  try {
    const rawValue = window.localStorage.getItem(browserStoreKey)

    if (!rawValue) {
      return getEmptyBrowserStore()
    }

    return {
      ...getEmptyBrowserStore(),
      ...(JSON.parse(rawValue) as Partial<BrowserStoreState>)
    }
  } catch {
    return getEmptyBrowserStore()
  }
}

const writeBrowserStore = (store: BrowserStoreState) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(browserStoreKey, JSON.stringify(store))
  }
}

const buildSessionRecord = (
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
    id: createId(),
    projectId: project.id,
    title,
    kind: options?.kind ?? "general",
    status: options?.status ?? "active",
    summary: options?.summary ?? `Task-focused session for ${title.toLowerCase()}.`,
    preview:
      options?.preview ??
      "Use this session to revise artifacts, inspect files, or shape the next workflow step.",
    createdAt: now,
    updatedAt: now
  }
}

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

const ensureBrowserWorkflowArtifacts = (store: BrowserStoreState, project: ProjectRecord) => {
  const workflow = store.workflows[project.id] ?? buildInitialWorkflowState(project.id)
  const files = store.virtualFiles[project.id] ?? {}
  const activePhase = getActiveOrFocusedPhase(workflow)

  if (project.projectType === "new_project" && !files["README.md"]) {
    files["README.md"] = `# ${project.name}\n\nThis project workspace was created in browser fallback mode.\n`
  }

  files[".project-workflow/project-context.json"] = buildBrowserProjectContext(project)

  if (activePhase) {
    const artifactPath = getPhaseArtifactRelativePath(activePhase.id)

    if (!files[artifactPath]) {
      files[artifactPath] = buildSeedArtifact(project, activePhase)
    }
  }

  const existingArtifacts = new Map(workflow.artifacts.map((artifact) => [artifact.path, artifact]))
  const artifactPaths = Object.keys(files).filter((filePath) =>
    filePath.startsWith(".project-workflow/") &&
    !filePath.endsWith("project-context.json") &&
    !filePath.endsWith("workflow-state.json")
  )

  workflow.artifacts = artifactPaths
    .map((artifactPath) => ({
      id: existingArtifacts.get(artifactPath)?.id ?? createId(),
      phaseId:
        phaseDefinitions.find((phase) => artifactPath.startsWith(getPhaseFolderRelativePath(phase.id)))?.id ??
        workflow.activePhaseId ??
        "discovery",
      path: artifactPath,
      kind: artifactPath.endsWith(".md")
        ? "markdown"
        : artifactPath.endsWith(".json")
          ? "json"
          : "other",
      createdAt: existingArtifacts.get(artifactPath)?.createdAt ?? new Date().toISOString()
    }))
    .sort((left, right) => left.path.localeCompare(right.path))

  files[".project-workflow/workflow-state.json"] = JSON.stringify(workflow, null, 2)
  store.virtualFiles[project.id] = files
  store.workflows[project.id] = workflow
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

  return [
    {
      id: createId(),
      sessionId: session.id,
      role: "system",
      label: "Workspace context",
      body: `${project.name} is running in ${workflowModeLabels[project.workflowMode]} against ${projectTypeLabels[project.projectType].toLowerCase()}. Files live under ${project.workspacePath}.`,
      chips: [workflowModeLabels[project.workflowMode], projectTypeLabels[project.projectType]],
      createdAt: now
    },
    {
      id: createId(),
      sessionId: session.id,
      role: "user",
      label: session.title,
      body: kickoffBody,
      chips: activePhase ? [activePhase.name] : [],
      createdAt: now
    },
    {
      id: createId(),
      sessionId: session.id,
      role: "assistant",
      label: "Workspace",
      body: activePhase
        ? `This session is anchored to ${activePhase.name}. I’ll keep the chat, files, and review state aligned around ${phaseArtifactMap[activePhase.id]}.`
        : "This session is anchored to the shared workspace. I’ll keep chat and artifacts aligned.",
      chips: activePhase ? [phaseArtifactMap[activePhase.id]] : [],
      createdAt: now
    }
  ]
}

const ensureBrowserSessionMessages = (
  store: BrowserStoreState,
  project: ProjectRecord,
  session: SessionRecord
) => {
  const workflow = store.workflows[project.id] ?? buildInitialWorkflowState(project.id)
  const existingMessages = store.sessionMessages
    .filter((message) => message.sessionId === session.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  if (existingMessages.length > 0) {
    return existingMessages
  }

  const seededMessages = buildSeedMessages(project, workflow, session)
  store.sessionMessages = [...store.sessionMessages, ...seededMessages]
  return seededMessages
}

const buildDashboardData = (store: BrowserStoreState): DashboardData => {
  const activeProject =
    store.projects.find((project) => project.id === store.activeProjectId) ?? null
  const sessions = activeProject
    ? store.sessions
        .filter(
          (session) => session.projectId === activeProject.id && session.status !== "archived"
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    : []
  const activeSession = activeProject
    ? sessions.find((session) => session.id === store.activeSessionIdByProject[activeProject.id]) ??
      sessions[0] ??
      null
    : null

  if (activeProject) {
    ensureBrowserWorkflowArtifacts(store, activeProject)
  }

  return {
    projects: store.projects,
    activeProject,
    workflow: activeProject ? store.workflows[activeProject.id] ?? null : null,
    sessions,
    activeSession,
    allSessions: store.sessions.filter((session) => session.status !== "archived")
  }
}

const buildVirtualTree = (paths: string[]): WorkspaceEntry[] => {
  const root = new Map<string, WorkspaceEntry>()

  for (const filePath of [...paths].sort()) {
    const segments = filePath.split("/").filter(Boolean)
    let cursor = root
    let currentPath = ""

    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const existing = cursor.get(segment)
      const isFile = index === segments.length - 1

      if (!existing) {
        const entry: WorkspaceEntry = isFile
          ? {
              name: segment,
              path: currentPath,
              type: "file",
              kind: segment.endsWith(".md")
                ? "markdown"
                : segment.endsWith(".json")
                  ? "json"
                  : ["ts", "tsx", "js", "jsx", "css", "html"].some((ext) =>
                      segment.endsWith(`.${ext}`)
                    )
                    ? "code"
                    : segment.endsWith(".txt")
                      ? "text"
                      : "other"
            }
          : {
              name: segment,
              path: currentPath,
              type: "directory",
              children: []
            }

        cursor.set(segment, entry)
      }

      const target = cursor.get(segment)
      if (!target || target.type !== "directory") {
        return
      }

      const nextMap = new Map<string, WorkspaceEntry>()
      for (const child of target.children ?? []) {
        nextMap.set(child.name, child)
      }

      cursor = nextMap
      target.children = [...nextMap.values()]
    })
  }

  const finalize = (entries: WorkspaceEntry[]): WorkspaceEntry[] =>
    entries
      .map((entry) =>
        entry.type === "directory"
          ? {
              ...entry,
              children: finalize(entry.children ?? [])
            }
          : entry
      )
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "directory" ? -1 : 1
        }

        return left.name.localeCompare(right.name)
      })

  return finalize([...root.values()])
}

const buildVirtualEntries = (
  files: Record<string, string>,
  scope: "all" | "changes",
  workflow: WorkflowState | null
) => {
  const allPaths = Object.keys(files)
  const activePhase = getActiveOrFocusedPhase(workflow)
  const allowedPaths =
    scope === "changes"
      ? new Set<string>([
          ...(workflow?.artifacts.map((artifact) => artifact.path) ?? []),
          ...(activePhase
            ? allPaths.filter((filePath) =>
                filePath.startsWith(`${getPhaseFolderRelativePath(activePhase.id)}/`)
              )
            : [])
        ])
      : new Set(allPaths)

  return buildVirtualTree(
    allPaths.filter((filePath) =>
      [...allowedPaths].some(
        (allowedPath) => filePath === allowedPath || filePath.startsWith(`${allowedPath}/`)
      )
    )
  )
}

const phaseActions = (phase: WorkflowPhase | null) => {
  if (!phase) {
    return []
  }

  if (phase.status === "running") {
    return [
      { label: "Ready for review", status: "review_ready" as const },
      { label: "Mark failed", status: "failed" as const, tone: "secondary" as const }
    ]
  }

  if (phase.status === "review_ready") {
    return [
      { label: "Approve phase", status: "approved" as const },
      {
        label: "Request changes",
        status: "changes_requested" as const,
        tone: "secondary" as const
      }
    ]
  }

  if (phase.status === "changes_requested" || phase.status === "failed") {
    return [
      { label: "Resume phase", status: "running" as const },
      { label: "Ready for review", status: "review_ready" as const, tone: "secondary" as const }
    ]
  }

  return []
}

const describeWorkspaceSelection = (entryForm: EntryFormState) => {
  if (entryForm.projectType === "existing_codebase") {
    return entryForm.workspacePath
      ? `Imported workspace root: ${entryForm.workspacePath}`
      : "Choose the existing project folder that should anchor the full workflow."
  }

  if (entryForm.workspacePath && entryForm.name.trim()) {
    return `A new folder named "${slugify(entryForm.name)}" will be created inside ${entryForm.workspacePath}.`
  }

  if (entryForm.workspacePath) {
    return `A new project folder will be created inside ${entryForm.workspacePath}.`
  }

  return "Choose a parent location, and the app will create the project folder there."
}

const getAvailableModes = (projectType: ProjectType): WorkflowMode[] =>
  projectType === "existing_codebase"
    ? ["analyze_existing", "full_sdlc", "scaffold_first"]
    : ["full_sdlc", "scaffold_first", "analyze_existing"]

const getPhasePrimaryArtifactPath = (workflow: WorkflowState | null, phaseId: string | null) => {
  if (!workflow || !phaseId) {
    return null
  }

  const preferredSuffix = `/${phaseArtifactMap[phaseId] ?? "artifact.md"}`

  return (
    workflow.artifacts.find(
      (artifact) => artifact.phaseId === phaseId && artifact.path.endsWith(preferredSuffix)
    )?.path ??
    workflow.artifacts.find((artifact) => artifact.phaseId === phaseId)?.path ??
    null
  )
}

const getBridge = (): DesktopBridge => window.desktopBridge ?? fallbackBridge

const fallbackBridge: DesktopBridge = {
  getShellInfo: async () => fallbackShellInfo,
  getDashboardData: async () => buildDashboardData(readBrowserStore()),
  createProject: async (payload) => {
    const store = readBrowserStore()
    const now = new Date().toISOString()
    const projectId = createId()
    const slug = slugify(payload.name || "untitled-project")
    const inputPath = payload.workspacePath.trim()
    const workspacePath =
      payload.projectType === "existing_codebase"
        ? inputPath || `/Browser Workspace Imported/${slug}`
        : `${inputPath || "/Browser Workspace"}/${slug}`
    const project: ProjectRecord = {
      id: projectId,
      name: payload.name,
      slug,
      projectType: payload.projectType,
      workflowMode: payload.workflowMode,
      workspacePath,
      workflowPath: `${workspacePath}/.project-workflow`,
      createdAt: now,
      updatedAt: now
    }
    const seed = getDefaultSessionSeed(project)
    const initialSession = buildSessionRecord(project, seed.title, {
      kind: seed.kind,
      summary: seed.summary,
      preview: seed.preview,
      status: "active"
    })

    store.projects = [project, ...store.projects]
    store.sessions = [initialSession, ...store.sessions]
    store.workflows[projectId] = buildInitialWorkflowState(projectId)
    store.activeProjectId = projectId
    store.activeSessionIdByProject[projectId] = initialSession.id
    ensureBrowserWorkflowArtifacts(store, project)
    ensureBrowserSessionMessages(store, project, initialSession)
    writeBrowserStore(store)

    return buildDashboardData(store)
  },
  selectProject: async (projectId) => {
    const store = readBrowserStore()
    store.activeProjectId = projectId
    writeBrowserStore(store)
    return buildDashboardData(store)
  },
  createSession: async ({ projectId, title }) => {
    const store = readBrowserStore()
    const project = store.projects.find((item) => item.id === projectId)

    if (!project) {
      throw new Error("Project not found")
    }

    const nextSession = buildSessionRecord(project, title.trim() || "New session")

    store.sessions = store.sessions
      .map((session) =>
        session.projectId === projectId && session.id === store.activeSessionIdByProject[projectId]
          ? { ...session, status: "idle" as const }
          : session
      )
      .concat({ ...nextSession, status: "active" })
    store.activeSessionIdByProject[projectId] = nextSession.id
    ensureBrowserWorkflowArtifacts(store, project)
    ensureBrowserSessionMessages(store, project, nextSession)
    writeBrowserStore(store)
    return buildDashboardData(store)
  },
  renameProject: async ({ projectId, name }) => {
    const trimmedName = name.trim()

    if (!trimmedName) {
      throw new Error("Project name is required")
    }

    const store = readBrowserStore()
    store.projects = store.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            name: trimmedName,
            updatedAt: new Date().toISOString()
          }
        : project
    )
    writeBrowserStore(store)
    return buildDashboardData(store)
  },
  selectSession: async ({ projectId, sessionId }) => {
    const store = readBrowserStore()

    store.sessions = store.sessions.map((session) => {
      if (session.projectId !== projectId) {
        return session
      }

      return {
        ...session,
        status: session.id === sessionId ? "active" : "idle",
        updatedAt: session.id === sessionId ? new Date().toISOString() : session.updatedAt
      }
    })
    store.activeSessionIdByProject[projectId] = sessionId
    writeBrowserStore(store)
    return buildDashboardData(store)
  },
  renameSession: async ({ projectId, sessionId, title }) => {
    const trimmedTitle = title.trim()

    if (!trimmedTitle) {
      throw new Error("Session title is required")
    }

    const store = readBrowserStore()
    store.sessions = store.sessions.map((session) =>
      session.id === sessionId && session.projectId === projectId
        ? {
            ...session,
            title: trimmedTitle,
            updatedAt: new Date().toISOString()
          }
        : session
    )
    writeBrowserStore(store)
    return buildDashboardData(store)
  },
  archiveSession: async ({ projectId, sessionId }) => {
    const store = readBrowserStore()
    store.sessions = store.sessions.map((session) =>
      session.id === sessionId && session.projectId === projectId
        ? {
            ...session,
            status: "archived",
            updatedAt: new Date().toISOString()
          }
        : session
    )
    if (store.activeSessionIdByProject[projectId] === sessionId) {
      delete store.activeSessionIdByProject[projectId]
    }
    writeBrowserStore(store)
    return buildDashboardData(store)
  },
  deleteSession: async ({ projectId, sessionId }) => {
    const store = readBrowserStore()
    store.sessions = store.sessions.filter((session) => session.id !== sessionId)
    store.sessionMessages = store.sessionMessages.filter((message) => message.sessionId !== sessionId)
    if (store.activeSessionIdByProject[projectId] === sessionId) {
      delete store.activeSessionIdByProject[projectId]
    }
    writeBrowserStore(store)
    return buildDashboardData(store)
  },
  getSessionMessages: async ({ projectId, sessionId }) => {
    const store = readBrowserStore()
    const project = store.projects.find((item) => item.id === projectId)
    const session = store.sessions.find((item) => item.id === sessionId && item.projectId === projectId)

    if (!project || !session) {
      throw new Error("Session not found")
    }

    ensureBrowserWorkflowArtifacts(store, project)
    const messages = ensureBrowserSessionMessages(store, project, session)
    writeBrowserStore(store)
    return messages
  },
  sendSessionMessage: async ({ projectId, sessionId, body }) => {
    const trimmedBody = body.trim()

    if (!trimmedBody) {
      throw new Error("Message body is required")
    }

    const store = readBrowserStore()
    const project = store.projects.find((item) => item.id === projectId)
    const session = store.sessions.find((item) => item.id === sessionId && item.projectId === projectId)

    if (!project || !session) {
      throw new Error("Session not found")
    }

    ensureBrowserWorkflowArtifacts(store, project)
    const workflow = store.workflows[projectId]
    const existingMessages = ensureBrowserSessionMessages(store, project, session)
    const activePhase = getActiveOrFocusedPhase(workflow)
    const now = new Date().toISOString()

    const userMessage: SessionMessageRecord = {
      id: createId(),
      sessionId,
      role: "user",
      label: "You",
      body: trimmedBody,
      chips: activePhase ? [activePhase.name] : [],
      createdAt: now
    }
    const assistantMessage: SessionMessageRecord = {
      id: createId(),
      sessionId,
      role: "assistant",
      label: "Workspace",
      body: activePhase
        ? `Saved to this session. I’m keeping ${activePhase.name} centered around ${phaseArtifactMap[activePhase.id]}.`
        : "Saved to this session. I’m keeping the workspace context aligned.",
      chips: activePhase ? [phaseArtifactMap[activePhase.id]] : [],
      createdAt: new Date(Date.now() + 1).toISOString()
    }

    store.sessionMessages = [...store.sessionMessages, userMessage, assistantMessage]
    store.sessions = store.sessions.map((item) =>
      item.projectId !== projectId
        ? item
        : item.id === sessionId
          ? {
              ...item,
              status: "active",
              preview: trimmedBody.slice(0, 160),
              summary: activePhase
                ? `${activePhase.name} discussion updated in this session.`
                : "Project discussion updated in this session.",
              updatedAt: now
            }
          : item.status === "active"
            ? { ...item, status: "idle" }
            : item
    )
    store.activeSessionIdByProject[projectId] = sessionId
    writeBrowserStore(store)

    return {
      dashboard: buildDashboardData(store),
      messages: [...existingMessages, userMessage, assistantMessage]
    }
  },
  listWorkspaceEntries: async ({ projectId, scope }) => {
    const store = readBrowserStore()
    const project = store.projects.find((item) => item.id === projectId)

    if (!project) {
      return []
    }

    ensureBrowserWorkflowArtifacts(store, project)
    writeBrowserStore(store)
    return buildVirtualEntries(store.virtualFiles[projectId] ?? {}, scope, store.workflows[projectId])
  },
  readWorkspaceFile: async ({ projectId, relativePath }) => {
    const store = readBrowserStore()
    const files = store.virtualFiles[projectId] ?? {}
    const content = files[relativePath]

    if (content == null) {
      return {
        path: relativePath,
        name: relativePath.split("/").pop() ?? relativePath,
        kind: "not_found"
      }
    }

    return {
      path: relativePath,
      name: relativePath.split("/").pop() ?? relativePath,
      kind: relativePath.endsWith(".md")
        ? "markdown"
        : relativePath.endsWith(".json")
          ? "json"
          : ["ts", "tsx", "js", "jsx", "css", "html"].some((extension) =>
                relativePath.endsWith(`.${extension}`)
              )
            ? "code"
            : relativePath.endsWith(".txt")
              ? "text"
              : "unsupported",
      language: relativePath.endsWith(".md")
        ? "markdown"
        : relativePath.endsWith(".json")
          ? "json"
          : relativePath.endsWith(".tsx")
            ? "tsx"
            : relativePath.endsWith(".ts")
              ? "typescript"
              : relativePath.endsWith(".jsx")
                ? "jsx"
                : relativePath.endsWith(".js")
                  ? "javascript"
                  : relativePath.endsWith(".css")
                    ? "css"
                    : relativePath.endsWith(".html")
                      ? "html"
                      : "text",
      content
    }
  },
  pickDirectory: async () => null,
  updatePhaseStatus: async ({ projectId, phaseId, status }) => {
    const store = readBrowserStore()
    const workflow = store.workflows[projectId]

    if (!workflow) {
      return buildDashboardData(store)
    }

    const nextPhases = workflow.phases.map((phase) =>
      phase.id === phaseId
        ? { ...phase, status, lastUpdatedAt: new Date().toISOString() }
        : phase
    )
    const currentIndex = nextPhases.findIndex((phase) => phase.id === phaseId)

    if (status === "approved" && currentIndex >= 0 && currentIndex < nextPhases.length - 1) {
      const nextPhase = nextPhases[currentIndex + 1]
      if (nextPhase.status === "not_started") {
        nextPhases[currentIndex + 1] = {
          ...nextPhase,
          status: "running",
          lastUpdatedAt: new Date().toISOString()
        }
      }
    }

    store.workflows[projectId] = {
      ...workflow,
      activePhaseId:
        status === "approved"
          ? nextPhases.find((phase) => phase.status === "running")?.id ?? null
          : phaseId,
      phases: nextPhases
    }

    const project = store.projects.find((item) => item.id === projectId)
    if (project) {
      ensureBrowserWorkflowArtifacts(store, project)
    }
    writeBrowserStore(store)
    return buildDashboardData(store)
  }
}

function App() {
  const isElectronRuntime =
    window.__CODEX_BUILDATHON__?.runtime === "electron" || Boolean(window.desktopBridge)
  const hoverResetTimeoutRef = useRef<number | null>(null)
  const [shellInfo, setShellInfo] = useState<ShellInfo | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [entryForm, setEntryForm] = useState<EntryFormState>(initialEntryForm)
  const [shellSurface, setShellSurface] = useState<ShellSurface>("home")
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => ({
    ...readWorkspaceLayout(),
    sidebarOpen: false
  }))
  const [sidebarProjectId, setSidebarProjectId] = useState<string | null>(null)
  const [hoverProjectId, setHoverProjectId] = useState<string | null>(null)
  const [workspaceExpanded, setWorkspaceExpanded] = useState<Record<string, boolean>>({})
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(null)
  const [editingProject, setEditingProject] = useState<{ projectId: string; name: string } | null>(
    null
  )
  const [editingSession, setEditingSession] = useState<{ sessionId: string; title: string } | null>(
    null
  )
  const [sessionDraft, setSessionDraft] = useState({ title: "" })
  const [promptDraft, setPromptDraft] = useState("")
  const [sessionMessages, setSessionMessages] = useState<SessionMessageRecord[]>([])
  const [reviewEntries, setReviewEntries] = useState<WorkspaceEntry[]>([])
  const [fileEntries, setFileEntries] = useState<WorkspaceEntry[]>([])
  const [fileCache, setFileCache] = useState<Record<string, WorkspaceFileContent>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patchLayout = (
    nextValue:
      | Partial<WorkspaceLayoutState>
      | ((current: WorkspaceLayoutState) => WorkspaceLayoutState)
  ) => {
    setLayout((current) =>
      clampLayout(typeof nextValue === "function" ? nextValue(current) : { ...current, ...nextValue })
    )
  }

  const refreshDashboard = async () => {
    const bridge = getBridge()
    const [runtimeInfo, dashboardData] = await Promise.all([
      bridge.getShellInfo(),
      bridge.getDashboardData()
    ])

    startTransition(() => {
      setShellInfo(runtimeInfo)
      setDashboard(dashboardData)
    })
  }

  const handleLoadWorkspace = async (projectId: string, sessionId: string) => {
    const bridge = getBridge()

    setIsWorkspaceLoading(true)

    try {
      const [messages, nextReviewEntries, nextFileEntries] = await Promise.all([
        bridge.getSessionMessages({ projectId, sessionId }),
        bridge.listWorkspaceEntries({ projectId, scope: "changes" }),
        bridge.listWorkspaceEntries({ projectId, scope: "all" })
      ])

      startTransition(() => {
        setSessionMessages(messages)
        setReviewEntries(nextReviewEntries)
        setFileEntries(nextFileEntries)
      })
    } finally {
      setIsWorkspaceLoading(false)
    }
  }

  const ensureWorkspaceFile = async (projectId: string, relativePath: string) => {
    const cacheKey = getCacheKey(projectId, relativePath)

    if (fileCache[cacheKey]) {
      return fileCache[cacheKey]
    }

    const bridge = getBridge()
    const fileContent = await bridge.readWorkspaceFile({
      projectId,
      relativePath
    })

    setFileCache((current) => ({
      ...current,
      [cacheKey]: fileContent
    }))

    return fileContent
  }

  useEffect(() => {
    refreshDashboard()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard")
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  useEffect(() => {
    writeWorkspaceLayout(layout)
  }, [layout])

  useEffect(() => {
    return () => {
      if (hoverResetTimeoutRef.current !== null) {
        window.clearTimeout(hoverResetTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (layout.sidebarOpen) {
      setHoverProjectId(null)
    }
  }, [layout.sidebarOpen])

  useEffect(() => {
    patchLayout({
      selectedReviewFile: null,
      openedSdlcArtifactPath: null
    })
  }, [dashboard.activeProject?.id, dashboard.activeSession?.id])

  useEffect(() => {
    if (dashboard.projects.length === 0) {
      setSidebarProjectId(null)
      return
    }

    if (sidebarProjectId && dashboard.projects.some((project) => project.id === sidebarProjectId)) {
      return
    }

    setSidebarProjectId(dashboard.activeProject?.id ?? dashboard.projects[0]?.id ?? null)
  }, [dashboard.projects, dashboard.activeProject, sidebarProjectId])

  const workflowKey = dashboard.workflow
    ? `${dashboard.workflow.activePhaseId ?? "none"}:${dashboard.workflow.phases
        .map((phase) => `${phase.id}:${phase.status}`)
        .join("|")}:${dashboard.workflow.artifacts.map((artifact) => artifact.path).join("|")}`
    : "none"

  useEffect(() => {
    if (!dashboard.activeProject || !dashboard.activeSession || shellSurface !== "workspace") {
      setSessionMessages([])
      setReviewEntries([])
      setFileEntries([])
      return
    }

    let cancelled = false

    void handleLoadWorkspace(dashboard.activeProject.id, dashboard.activeSession.id).catch((loadError) => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load workspace")
      }
    })

    return () => {
      cancelled = true
    }
  }, [dashboard.activeProject?.id, dashboard.activeSession?.id, shellSurface, workflowKey])

  useEffect(() => {
    const reviewPaths = flattenFilePaths(reviewEntries)

    if (reviewPaths.length === 0) {
      if (layout.selectedReviewFile) {
        patchLayout({ selectedReviewFile: null })
      }
      return
    }

    if (layout.selectedReviewFile && !reviewPaths.includes(layout.selectedReviewFile)) {
      patchLayout({ selectedReviewFile: null })
    }
  }, [reviewEntries])

  useEffect(() => {
    const allPaths = new Set(flattenFilePaths(fileEntries))
    const nextOpenedTabs = layout.openedFileTabs.filter((path) => allPaths.has(path))

    if (
      nextOpenedTabs.length !== layout.openedFileTabs.length ||
      nextOpenedTabs.some((path, index) => path !== layout.openedFileTabs[index])
    ) {
      patchLayout((current) => ({
        ...current,
        openedFileTabs: nextOpenedTabs,
        activeFileTab:
          current.activeFileTab && nextOpenedTabs.includes(current.activeFileTab)
            ? current.activeFileTab
            : nextOpenedTabs[0] ?? null
      }))
      return
    }

    if (layout.activeFileTab && !allPaths.has(layout.activeFileTab)) {
      patchLayout({ activeFileTab: nextOpenedTabs[0] ?? null })
    }
  }, [fileEntries, layout.openedFileTabs, layout.activeFileTab])

  useEffect(() => {
    if (!dashboard.workflow) {
      return
    }

    const validPhaseIds = dashboard.workflow.phases.map((phase) => phase.id)
    const nextPhaseId =
      layout.selectedSdlcPhase && validPhaseIds.includes(layout.selectedSdlcPhase)
        ? layout.selectedSdlcPhase
        : getActiveOrFocusedPhase(dashboard.workflow)?.id ?? validPhaseIds[0] ?? null

    if (nextPhaseId !== layout.selectedSdlcPhase) {
      patchLayout({ selectedSdlcPhase: nextPhaseId, openedSdlcArtifactPath: null })
    }
  }, [dashboard.workflow, layout.selectedSdlcPhase])

  useEffect(() => {
    if (dashboard.activeProject && layout.selectedReviewFile) {
      void ensureWorkspaceFile(dashboard.activeProject.id, layout.selectedReviewFile).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to open review file")
      })
    }
  }, [dashboard.activeProject?.id, layout.selectedReviewFile])

  useEffect(() => {
    if (dashboard.activeProject && layout.activeFileTab) {
      void ensureWorkspaceFile(dashboard.activeProject.id, layout.activeFileTab).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to open file")
      })
    }
  }, [dashboard.activeProject?.id, layout.activeFileTab])

  const selectedSdlcArtifactPath = getPhasePrimaryArtifactPath(
    dashboard.workflow,
    layout.selectedSdlcPhase
  )

  useEffect(() => {
    if (
      dashboard.activeProject &&
      layout.openedSdlcArtifactPath &&
      selectedSdlcArtifactPath &&
      layout.openedSdlcArtifactPath === selectedSdlcArtifactPath
    ) {
      void ensureWorkspaceFile(dashboard.activeProject.id, selectedSdlcArtifactPath).catch(
        (loadError) => {
          setError(loadError instanceof Error ? loadError.message : "Unable to open SDLC artifact")
        }
      )
    }
  }, [dashboard.activeProject?.id, selectedSdlcArtifactPath, layout.openedSdlcArtifactPath])

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const bridge = getBridge()

    setIsSubmitting(true)
    setError(null)

    try {
      const nextDashboard = await bridge.createProject(entryForm)
      startTransition(() => {
        setDashboard(nextDashboard)
        setEntryForm(initialEntryForm)
        setPromptDraft("")
        setShellSurface("workspace")
        setUtilityPanel(null)
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create project")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenProjectSession = async (projectId: string, sessionId?: string) => {
    const bridge = getBridge()

    setError(null)

    try {
      let nextDashboard = await bridge.selectProject(projectId)

      if (sessionId) {
        nextDashboard = await bridge.selectSession({ projectId, sessionId })
      }

      startTransition(() => {
        setDashboard(nextDashboard)
        setSidebarProjectId(projectId)
        setHoverProjectId(null)
        setShellSurface("workspace")
      })
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to open project")
    }
  }

  const handleRailProjectClick = async (projectId: string) => {
    setSidebarProjectId(projectId)
    patchLayout({ sidebarOpen: true })
    await handleOpenProjectSession(projectId)
  }

  const clearHoverReset = () => {
    if (hoverResetTimeoutRef.current !== null) {
      window.clearTimeout(hoverResetTimeoutRef.current)
      hoverResetTimeoutRef.current = null
    }
  }

  const scheduleHoverReset = () => {
    clearHoverReset()
    hoverResetTimeoutRef.current = window.setTimeout(() => {
      setHoverProjectId(null)
      hoverResetTimeoutRef.current = null
    }, 180)
  }

  const handleCreateSession = async (projectId: string, title: string) => {
    const bridge = getBridge()
    const trimmedTitle = title.trim()

    if (!trimmedTitle) {
      setError("Session title is required")
      return
    }

    setIsCreatingSession(true)
    setError(null)

    try {
      const nextDashboard = await bridge.createSession({
        projectId,
        title: trimmedTitle
      })

      startTransition(() => {
        setDashboard(nextDashboard)
        setSessionDraft({ title: "" })
        setSidebarProjectId(projectId)
        setHoverProjectId(null)
        setShellSurface("workspace")
      })
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Unable to create session")
    } finally {
      setIsCreatingSession(false)
    }
  }

  const handleSelectSession = async (projectId: string, sessionId: string) => {
    const bridge = getBridge()

    setError(null)

    try {
      const nextDashboard = await bridge.selectSession({
        projectId,
        sessionId
      })

      startTransition(() => {
        setDashboard(nextDashboard)
        setSidebarProjectId(projectId)
        setHoverProjectId(null)
        setPromptDraft("")
        setShellSurface("workspace")
      })
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Unable to open session")
    }
  }

  const handleRenameProject = async (projectId: string, name: string) => {
    const bridge = getBridge()

    setError(null)

    try {
      const nextDashboard = await bridge.renameProject({ projectId, name })
      startTransition(() => {
        setDashboard(nextDashboard)
        setEditingProject(null)
      })
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Unable to rename project")
    }
  }

  const handleRenameSession = async (projectId: string, sessionId: string, title: string) => {
    const bridge = getBridge()

    setError(null)

    try {
      const nextDashboard = await bridge.renameSession({
        projectId,
        sessionId,
        title
      })
      startTransition(() => {
        setDashboard(nextDashboard)
        setEditingSession(null)
      })
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Unable to rename session")
    }
  }

  const handleArchiveSession = async (projectId: string, sessionId: string) => {
    const bridge = getBridge()

    setError(null)

    try {
      const nextDashboard = await bridge.archiveSession({
        projectId,
        sessionId
      })
      startTransition(() => {
        setDashboard(nextDashboard)
      })
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Unable to archive session")
    }
  }

  const handleDeleteSession = async (projectId: string, sessionId: string) => {
    const bridge = getBridge()

    if (!window.confirm("Delete this session from the workspace?")) {
      return
    }

    setError(null)

    try {
      const nextDashboard = await bridge.deleteSession({
        projectId,
        sessionId
      })
      startTransition(() => {
        setDashboard(nextDashboard)
      })
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete session")
    }
  }

  const handlePickDirectory = async () => {
    const bridge = getBridge()

    setError(null)

    try {
      const selectedPath = await bridge.pickDirectory({
        mode: entryForm.projectType,
        defaultPath: entryForm.workspacePath
      })

      if (!selectedPath) {
        return
      }

      setEntryForm((current) => ({
        ...current,
        workspacePath: selectedPath
      }))
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Unable to choose folder")
    }
  }

  const handlePhaseStatusUpdate = async (
    phaseId: string,
    status: Exclude<PhaseStatus, "not_started">
  ) => {
    const bridge = getBridge()
    const activeProject = dashboard.activeProject

    if (!activeProject) {
      return
    }

    setError(null)

    try {
      const nextDashboard = await bridge.updatePhaseStatus({
        projectId: activeProject.id,
        phaseId,
        status
      })
      startTransition(() => {
        setDashboard(nextDashboard)
      })
    } catch (phaseError) {
      setError(
        phaseError instanceof Error ? phaseError.message : "Unable to update phase status"
      )
    }
  }

  const handleSendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const activeProject = dashboard.activeProject
    const activeSession = dashboard.activeSession

    if (!activeProject || !activeSession) {
      return
    }

    const trimmedPrompt = promptDraft.trim()
    if (!trimmedPrompt) {
      return
    }

    const bridge = getBridge()

    setIsSendingMessage(true)
    setError(null)

    try {
      const result = await bridge.sendSessionMessage({
        projectId: activeProject.id,
        sessionId: activeSession.id,
        body: trimmedPrompt
      })

      startTransition(() => {
        setDashboard(result.dashboard)
        setSessionMessages(result.messages)
        setPromptDraft("")
      })
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : "Unable to send message")
    } finally {
      setIsSendingMessage(false)
    }
  }

  const openFileInInspector = async (
    relativePath: string,
    targetTab: InspectorTab,
    options?: { alsoSelectReview?: boolean }
  ) => {
    const activeProject = dashboard.activeProject

    if (!activeProject) {
      return
    }

    setError(null)

    try {
      await ensureWorkspaceFile(activeProject.id, relativePath)
      patchLayout((current) => ({
        ...current,
        inspectorOpen: true,
        inspectorTab: targetTab,
        selectedReviewFile:
          targetTab === "review" || options?.alsoSelectReview ? relativePath : current.selectedReviewFile,
        openedFileTabs:
          targetTab === "files"
            ? current.openedFileTabs.includes(relativePath)
              ? current.openedFileTabs
              : [...current.openedFileTabs, relativePath]
            : current.openedFileTabs,
        activeFileTab: targetTab === "files" ? relativePath : current.activeFileTab,
        openedSdlcArtifactPath:
          targetTab === "review" && current.openedSdlcArtifactPath === relativePath
            ? relativePath
            : current.openedSdlcArtifactPath
      }))
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Unable to open file")
    }
  }

  const handleOpenSdlcArtifact = async (relativePath: string, targetTab: "sdlc" | "review" | "files") => {
    const activeProject = dashboard.activeProject

    if (!activeProject) {
      return
    }

    setError(null)

    try {
      await ensureWorkspaceFile(activeProject.id, relativePath)
      patchLayout((current) => ({
        ...current,
        inspectorOpen: true,
        inspectorTab: targetTab === "sdlc" ? "sdlc" : targetTab,
        selectedReviewFile: targetTab === "review" ? relativePath : current.selectedReviewFile,
        openedFileTabs:
          targetTab === "files"
            ? current.openedFileTabs.includes(relativePath)
              ? current.openedFileTabs
              : [...current.openedFileTabs, relativePath]
            : current.openedFileTabs,
        activeFileTab: targetTab === "files" ? relativePath : current.activeFileTab,
        openedSdlcArtifactPath: relativePath
      }))
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Unable to open SDLC artifact")
    }
  }

  const closeFileTab = (relativePath: string) => {
    patchLayout((current) => {
      const nextOpenedTabs = current.openedFileTabs.filter((tab) => tab !== relativePath)
      return {
        ...current,
        openedFileTabs: nextOpenedTabs,
        activeFileTab:
          current.activeFileTab === relativePath ? nextOpenedTabs[nextOpenedTabs.length - 1] ?? null : current.activeFileTab
      }
    })
  }

  const openProjectSetup = (projectType: ProjectType) => {
    const nextMode = getAvailableModes(projectType)[0]

    setError(null)
    setEntryForm((current) => ({
      ...current,
      projectType,
      workflowMode: nextMode
    }))
    setShellSurface("setup")
  }

  const handleReturnHome = () => {
    setError(null)
    setHoverProjectId(null)
    setShellSurface("home")
  }

  const activeProject = dashboard.activeProject
  const workflow = dashboard.workflow
  const activeSession = dashboard.activeSession
  const activePhase = getActiveOrFocusedPhase(workflow)
  const currentPhaseActions = phaseActions(activePhase)
  const selectedEntryCard = entryCards.find((card) => card.projectType === entryForm.projectType)
  const sidebarProject =
    dashboard.projects.find((project) => project.id === sidebarProjectId) ?? activeProject ?? null
  const visibleSidebarProject =
    !layout.sidebarOpen && hoverProjectId
      ? dashboard.projects.find((project) => project.id === hoverProjectId) ?? sidebarProject
      : sidebarProject
  const sidebarSessions = visibleSidebarProject
    ? dashboard.allSessions
        .filter((session) => session.projectId === visibleSidebarProject.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    : []
  const isWorkspaceSectionOpen = visibleSidebarProject
    ? workspaceExpanded[visibleSidebarProject.id] ?? true
    : true
  const reviewContent =
    activeProject && layout.selectedReviewFile
      ? fileCache[getCacheKey(activeProject.id, layout.selectedReviewFile)] ?? null
      : null
  const reviewFilePaths = flattenFilePaths(reviewEntries)
  const allFilePaths = flattenFilePaths(fileEntries)
  const activeFileContent =
    activeProject && layout.activeFileTab
      ? fileCache[getCacheKey(activeProject.id, layout.activeFileTab)] ?? null
      : null
  const selectedSdlcPhase =
    workflow?.phases.find((phase) => phase.id === layout.selectedSdlcPhase) ?? activePhase ?? null
  const sdlcArtifactContent =
    activeProject &&
    selectedSdlcArtifactPath &&
    layout.openedSdlcArtifactPath === selectedSdlcArtifactPath
      ? fileCache[getCacheKey(activeProject.id, selectedSdlcArtifactPath)] ?? null
      : null
  const reviewTabLabel = reviewFilePaths.length === 1 ? "1 Change" : `${reviewFilePaths.length} Changes`
  const fileTabLabel = allFilePaths.length === 1 ? "1 File" : "All files"

  const renderFileBody = (
    content: WorkspaceFileContent | null,
    emptyTitle: string,
    emptyCopy: string
  ) => {
    if (!content) {
      return (
        <div className="inspector-empty">
          <strong>{emptyTitle}</strong>
          <p>{emptyCopy}</p>
        </div>
      )
    }

    if (content.kind === "not_found") {
      return (
        <div className="inspector-empty">
          <strong>File not found</strong>
          <p>This path is no longer available in the workspace.</p>
        </div>
      )
    }

    if (content.kind === "directory") {
      return (
        <div className="inspector-empty">
          <strong>Directory selected</strong>
          <p>Choose a file to inspect its contents.</p>
        </div>
      )
    }

    if (content.kind === "unsupported") {
      return (
        <div className="inspector-empty">
          <strong>Unsupported file</strong>
          <p>This file type is not rendered in the workspace viewer yet.</p>
        </div>
      )
    }

    return (
      <div className="document-surface">
        <div className="document-header">
          <div>
            <p className="section-label">Open file</p>
            <h3>{content.name}</h3>
          </div>
          <span className="pill">{content.kind}</span>
        </div>
        <p className="document-path">{content.path}</p>
        <pre className={`document-content document-content-${content.kind}`}>
          <code>{content.content}</code>
        </pre>
      </div>
    )
  }

  const renderWorkspaceTree = (
    entries: WorkspaceEntry[],
    mode: "review" | "files",
    depth = 0
  ): JSX.Element[] =>
    entries.map((entry) => {
      if (entry.type === "directory") {
        return (
          <div key={entry.path} className="tree-group">
            <div className="tree-directory" style={{ paddingLeft: `${depth * 14}px` }}>
              <span className="tree-icon">▾</span>
              <span>{displayTreeName(entry.name)}</span>
            </div>
            {renderWorkspaceTree(entry.children ?? [], mode, depth + 1)}
          </div>
        )
      }

      const isSelected =
        mode === "review"
          ? layout.selectedReviewFile === entry.path
          : layout.activeFileTab === entry.path

      return (
        <button
          key={entry.path}
          type="button"
          className={`tree-file ${isSelected ? "tree-file-active" : ""}`}
          style={{ paddingLeft: `${depth * 14 + 18}px` }}
          onClick={() => void openFileInInspector(entry.path, mode === "review" ? "review" : "files")}
        >
          <span className={`tree-file-dot tree-file-dot-${entry.kind ?? "other"}`} />
          <span>{entry.name}</span>
        </button>
      )
    })

  const renderSidebarSessionItem = (session: SessionRecord, projectId: string) => {
    const isActive =
      session.id === activeSession?.id && projectId === activeProject?.id && shellSurface === "workspace"
    const isEditing = editingSession?.sessionId === session.id

    return (
      <div
        key={session.id}
        className={`sidebar-session-item ${isActive ? "sidebar-session-item-active" : ""}`}
      >
        {isEditing ? (
          <form
            className="sidebar-inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              void handleRenameSession(projectId, session.id, editingSession.title)
            }}
          >
            <div className="sidebar-inline-form-row">
              <input
                value={editingSession.title}
                onChange={(event) =>
                  setEditingSession({
                    sessionId: session.id,
                    title: event.target.value
                  })
                }
                autoFocus
              />
              <div className="sidebar-inline-actions">
                <button type="submit" className="secondary">
                  Save
                </button>
                <button type="button" className="secondary" onClick={() => setEditingSession(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        ) : (
          <>
            <button
              type="button"
              className="sidebar-session-main"
              onClick={() => void handleSelectSession(projectId, session.id)}
            >
              <span className={`session-status-dot session-status-${session.status}`} />
              <div className="sidebar-session-copy">
                <div className="sidebar-session-title-row">
                  <strong>{session.title}</strong>
                  {isActive ? <span className="pill accent">Active</span> : null}
                </div>
                <span>{session.summary}</span>
                <span>{formatDate(session.updatedAt)}</span>
              </div>
            </button>
            <div className="sidebar-session-actions">
              <button
                type="button"
                className="secondary action-button"
                onClick={() =>
                  setEditingSession({
                    sessionId: session.id,
                    title: session.title
                  })
                }
              >
                Rename
              </button>
              <button
                type="button"
                className="secondary action-button"
                onClick={() => void handleArchiveSession(projectId, session.id)}
              >
                Archive
              </button>
              <button
                type="button"
                className="secondary action-button action-button-danger"
                onClick={() => void handleDeleteSession(projectId, session.id)}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  const renderUtilityPanel = () => {
    if (!utilityPanel) {
      return null
    }

    if (utilityPanel === "settings") {
      return (
        <section className="sidebar-utility card-quiet">
          <div className="panel-header">
            <div>
              <p className="section-label">Runtime</p>
              <h3>Workspace settings</h3>
            </div>
            <button type="button" className="secondary action-button" onClick={() => setUtilityPanel(null)}>
              Close
            </button>
          </div>
          {shellInfo ? (
            <ul className="runtime-list">
              <li>{shellInfo.appName}</li>
              <li>Electron {shellInfo.electronVersion}</li>
              <li>Node {shellInfo.nodeVersion}</li>
              <li>{shellInfo.platform}</li>
            </ul>
          ) : (
            <p className="muted">Connecting to desktop runtime…</p>
          )}
        </section>
      )
    }

    return (
      <section className="sidebar-utility card-quiet">
        <div className="panel-header">
          <div>
            <p className="section-label">Help</p>
            <h3>Using the workspace</h3>
          </div>
          <button type="button" className="secondary action-button" onClick={() => setUtilityPanel(null)}>
            Close
          </button>
        </div>
        <div className="journey-list">
          <div className="journey-row">Use the left sidebar to switch projects and sessions.</div>
          <div className="journey-row">Use the center column for the active conversation.</div>
          <div className="journey-row">Use the right inspector for review, files, and SDLC state.</div>
        </div>
      </section>
    )
  }

  const renderSidebarPanel = (project: ProjectRecord | null, floating = false) => {
    if (!project) {
      return (
        <aside className={`project-sidebar card ${floating ? "project-sidebar-floating" : ""}`}>
          <div className="sidebar-empty">
            <p className="section-label">Workspace</p>
            <h2>No project selected</h2>
            <p className="muted">Use the rail to create or import a project, then open its sessions here.</p>
          </div>
          {renderUtilityPanel()}
        </aside>
      )
    }

    const sessions = dashboard.allSessions
      .filter((session) => session.projectId === project.id && session.status !== "archived")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const isEditingProject = editingProject?.projectId === project.id

    return (
      <aside
        className={`project-sidebar card ${floating ? "project-sidebar-floating" : ""}`}
        onMouseEnter={() => clearHoverReset()}
        onMouseLeave={() => scheduleHoverReset()}
      >
        <div className="sidebar-panel-header">
          <div className="sidebar-project-identity">
            <div className="sidebar-project-avatar" style={getProjectBadgeStyle(project.id)}>
              {getProjectInitials(project.name)}
            </div>
            <div className="sidebar-project-meta">
              {isEditingProject ? (
                <form
                  className="sidebar-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleRenameProject(project.id, editingProject.name)
                  }}
                >
                  <div className="sidebar-inline-form-row">
                    <input
                      value={editingProject.name}
                      onChange={(event) =>
                        setEditingProject({ projectId: project.id, name: event.target.value })
                      }
                      autoFocus
                    />
                    <div className="sidebar-inline-actions">
                      <button type="submit" className="secondary action-button">
                        Save
                      </button>
                      <button
                        type="button"
                        className="secondary action-button"
                        onClick={() => setEditingProject(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <>
                  <h2 className="sidebar-project-heading">{project.name}</h2>
                  <p className="sidebar-project-path">{project.workspacePath}</p>
                </>
              )}
            </div>
          </div>
          {!isEditingProject ? (
            <div className="sidebar-project-actions">
              <button
                type="button"
                className="secondary action-button"
                onClick={() => setEditingProject({ projectId: project.id, name: project.name })}
              >
                Rename
              </button>
              <span className="pill">{workflowModeLabels[project.workflowMode]}</span>
            </div>
          ) : null}
        </div>

        <section className="sidebar-section">
          <div className="sidebar-section-heading">
            <div>
              <p className="section-label">Sessions</p>
              <strong>{sessions.length} active threads</strong>
            </div>
            <button
              type="button"
              className="secondary sidebar-section-toggle"
              onClick={() =>
                setWorkspaceExpanded((current) => ({
                  ...current,
                  [project.id]: !(current[project.id] ?? true)
                }))
              }
            >
              {isWorkspaceSectionOpen ? "Collapse" : "Expand"}
            </button>
          </div>

          {isWorkspaceSectionOpen ? (
            <>
              <div className="sidebar-project-list">
                {sessions.map((session) => renderSidebarSessionItem(session, project.id))}
              </div>

              <form
                className="new-session-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleCreateSession(project.id, sessionDraft.title)
                }}
              >
                <input
                  value={sessionDraft.title}
                  onChange={(event) => setSessionDraft({ title: event.target.value })}
                  placeholder="New session title"
                />
                <button type="submit" disabled={isCreatingSession}>
                  {isCreatingSession ? "…" : "New"}
                </button>
              </form>
            </>
          ) : null}
        </section>

        <section className="sidebar-section card-quiet sidebar-project-meta-card">
          <p className="section-label">Workspace mode</p>
          <div className="sidebar-meta-grid">
            <div>
              <strong>{projectTypeLabels[project.projectType]}</strong>
              <span>Workspace root stays fixed through the full journey.</span>
            </div>
            <div>
              <strong>{workflowModeLabels[project.workflowMode]}</strong>
              <span>Controls how aggressively the workflow compresses or expands.</span>
            </div>
          </div>
        </section>

        {renderUtilityPanel()}
      </aside>
    )
  }

  const renderSidebar = () => (
    <aside className={`project-sidebar-shell ${layout.sidebarOpen ? "" : "project-sidebar-shell-collapsed"}`}>
      <div className="sidebar-rail card">
        <div className="sidebar-rail-top">
          <button
            type="button"
            className={`rail-button ${shellSurface === "home" ? "rail-button-active" : ""}`}
            onClick={handleReturnHome}
            title="Home"
          >
            ⌂
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={() => patchLayout({ sidebarOpen: !layout.sidebarOpen })}
            title={layout.sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {layout.sidebarOpen ? "«" : "»"}
          </button>
        </div>

        <div className="rail-project-stack">
          {dashboard.projects.map((project) => {
            const isActive = project.id === activeProject?.id && shellSurface === "workspace"

            return (
              <button
                key={project.id}
                type="button"
                className={`rail-project-button ${isActive ? "rail-project-button-active" : ""}`}
                title={project.name}
                onMouseEnter={() => {
                  if (!layout.sidebarOpen) {
                    clearHoverReset()
                    setHoverProjectId(project.id)
                  }
                }}
                onMouseLeave={() => {
                  if (!layout.sidebarOpen) {
                    scheduleHoverReset()
                  }
                }}
                onClick={() => void handleRailProjectClick(project.id)}
              >
                <span className="rail-project-initials" style={getProjectBadgeStyle(project.id)}>
                  {getProjectInitials(project.name)}
                </span>
              </button>
            )
          })}
        </div>

        <div className="rail-footer">
          <button
            type="button"
            className="rail-button"
            onClick={() => openProjectSetup("new_project")}
            title="New project"
          >
            +
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={() => openProjectSetup("existing_codebase")}
            title="Import folder"
          >
            ↗
          </button>
          <button
            type="button"
            className={`rail-button ${utilityPanel === "settings" ? "rail-button-active" : ""}`}
            onClick={() => setUtilityPanel((current) => (current === "settings" ? null : "settings"))}
            title="Settings"
          >
            ⚙
          </button>
          <button
            type="button"
            className={`rail-button ${utilityPanel === "help" ? "rail-button-active" : ""}`}
            onClick={() => setUtilityPanel((current) => (current === "help" ? null : "help"))}
            title="Help"
          >
            ?
          </button>
        </div>
      </div>

      {layout.sidebarOpen ? renderSidebarPanel(visibleSidebarProject) : null}
      {!layout.sidebarOpen && hoverProjectId ? renderSidebarPanel(visibleSidebarProject, true) : null}
    </aside>
  )

  const renderHomeScreen = () => (
    <main className="home-shell">
      <section className="entry-hero card">
        <div className="eyebrow-row">
          <span className="brand-mark">SD</span>
          <span className="eyebrow">Project workspace first</span>
        </div>
        <h1>Choose a workspace root, then run the entire journey against that folder.</h1>
        <p className="hero-copy">
          The left rail owns projects and sessions. The center column becomes the active conversation.
          The right inspector handles review, files, and SDLC state in one place.
        </p>

        <div className="entry-card-grid">
          {entryCards.map((card) => (
            <button
              key={card.projectType}
              type="button"
              className="entry-card"
              onClick={() => openProjectSetup(card.projectType)}
            >
              <div className="entry-card-icon">{card.projectType === "new_project" ? "+" : "↗"}</div>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
              <div className="entry-tag-list">
                {card.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
              <span className="entry-card-cta">Open setup</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="setup-sidebar">
        <section className="card journey-card">
          <p className="section-label">User journey</p>
          <div className="journey-list">
            {journeyStages.map((stage) => (
              <div key={stage} className="journey-row">
                {stage}
              </div>
            ))}
          </div>
        </section>

        <section className="card runtime-card">
          <p className="section-label">Recent projects</p>
          {dashboard.projects.length > 0 ? (
            <div className="sidebar-project-list">
              {dashboard.projects.slice(0, 4).map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="sidebar-project-item"
                  onClick={() => void handleOpenProjectSession(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{projectTypeLabels[project.projectType]}</span>
                  <span>Updated {formatDate(project.updatedAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No local projects yet. Create one from the left rail.</p>
          )}
        </section>
      </aside>
    </main>
  )

  const renderSetupScreen = () => (
    <main className="entry-shell">
      <section className="entry-hero card">
        <div className="eyebrow-row">
          <button type="button" className="back-button secondary" onClick={handleReturnHome}>
            Back
          </button>
          <span className="eyebrow">Project setup</span>
        </div>
        <h1>{projectTypeLabels[entryForm.projectType]}</h1>
        <p className="hero-copy">
          {selectedEntryCard?.description ??
            "Define the workspace and the workflow path before opening the main project view."}
        </p>

        <section className="card-quiet entry-summary-card">
          <div className="panel-header">
            <div>
              <p className="section-label">Selected path</p>
              <h2>{selectedEntryCard?.title ?? projectTypeLabels[entryForm.projectType]}</h2>
            </div>
            <span className="pill accent">
              {entryForm.projectType === "new_project" ? "Create workspace" : "Import workspace"}
            </span>
          </div>
          <div className="entry-tag-list">
            {selectedEntryCard?.tags.map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </div>
        </section>
      </section>

      <aside className="setup-sidebar">
        <section className="card setup-card">
          <div className="panel-header">
            <div>
              <p className="section-label">{projectTypeLabels[entryForm.projectType]}</p>
              <h2>Define the workspace first</h2>
            </div>
            <span className="pill">Finder-backed</span>
          </div>

          <form className="setup-form" onSubmit={handleCreateProject}>
            <label className="field">
              <span>Project name</span>
              <input
                value={entryForm.name}
                onChange={(event) =>
                  setEntryForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder={
                  entryForm.projectType === "new_project"
                    ? "Vendor onboarding workspace"
                    : "Imported vendor portal"
                }
                required
              />
            </label>

            <label className="field">
              <span>
                {entryForm.projectType === "existing_codebase"
                  ? "Project folder"
                  : "Project location"}
              </span>
              <div className="path-field-row">
                <input
                  value={entryForm.workspacePath}
                  onChange={(event) =>
                    setEntryForm((current) => ({
                      ...current,
                      workspacePath: event.target.value
                    }))
                  }
                  placeholder={
                    entryForm.projectType === "existing_codebase"
                      ? "Required. Choose the existing local folder"
                      : "Optional. Choose a parent folder for the new project"
                  }
                  required={entryForm.projectType === "existing_codebase"}
                />
                <button type="button" className="secondary" onClick={handlePickDirectory}>
                  Choose in Finder
                </button>
              </div>
              <p className="field-hint">{describeWorkspaceSelection(entryForm)}</p>
            </label>

            <div className="mode-group">
              <span className="field-label">Workflow mode</span>
              <div className="mode-list">
                {getAvailableModes(entryForm.projectType).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`mode-chip ${entryForm.workflowMode === mode ? "mode-chip-selected" : ""}`}
                    onClick={() =>
                      setEntryForm((current) => ({
                        ...current,
                        workflowMode: mode
                      }))
                    }
                  >
                    {workflowModeLabels[mode]}
                  </button>
                ))}
              </div>
            </div>

            <div className="setup-actions">
              <button type="button" className="secondary" onClick={handleReturnHome}>
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? "Creating…"
                  : entryForm.projectType === "new_project"
                    ? "Create workspace"
                    : "Import workspace"}
              </button>
            </div>
          </form>
        </section>

        <section className="card runtime-card">
          <p className="section-label">Desktop runtime</p>
          {shellInfo ? (
            <ul className="runtime-list">
              <li>{shellInfo.appName}</li>
              <li>Electron {shellInfo.electronVersion}</li>
              <li>Node {shellInfo.nodeVersion}</li>
              <li>{shellInfo.platform}</li>
            </ul>
          ) : (
            <p className="muted">Connecting to desktop runtime…</p>
          )}
        </section>
      </aside>
    </main>
  )

  const renderWorkspaceHeader = () => (
    <header className="workspace-header">
      <div className="workspace-header-main">
        <div>
          <p className="section-label">Active workspace</p>
          <h1>{activeSession?.title ?? activeProject?.name ?? "Workspace"}</h1>
          <p className="workspace-header-copy">
            {activeProject?.name} · {activeSession?.summary ?? "Select a session to start"}
          </p>
        </div>
        <button type="button" className="workspace-search-button secondary">
          Search workspace
        </button>
      </div>
      <div className="workspace-header-meta">
        {activePhase ? <span className={`status status-${activePhase.status}`}>{phaseStatusLabels[activePhase.status]}</span> : null}
        {activePhase ? <span className="pill">{activePhase.name}</span> : null}
        {activeProject ? <span className="pill">{workflowModeLabels[activeProject.workflowMode]}</span> : null}
        <button
          type="button"
          className="secondary action-button"
          onClick={() => patchLayout({ inspectorOpen: !layout.inspectorOpen })}
        >
          {layout.inspectorOpen ? "Hide inspector" : "Show inspector"}
        </button>
      </div>
    </header>
  )

  const renderSessionTimeline = () => (
    <section className="timeline-shell">
      {isWorkspaceLoading ? (
        <div className="timeline-loading">Loading workspace…</div>
      ) : (
        <div className="conversation-scroll">
          {sessionMessages.map((message) => (
            <article key={message.id} className={`thread-card thread-card-${message.role}`}>
              <div className="thread-card-header">
                <span className="message-label">{message.label}</span>
                <span className="thread-card-time">{formatDate(message.createdAt)}</span>
              </div>
              <p>{message.body}</p>
              {message.chips.length > 0 ? (
                <div className="message-chip-row">
                  {message.chips.map((chip) => (
                    <span key={chip} className="pill">
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )

  const renderPromptComposer = () => (
    <form className="prompt-dock" onSubmit={handleSendMessage}>
      <div className="composer-chips">
        {activeProject ? <span className="pill">{projectTypeLabels[activeProject.projectType]}</span> : null}
        {activeProject ? <span className="pill">{workflowModeLabels[activeProject.workflowMode]}</span> : null}
        {activePhase ? <span className="pill accent">{activePhase.name}</span> : null}
        {activeSession ? <span className="pill">{activeSession.kind}</span> : null}
      </div>
      <div className="composer card">
        <textarea
          className="composer-editor"
          value={promptDraft}
          onChange={(event) => setPromptDraft(event.target.value)}
          placeholder="Guide the workflow, ask for a revision, or redirect the current session."
        />
        <div className="composer-footer">
          <div className="composer-footer-main">
            <div className="composer-actions">
              <button
                type="button"
                className={`secondary action-button ${layout.inspectorTab === "review" ? "action-button-active" : ""}`}
                onClick={() => patchLayout({ inspectorOpen: true, inspectorTab: "review" })}
              >
                Review
              </button>
              <button
                type="button"
                className={`secondary action-button ${layout.inspectorTab === "files" ? "action-button-active" : ""}`}
                onClick={() => patchLayout({ inspectorOpen: true, inspectorTab: "files" })}
              >
                Files
              </button>
              <button
                type="button"
                className={`secondary action-button ${layout.inspectorTab === "sdlc" ? "action-button-active" : ""}`}
                onClick={() => patchLayout({ inspectorOpen: true, inspectorTab: "sdlc" })}
              >
                SDLC
              </button>
              {currentPhaseActions.map((action) => (
                <button
                  key={action.status}
                  type="button"
                  className={action.tone === "secondary" ? "secondary action-button" : "action-button"}
                  onClick={() => void handlePhaseStatusUpdate(activePhase!.id, action.status)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" className="composer-send" disabled={isSendingMessage}>
            {isSendingMessage ? "…" : "→"}
          </button>
        </div>
      </div>
    </form>
  )

  const renderReviewPane = () => (
    <div className="inspector-panel-body">
      <div className="inspector-panel-header inspector-panel-header-tight">
        <div>
          <p className="section-label">Changes review</p>
          <h2>{layout.selectedReviewFile ?? "Change set"}</h2>
        </div>
        {layout.selectedReviewFile ? (
          <button
            type="button"
            className="secondary action-button"
            onClick={() => void openFileInInspector(layout.selectedReviewFile!, "files")}
          >
            Open in files
          </button>
        ) : null}
      </div>
      {renderFileBody(
        reviewContent,
        "No review file selected",
        "Choose an artifact from the change set to inspect it here."
      )}
    </div>
  )

  const renderFilesPane = () => (
    <div className="inspector-panel-body">
      <div className="inspector-panel-header inspector-panel-header-tight">
        <div>
          <p className="section-label">Files</p>
          <h2>{layout.activeFileTab ?? "Workspace files"}</h2>
        </div>
      </div>

      {layout.openedFileTabs.length > 0 ? (
        <div className="file-tab-row">
          {layout.openedFileTabs.map((tab) => (
            <div
              key={tab}
              className={`file-tab ${layout.activeFileTab === tab ? "file-tab-active" : ""}`}
            >
              <button
                type="button"
                className="file-tab-button"
                onClick={() => patchLayout({ activeFileTab: tab, inspectorTab: "files", inspectorOpen: true })}
              >
                {tab.split("/").pop()}
              </button>
              <button
                type="button"
                className="file-tab-close"
                onClick={() => closeFileTab(tab)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {renderFileBody(activeFileContent, "Select a file", "Choose a file from the workspace tree to open it here.")}
    </div>
  )

  const renderSdlcPane = () => (
    <div className="inspector-panel-body">
      <div className="inspector-panel-header inspector-panel-header-tight">
        <div>
          <p className="section-label">SDLC</p>
          <h2>{selectedSdlcPhase?.name ?? "Workflow"}</h2>
        </div>
        {selectedSdlcPhase ? (
          <span className={`status status-${selectedSdlcPhase.status}`}>
            {phaseStatusLabels[selectedSdlcPhase.status]}
          </span>
        ) : null}
      </div>

      {selectedSdlcPhase ? (
        <div className="sdlc-summary card-quiet">
          <p>{selectedSdlcPhase.summary}</p>
          <div className="composer-actions">
            {selectedSdlcArtifactPath ? (
              <button
                type="button"
                className="secondary action-button"
                onClick={() => void handleOpenSdlcArtifact(selectedSdlcArtifactPath, "review")}
              >
                Open in review
              </button>
            ) : null}
            {phaseActions(selectedSdlcPhase).map((action) => (
              <button
                key={action.status}
                type="button"
                className={action.tone === "secondary" ? "secondary action-button" : "action-button"}
                onClick={() => void handlePhaseStatusUpdate(selectedSdlcPhase.id, action.status)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {renderFileBody(
        sdlcArtifactContent,
        selectedSdlcArtifactPath ? "Artifact not opened" : "No phase artifact yet",
        selectedSdlcArtifactPath
          ? "Select the phase row in the sidebar to inspect its primary artifact here."
          : "This phase does not have a primary artifact on disk yet."
      )}
    </div>
  )

  const renderInspectorSidebar = () => {
    if (layout.inspectorTab === "sdlc") {
      return (
        <div className="inspector-tree">
          {workflow?.phases.map((phase) => (
            <button
              key={phase.id}
              type="button"
              className={`phase-tree-item ${layout.selectedSdlcPhase === phase.id ? "phase-tree-item-active" : ""}`}
              onClick={() => {
                const phaseArtifactPath = getPhasePrimaryArtifactPath(workflow, phase.id)

                if (phaseArtifactPath) {
                  void handleOpenSdlcArtifact(phaseArtifactPath, "sdlc")
                  patchLayout({
                    selectedSdlcPhase: phase.id
                  })
                  return
                }

                patchLayout({
                  selectedSdlcPhase: phase.id,
                  openedSdlcArtifactPath: null
                })
              }}
            >
              <div className="phase-tree-item-row">
                <span className={`phase-tree-dot phase-tree-dot-${phase.status}`} />
                <strong>{phase.name}</strong>
              </div>
              <span>{phase.status === "approved" ? "Artifact ready" : phaseStatusLabels[phase.status]}</span>
            </button>
          ))}
        </div>
      )
    }

    const sourceEntries = layout.inspectorTab === "review" ? reviewEntries : fileEntries
    const isEmpty = flattenFilePaths(sourceEntries).length === 0

    return isEmpty ? (
      <div className="inspector-empty inspector-empty-sidebar">
        <strong>{layout.inspectorTab === "review" ? "No tracked artifacts" : "No files found"}</strong>
        <p>
          {layout.inspectorTab === "review"
            ? "The current phase has not produced reviewable artifacts yet."
            : "This workspace does not have any readable files yet."}
        </p>
      </div>
    ) : (
      <div className="inspector-tree">{renderWorkspaceTree(sourceEntries, layout.inspectorTab)}</div>
    )
  }

  const renderInspector = () => (
    <aside className="inspector-shell card" style={{ width: `${layout.inspectorWidth}px` }}>
      <div className="inspector-main">
        {layout.inspectorTab === "review" ? renderReviewPane() : null}
        {layout.inspectorTab === "files" ? renderFilesPane() : null}
        {layout.inspectorTab === "sdlc" ? renderSdlcPane() : null}
      </div>

      <div
        className="inspector-sidebar"
        style={{ width: `${layout.reviewSidebarWidth}px` }}
      >
        <div className="inspector-sidebar-header">
          <div className="inspector-tabs">
            <button
              type="button"
              className={`inspector-tab ${layout.inspectorTab === "review" ? "inspector-tab-active" : ""}`}
              onClick={() => patchLayout({ inspectorTab: "review", inspectorOpen: true })}
            >
              {reviewTabLabel}
            </button>
            <button
              type="button"
              className={`inspector-tab ${layout.inspectorTab === "files" ? "inspector-tab-active" : ""}`}
              onClick={() => patchLayout({ inspectorTab: "files", inspectorOpen: true })}
            >
              {fileTabLabel}
            </button>
            <button
              type="button"
              className={`inspector-tab ${layout.inspectorTab === "sdlc" ? "inspector-tab-active" : ""}`}
              onClick={() => patchLayout({ inspectorTab: "sdlc", inspectorOpen: true })}
            >
              SDLC
            </button>
          </div>
        </div>

        {renderInspectorSidebar()}
      </div>
    </aside>
  )

  const renderWorkspace = () => (
    <main className="workspace-layout">
      <section className="workspace-center card">
        {renderWorkspaceHeader()}
        {renderSessionTimeline()}
        {renderPromptComposer()}
      </section>
      {layout.inspectorOpen ? renderInspector() : null}
    </main>
  )

  const renderMainContent = () => {
    if (shellSurface === "setup") {
      return renderSetupScreen()
    }

    if (shellSurface === "workspace" && activeProject) {
      return renderWorkspace()
    }

    return renderHomeScreen()
  }

  if (isLoading) {
    return <div className="loading-screen">Loading desktop workspace…</div>
  }

  return (
    <div className="app-shell">
      {!isElectronRuntime ? (
        <div className="global-banner">
          Electron preload is unavailable, so the app is using browser fallback state.
        </div>
      ) : null}

      {error ? <div className="global-banner global-banner-error">{error}</div> : null}

      <div className={`shell-layout ${layout.sidebarOpen ? "" : "shell-layout-collapsed"}`}>
        {renderSidebar()}
        <div className="shell-content">{renderMainContent()}</div>
      </div>
    </div>
  )
}

export default App
