import { startTransition, useEffect, useState, type FormEvent } from "react"

type ShellInfo = {
  appName: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
}

type ProjectType = "new_project" | "existing_codebase"
type PhaseStatus =
  | "not_started"
  | "running"
  | "review_ready"
  | "approved"
  | "changes_requested"
  | "failed"

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
}

declare global {
  interface Window {
    desktopBridge?: {
      getShellInfo: () => Promise<ShellInfo>
      getDashboardData: () => Promise<DashboardData>
      createProject: (payload: {
        name: string
        projectType: ProjectType
        workspacePath?: string
      }) => Promise<DashboardData>
      selectProject: (projectId: string) => Promise<DashboardData>
      updatePhaseStatus: (payload: {
        projectId: string
        phaseId: string
        status: Exclude<PhaseStatus, "not_started">
      }) => Promise<DashboardData>
    }
  }
}

const emptyDashboard: DashboardData = {
  projects: [],
  activeProject: null,
  workflow: null
}

const initialForm = {
  name: "",
  projectType: "new_project" as ProjectType,
  workspacePath: ""
}

const statusLabels: Record<PhaseStatus, string> = {
  not_started: "Not started",
  running: "Running",
  review_ready: "Review ready",
  approved: "Approved",
  changes_requested: "Changes requested",
  failed: "Failed"
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value))

const phaseActions = (phase: WorkflowPhase, isActive: boolean) => {
  if (!isActive) {
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

export default function App() {
  const [shellInfo, setShellInfo] = useState<ShellInfo | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [form, setForm] = useState(initialForm)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshDashboard = async () => {
    const bridge = window.desktopBridge

    if (!bridge) {
      throw new Error("Electron bridge not available")
    }

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

  const handleRefreshDashboard = async () => {
    setError(null)

    try {
      await refreshDashboard()
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh dashboard")
    }
  }

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const bridge = window.desktopBridge

    if (!bridge) {
      setError("Electron bridge not available")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const nextDashboard = await bridge.createProject({
        name: form.name,
        projectType: form.projectType,
        workspacePath: form.workspacePath || undefined
      })

      startTransition(() => {
        setDashboard(nextDashboard)
        setForm(initialForm)
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create project")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSelectProject = async (projectId: string) => {
    const bridge = window.desktopBridge

    if (!bridge) {
      setError("Electron bridge not available")
      return
    }

    setError(null)

    try {
      const nextDashboard = await bridge.selectProject(projectId)
      startTransition(() => {
        setDashboard(nextDashboard)
      })
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "Unable to open project")
    }
  }

  const handlePhaseStatusUpdate = async (
    phaseId: string,
    status: Exclude<PhaseStatus, "not_started">
  ) => {
    const bridge = window.desktopBridge
    const activeProject = dashboard.activeProject

    if (!bridge || !activeProject) {
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

  const activeProject = dashboard.activeProject
  const workflow = dashboard.workflow
  const activePhase = workflow?.phases.find((phase) => phase.id === workflow.activePhaseId) ?? null

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-stack">
          <div>
            <p className="eyebrow">Codex Buildathon</p>
            <h1>SDLC Orchestrator</h1>
            <p className="muted">
              Local-first desktop control plane for gated software delivery workflows.
            </p>
          </div>

          <section className="sidebar-block">
            <div className="panel-header">
              <p className="section-label">Projects</p>
              <span className="pill">{dashboard.projects.length}</span>
            </div>
            {dashboard.projects.length > 0 ? (
              <div className="project-list">
                {dashboard.projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={`project-list-item ${
                      project.id === activeProject?.id ? "project-list-item-active" : ""
                    }`}
                    onClick={() => handleSelectProject(project.id)}
                  >
                    <span>{project.name}</span>
                    <span className="project-meta">
                      {project.projectType === "new_project" ? "New project" : "Existing codebase"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No projects yet. Create the first workspace from the form.</p>
            )}
          </section>
        </div>

        <section className="sidebar-block">
          <p className="section-label">Desktop runtime</p>
          {shellInfo ? (
            <ul className="runtime-list">
              <li>{shellInfo.appName}</li>
              <li>Electron {shellInfo.electronVersion}</li>
              <li>Node {shellInfo.nodeVersion}</li>
              <li>{shellInfo.platform}</li>
            </ul>
          ) : (
            <p className="muted">Connecting to Electron runtime...</p>
          )}
        </section>
      </aside>

      <main className="main-panel">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Phase 2 workflow layer</p>
            <h2>Projects, workspaces, and phase state now live locally</h2>
          </div>
          <p className="hero-copy">
            This step adds local project creation, workspace initialization, and manual workflow
            gating so the desktop shell behaves like a real product.
          </p>
          <form className="project-form" onSubmit={handleCreateProject}>
            <label className="field">
              <span>Project name</span>
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Acme sprint planner"
                required
              />
            </label>

            <label className="field">
              <span>Project type</span>
              <select
                value={form.projectType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    projectType: event.target.value as ProjectType
                  }))
                }
              >
                <option value="new_project">New project</option>
                <option value="existing_codebase">Existing codebase</option>
              </select>
            </label>

            <label className="field field-wide">
              <span>Workspace path</span>
              <input
                value={form.workspacePath}
                onChange={(event) =>
                  setForm((current) => ({ ...current, workspacePath: event.target.value }))
                }
                placeholder="Optional. Defaults to Documents/Codex Buildathon Projects/<slug>"
              />
            </label>

            <div className="hero-actions">
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create project"}
              </button>
              <button type="button" className="secondary" onClick={handleRefreshDashboard}>
                Refresh dashboard
              </button>
            </div>
          </form>

          {error ? <p className="message message-error">{error}</p> : null}
          {isLoading ? <p className="message">Loading local workspace state...</p> : null}
        </section>

        <section className="panel-grid">
          <article className="panel">
            <div className="panel-header">
              <p className="section-label">Active project</p>
              <span className="pill">{activeProject ? activeProject.slug : "No project"}</span>
            </div>
            {activeProject && workflow ? (
              <div className="details-grid">
                <div className="detail-card">
                  <span className="detail-label">Workspace</span>
                  <code>{activeProject.workspacePath}</code>
                </div>
                <div className="detail-card">
                  <span className="detail-label">Workflow store</span>
                  <code>{activeProject.workflowPath}</code>
                </div>
                <div className="detail-card">
                  <span className="detail-label">Current phase</span>
                  <strong>{activePhase?.name ?? "Completed"}</strong>
                </div>
                <div className="detail-card">
                  <span className="detail-label">Artifacts tracked</span>
                  <strong>{workflow.artifacts.length}</strong>
                </div>
                <div className="detail-card">
                  <span className="detail-label">Created</span>
                  <strong>{formatDate(activeProject.createdAt)}</strong>
                </div>
                <div className="detail-card">
                  <span className="detail-label">Updated</span>
                  <strong>{formatDate(activeProject.updatedAt)}</strong>
                </div>
              </div>
            ) : (
              <p className="muted">
                Create a project to initialize `.project-workflow`, seed the eight SDLC phases, and
                persist local state.
              </p>
            )}
          </article>

          <article className="panel">
            <div className="panel-header">
              <p className="section-label">Workflow summary</p>
              <span className="pill">{workflow?.phases.length ?? 0} phases</span>
            </div>
            <ul className="feature-list">
              <li>Projects are persisted locally through the Electron main process.</li>
              <li>Each project gets a `.project-workflow` directory and `workflow-state.json`.</li>
              <li>Discovery starts as the active phase and later phases unlock on approval.</li>
              <li>Phase cards below let you simulate review, approval, failure, and resume flows.</li>
            </ul>
          </article>
        </section>

        <section className="panel">
          <div className="panel-header">
            <p className="section-label">Pipeline</p>
            <span className="pill">{activePhase ? `${activePhase.name} active` : "All approved"}</span>
          </div>

          {workflow ? (
            <div className="phase-list">
              {workflow.phases.map((phase) => {
                const isActive = phase.id === workflow.activePhaseId
                const actions = phaseActions(phase, isActive)

                return (
                  <div key={phase.id} className="phase-card">
                    <div className="phase-topline">
                      <div>
                        <h3>{phase.name}</h3>
                        <p className="phase-copy">{phase.summary}</p>
                      </div>
                      <div className="phase-statuses">
                        {isActive ? <span className="pill accent">Current</span> : null}
                        <span className={`status status-${phase.status}`}>
                          {statusLabels[phase.status]}
                        </span>
                      </div>
                    </div>

                    <div className="phase-footer">
                      <span className="phase-updated">
                        Updated {formatDate(phase.lastUpdatedAt)}
                      </span>
                      {actions.length > 0 ? (
                        <div className="phase-actions">
                          {actions.map((action) => (
                            <button
                              key={action.label}
                              type="button"
                              className={action.tone === "secondary" ? "secondary" : ""}
                              onClick={() => handlePhaseStatusUpdate(phase.id, action.status)}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="muted">No workflow seeded yet.</p>
          )}
        </section>
      </main>
    </div>
  )
}
