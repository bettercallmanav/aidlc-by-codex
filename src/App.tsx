import { startTransition, useEffect, useState, type FormEvent } from "react"

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

type WorkflowPhase = {
  id: string
  name: string
  summary: string
  status: PhaseStatus
  lastUpdatedAt: string
}

type WorkflowState = {
  projectId: string
  activePhaseId: string | null
  phases: WorkflowPhase[]
  artifacts: Array<{
    id: string
    phaseId: string
    path: string
    kind: string
    createdAt: string
  }>
}

type DashboardData = {
  projects: ProjectRecord[]
  activeProject: ProjectRecord | null
  workflow: WorkflowState | null
  sessions: SessionRecord[]
  activeSession: SessionRecord | null
}

type EntryFormState = {
  name: string
  projectType: ProjectType
  workflowMode: WorkflowMode
  workspacePath: string
}

type SessionDraftState = {
  title: string
}

type ShellSurface = "home" | "setup" | "workspace"
type DesktopBridge = {
  getShellInfo: () => Promise<ShellInfo>
  getDashboardData: () => Promise<DashboardData>
  createProject: (payload: EntryFormState) => Promise<DashboardData>
  selectProject: (projectId: string) => Promise<DashboardData>
  createSession: (payload: { projectId: string; title: string }) => Promise<DashboardData>
  selectSession: (payload: { projectId: string; sessionId: string }) => Promise<DashboardData>
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

type BrowserStoreState = {
  projects: ProjectRecord[]
  sessions: SessionRecord[]
  workflows: Record<string, WorkflowState>
  activeProjectId: string | null
  activeSessionIdByProject: Record<string, string>
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
  activeSession: null
}

const initialEntryForm: EntryFormState = {
  name: "",
  projectType: "new_project",
  workflowMode: "full_sdlc",
  workspacePath: ""
}

const browserStoreKey = "codex-buildathon-browser-store"

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

const entryCards = [
  {
    projectType: "new_project" as const,
    title: "Create new project",
    description:
      "Start from a blank folder, choose the workflow path, and open the first session inside a structured workspace.",
    tags: ["new product ideas", "greenfield builds", "scaffold generation"]
  },
  {
    projectType: "existing_codebase" as const,
    title: "Import existing folder",
    description:
      "Point the app at a real repo, index the codebase, and let the workflow adapt to what is already there.",
    tags: ["existing codebases", "technical audits", "handover prep"]
  }
]

const journeyStages = [
  "1. Start or import a project",
  "2. Define the workflow mode",
  "3. Open focused sessions inside one workspace",
  "4. Review artifacts and approve the next phase"
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

const buildSessionRecord = (projectId: string, title: string, isFirst = false): SessionRecord => {
  const now = new Date().toISOString()

  return {
    id: createId(),
    projectId,
    title,
    kind: isFirst ? "setup" : "general",
    status: isFirst ? "active" : "idle",
    summary: isFirst
      ? "Initial project setup and workflow kickoff."
      : "Task-focused thread inside the shared project workspace.",
    preview: isFirst
      ? "Use this session to define the project and start the SDLC flow."
      : "Use this session to guide a focused workflow task.",
    createdAt: now,
    updatedAt: now
  }
}

const getEmptyBrowserStore = (): BrowserStoreState => ({
  projects: [],
  sessions: [],
  workflows: {},
  activeProjectId: null,
  activeSessionIdByProject: {}
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

const buildDashboardData = (store: BrowserStoreState): DashboardData => {
  const activeProject =
    store.projects.find((project) => project.id === store.activeProjectId) ?? null
  const sessions = activeProject
    ? store.sessions.filter((session) => session.projectId === activeProject.id)
    : []
  const activeSession = activeProject
    ? sessions.find((session) => session.id === store.activeSessionIdByProject[activeProject.id]) ??
      sessions[0] ??
      null
    : null

  return {
    projects: store.projects,
    activeProject,
    workflow: activeProject ? store.workflows[activeProject.id] ?? null : null,
    sessions,
    activeSession
  }
}

const fallbackShellInfo: ShellInfo = {
  appName: "Codex Buildathon (Browser Fallback)",
  electronVersion: "Unavailable",
  chromeVersion:
    typeof navigator !== "undefined" ? navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "Web" : "Web",
  nodeVersion: "Unavailable",
  platform: typeof navigator !== "undefined" ? navigator.platform : "browser"
}

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
    const initialSession = buildSessionRecord(projectId, "Project setup", true)

    store.projects = [...store.projects, project]
    store.sessions = [...store.sessions, initialSession]
    store.workflows[projectId] = buildInitialWorkflowState(projectId)
    store.activeProjectId = projectId
    store.activeSessionIdByProject[projectId] = initialSession.id
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
    const nextSession = buildSessionRecord(projectId, title.trim() || "New session")

    store.sessions = store.sessions
      .map((session) =>
        session.projectId === projectId && session.id === store.activeSessionIdByProject[projectId]
          ? { ...session, status: "idle" as const }
          : session
      )
      .concat({ ...nextSession, status: "active" })
    store.activeSessionIdByProject[projectId] = nextSession.id
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
    writeBrowserStore(store)
    return buildDashboardData(store)
  },
  pickDirectory: async () => null
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

const getBridge = (): DesktopBridge => window.desktopBridge ?? fallbackBridge

const getAvailableModes = (projectType: ProjectType): WorkflowMode[] =>
  projectType === "existing_codebase"
    ? ["analyze_existing", "full_sdlc", "scaffold_first"]
    : ["full_sdlc", "scaffold_first", "analyze_existing"]

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

const getArtifactCopy = (
  project: ProjectRecord,
  workflow: WorkflowState,
  activePhase: WorkflowPhase | null,
  activeSession: SessionRecord | null
) => {
  const artifactName = activePhase ? phaseArtifactMap[activePhase.id] : "workspace-overview.md"

  if (!activePhase) {
    return {
      artifactName,
      headline: "The project workflow is complete.",
      body:
        "The artifact archive now holds the project history, and sessions can still reopen individual work areas for follow-up.",
      bullets: [
        "Review the handover package",
        "Open a new session for follow-up work",
        "Use the artifact archive as the source of truth"
      ]
    }
  }

  if (workflow.activePhaseId === "discovery") {
    return {
      artifactName,
      headline: `${project.name} workspace`,
      body:
        project.workflowMode === "analyze_existing"
          ? "The imported codebase is being translated into a shared understanding of modules, risks, and the next best workflow step."
          : "A local-first workspace that helps teams structure work, preserve artifacts, and guide the project from rough brief to reliable handover.",
      bullets: [
        "Clarify actors, approvals, and handoff expectations",
        "Define what must be true before Architecture begins",
        "Capture assumptions directly in the artifact, not only in chat"
      ]
    }
  }

  if (workflow.activePhaseId === "architecture") {
    return {
      artifactName,
      headline: "Architecture options are now in focus.",
      body:
        "Discovery has created enough clarity to move into modules, APIs, and infrastructure assumptions without losing project context.",
      bullets: [
        "Select a stack and deployment shape",
        "Surface open questions before implementation starts",
        "Keep Architecture tied to the approved requirements"
      ]
    }
  }

  if (project.workflowMode === "scaffold_first") {
    return {
      artifactName,
      headline: "This workspace is optimizing for a faster scaffold-first route.",
      body:
        "The early flow is compressed so the user gets implementation structure quickly without losing the project-wide workflow trail.",
      bullets: [
        "Discovery lite preserves the user goal",
        "Architecture lite narrows the starter stack",
        "Starter code outputs become the main deliverable"
      ]
    }
  }

  return {
    artifactName,
    headline: activeSession?.title ?? activePhase.name,
    body: activeSession?.preview ?? activePhase.summary,
    bullets: [
      "Use the artifact panel as the review surface",
      "Keep approval logic in the workflow column",
      "Let sessions separate tasks without splitting project state"
    ]
  }
}

const getConversationCopy = (
  project: ProjectRecord,
  workflow: WorkflowState,
  activeSession: SessionRecord | null
) => {
  const phaseName =
    workflow.phases.find((phase) => phase.id === workflow.activePhaseId)?.name ?? "Handover"

  if (project.workflowMode === "analyze_existing") {
    return {
      userPrompt:
        "Import this repo, tell me what exists already, and suggest the shortest path to get it delivery-ready.",
      assistantReply:
        "I’m indexing the imported workspace and will open focused sessions for architecture, testing, or handover work once the repo shape is clear.",
      quickActions: ["Index codebase", "Open intake summary", "Suggest next phase"]
    }
  }

  if (project.workflowMode === "scaffold_first") {
    return {
      userPrompt:
        "Start with a scaffold. I still want the workflow to keep artifacts, but I need usable structure quickly.",
      assistantReply:
        "I’m compressing Discovery and Architecture into a faster kickoff so the starter code and file plan become the first concrete output.",
      quickActions: ["Start scaffold", "Open starter plan", "See full workflow"]
    }
  }

  return {
    userPrompt:
      activeSession?.kind === "architecture"
        ? "Explore the architecture choices that follow from the approved requirements."
        : "Build a project workspace where approvals, artifacts, and handoffs are first-class parts of delivery.",
    assistantReply: `I’m using the ${phaseName} phase to keep the artifact and the workflow state aligned. The chat can clarify decisions, but the project state remains shared across sessions.`,
    quickActions: ["Start Discovery", "Approve phase", "Request changes"]
  }
}

function App() {
  const isElectronRuntime =
    window.__CODEX_BUILDATHON__?.runtime === "electron" || Boolean(window.desktopBridge)
  const [shellInfo, setShellInfo] = useState<ShellInfo | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [entryForm, setEntryForm] = useState<EntryFormState>(initialEntryForm)
  const [shellSurface, setShellSurface] = useState<ShellSurface>("home")
  const [sessionDraft, setSessionDraft] = useState<SessionDraftState>({ title: "" })
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    refreshDashboard()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard")
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

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
        setShellSurface("workspace")
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create project")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSelectProject = async (projectId: string) => {
    const bridge = getBridge()

    setError(null)

    try {
      const nextDashboard = await bridge.selectProject(projectId)
      startTransition(() => {
        setDashboard(nextDashboard)
        setShellSurface("workspace")
      })
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "Unable to switch project")
    }
  }

  const handleCreateSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const bridge = getBridge()
    const activeProject = dashboard.activeProject

    if (!activeProject) {
      setError("Project is not available")
      return
    }

    setIsCreatingSession(true)
    setError(null)

    try {
      const nextDashboard = await bridge.createSession({
        projectId: activeProject.id,
        title: sessionDraft.title
      })

      startTransition(() => {
        setDashboard(nextDashboard)
        setSessionDraft({ title: "" })
      })
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Unable to create session")
    } finally {
      setIsCreatingSession(false)
    }
  }

  const handleSelectSession = async (sessionId: string) => {
    const bridge = getBridge()
    const activeProject = dashboard.activeProject

    if (!activeProject) {
      setError("Project is not available")
      return
    }

    setError(null)

    try {
      const nextDashboard = await bridge.selectSession({
        projectId: activeProject.id,
        sessionId
      })

      startTransition(() => {
        setDashboard(nextDashboard)
      })
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : "Unable to open session")
    }
  }

  const handlePhaseStatusUpdate = async (
    phaseId: string,
    status: Exclude<PhaseStatus, "not_started">
  ) => {
    const bridge = getBridge()
    const activeProject = dashboard.activeProject

    if (!activeProject) {
      setError("Project is not available")
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
    setShellSurface("home")
  }

  const activeProject = dashboard.activeProject
  const workflow = dashboard.workflow
  const activeSession = dashboard.activeSession
  const selectedEntryCard = entryCards.find((card) => card.projectType === entryForm.projectType)
  const activePhase =
    workflow?.phases.find((phase) => phase.id === workflow.activePhaseId) ??
    workflow?.phases.find((phase) => phase.status === "review_ready" || phase.status === "changes_requested") ??
    null
  const currentPhaseActions = phaseActions(activePhase)
  const artifactCopy =
    activeProject && workflow
      ? getArtifactCopy(activeProject, workflow, activePhase, activeSession)
      : null
  const conversationCopy =
    activeProject && workflow ? getConversationCopy(activeProject, workflow, activeSession) : null

  const renderHomeScreen = () => (
    <main className="home-shell">
      <section className="entry-hero card">
        <div className="eyebrow-row">
          <span className="brand-mark">SD</span>
          <span className="eyebrow">Workspace directory first</span>
        </div>
        <h1>Choose a project from the left, or open a new workspace from Finder.</h1>
        <p className="hero-copy">
          Following the `tauri embos` pattern, the left sidebar is now the control surface for
          projects. The main area stays neutral until you explicitly create, import, or reopen a
          workspace.
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
          <p className="section-label">Project navigation</p>
          <div className="journey-list">
            <div className="journey-row">Use the sidebar to reopen any saved project.</div>
            <div className="journey-row">Create new projects by choosing a parent location in Finder.</div>
            <div className="journey-row">Import existing folders to keep one workspace root through the full workflow.</div>
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
                  onClick={() => handleSelectProject(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{projectTypeLabels[project.projectType]}</span>
                  <span>Updated {formatDate(project.updatedAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No local projects yet. Start one from the sidebar actions.</p>
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

        <section className="card-quiet journey-card">
          <p className="section-label">Journey</p>
          <div className="journey-list">
            {journeyStages.map((stage) => (
              <div key={stage} className="journey-row">
                {stage}
              </div>
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

  const renderWorkspace = () => {
    if (!activeProject || !workflow || !artifactCopy || !conversationCopy) {
      return null
    }

    return (
      <main className="workspace-shell">
        <section className="conversation-panel card">
          <div className="conversation-header">
            <div>
              <h1>{activeProject.name}</h1>
              <p className="muted conversation-summary">
                {activeSession?.summary} Workspace root: {activeProject.workspacePath}
              </p>
            </div>
            <span className="pill accent">{workflowModeLabels[activeProject.workflowMode]}</span>
          </div>

          <div className="session-stack">
            <div className="panel-header">
              <p className="section-label">Sessions</p>
              <span className="pill">{dashboard.sessions.length}</span>
            </div>
            <div className="session-list">
              {dashboard.sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`session-item ${
                    session.id === activeSession?.id ? "session-item-active" : ""
                  }`}
                  onClick={() => handleSelectSession(session.id)}
                >
                  <strong>{session.title}</strong>
                  <span>{session.preview}</span>
                </button>
              ))}
            </div>

            <form className="new-session-form" onSubmit={handleCreateSession}>
              <input
                value={sessionDraft.title}
                onChange={(event) => setSessionDraft({ title: event.target.value })}
                placeholder="New session title"
              />
              <button type="submit" disabled={isCreatingSession}>
                {isCreatingSession ? "Adding…" : "New session"}
              </button>
            </form>
          </div>

          <div className="conversation-thread">
            <div className="message-bubble message-user">
              <span className="message-label">You</span>
              <p>{conversationCopy.userPrompt}</p>
            </div>
            <div className="message-bubble message-assistant">
              <span className="message-label">Workspace assistant</span>
              <p>{conversationCopy.assistantReply}</p>
            </div>
            <div className="message-bubble message-actions">
              <span className="message-label">Quick actions</span>
              <div className="quick-action-list">
                {conversationCopy.quickActions.map((action) => (
                  <span key={action} className="tag">
                    {action}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="composer card-quiet">
            <p className="muted">
              Ask the workspace to clarify scope, revise the artifact, or continue the workflow…
            </p>
            <div className="composer-footer">
              <div className="composer-chips">
                <span className="tag">@artifact</span>
                <span className="tag">@workflow</span>
              </div>
              <button type="button" className="composer-send">
                ↑
              </button>
            </div>
          </div>
        </section>

        <section className="artifact-panel card">
          <div className="artifact-header">
            <div>
              <p className="section-label">Active artifact</p>
              <h2>{artifactCopy.artifactName}</h2>
            </div>
            <div className="artifact-tabs">
              <span className="pill pill-dark">Document</span>
              <span className="pill">JSON</span>
              <span className="pill">Logs</span>
            </div>
          </div>

          <div className="artifact-surface">
            <h3>{artifactCopy.headline}</h3>
            <p>{artifactCopy.body}</p>

            <div className="artifact-list">
              {artifactCopy.bullets.map((item) => (
                <div key={item} className="artifact-list-item">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="workflow-panel card">
          <div>
            <p className="section-label">Workflow status</p>
            <h2>{activePhase ? `${activePhase.name} is active` : "Workflow complete"}</h2>
          </div>

          <div className="phase-list">
            {workflow.phases.map((phase) => (
              <div
                key={phase.id}
                className={`phase-item ${phase.id === workflow.activePhaseId ? "phase-item-active" : ""}`}
              >
                <div className="phase-row">
                  <strong>{phase.name}</strong>
                  <span className={`status status-${phase.status}`}>{phaseStatusLabels[phase.status]}</span>
                </div>
                <p>{phase.summary}</p>
              </div>
            ))}
          </div>

          {currentPhaseActions.length > 0 ? (
            <div className="workflow-actions card-quiet">
              <p className="section-label">Review choices</p>
              <div className="stack-actions">
                {currentPhaseActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className={action.tone === "secondary" ? "secondary" : ""}
                    onClick={() => activePhase && handlePhaseStatusUpdate(activePhase.id, action.status)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="workflow-note card-quiet">
            <p className="section-label">Project-level state</p>
            <p className="muted">
              {dashboard.sessions.length} sessions open, {workflow.artifacts.length} tracked artifacts,
              last updated {formatDate(activeProject.updatedAt)}.
            </p>
            <p className="muted workspace-path">{activeProject.workspacePath}</p>
          </div>
        </aside>
      </main>
    )
  }

  const renderSidebar = () => (
    <aside className="project-sidebar card">
      <button type="button" className="sidebar-home-button" onClick={handleReturnHome}>
        <span className="brand-mark">SD</span>
        <div>
          <strong>Codex Buildathon</strong>
          <p className="muted sidebar-caption">Projects and workspaces</p>
        </div>
      </button>

      <div className="sidebar-action-stack">
        <button
          type="button"
          className={`sidebar-action ${shellSurface === "setup" && entryForm.projectType === "new_project" ? "sidebar-action-active" : ""}`}
          onClick={() => openProjectSetup("new_project")}
        >
          <span className="sidebar-action-title">New project</span>
          <span className="sidebar-action-copy">Create a new folder-backed workspace.</span>
        </button>
        <button
          type="button"
          className={`sidebar-action ${shellSurface === "setup" && entryForm.projectType === "existing_codebase" ? "sidebar-action-active" : ""}`}
          onClick={() => openProjectSetup("existing_codebase")}
        >
          <span className="sidebar-action-title">Import folder</span>
          <span className="sidebar-action-copy">Attach an existing repo or project folder.</span>
        </button>
      </div>

      <div className="sidebar-section">
        <div className="panel-header">
          <p className="section-label">Projects</p>
          <span className="pill">{dashboard.projects.length}</span>
        </div>

        {dashboard.projects.length > 0 ? (
          <div className="sidebar-project-list">
            {dashboard.projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`sidebar-project-item ${
                  shellSurface === "workspace" && activeProject?.id === project.id
                    ? "sidebar-project-item-active"
                    : ""
                }`}
                onClick={() => handleSelectProject(project.id)}
              >
                <strong>{project.name}</strong>
                <span>{projectTypeLabels[project.projectType]}</span>
                <span>{workflowModeLabels[project.workflowMode]}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No projects yet. Use the actions above to create or import one.</p>
        )}
      </div>

      <section className="card-quiet sidebar-runtime">
        <p className="section-label">Runtime</p>
        {shellInfo ? (
          <ul className="runtime-list">
            <li>{shellInfo.appName}</li>
            <li>Electron {shellInfo.electronVersion}</li>
            <li>Node {shellInfo.nodeVersion}</li>
          </ul>
        ) : (
          <p className="muted">Connecting to desktop runtime…</p>
        )}
      </section>
    </aside>
  )

  const renderMainContent = () => {
    if (isLoading) {
      return <div className="loading-screen">Loading workspace…</div>
    }

    if (shellSurface === "setup") {
      return renderSetupScreen()
    }

    if (shellSurface === "workspace" && activeProject) {
      return renderWorkspace()
    }

    return renderHomeScreen()
  }

  return (
    <div className="app-shell">
      {!isElectronRuntime ? (
        <div className="global-banner">
          Electron preload is unavailable, so the app is using browser fallback state. Open it
          through Electron for filesystem-backed project storage.
        </div>
      ) : null}
      {error ? <div className="global-banner">{error}</div> : null}
      <div className="shell-layout">
        {renderSidebar()}
        <div className="shell-content">{renderMainContent()}</div>
      </div>
    </div>
  )
}

export default App
