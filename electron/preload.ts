import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("__CODEX_BUILDATHON__", {
  runtime: "electron",
  bridgeName: "desktopBridge"
})

contextBridge.exposeInMainWorld("desktopBridge", {
  getShellInfo: async () => ipcRenderer.invoke("app:get-shell-info"),
  getDashboardData: async () => ipcRenderer.invoke("project:get-dashboard-data"),
  createProject: async (payload: {
    name: string
    projectType: "new_project" | "existing_codebase"
    workflowMode: "full_sdlc" | "scaffold_first" | "analyze_existing"
    workspacePath?: string
  }) => ipcRenderer.invoke("project:create", payload),
  selectProject: async (projectId: string) => ipcRenderer.invoke("project:select", projectId),
  createSession: async (payload: { projectId: string; title: string }) =>
    ipcRenderer.invoke("session:create", payload),
  selectSession: async (payload: { projectId: string; sessionId: string }) =>
    ipcRenderer.invoke("session:select", payload),
  pickDirectory: async (payload: {
    mode: "new_project" | "existing_codebase"
    defaultPath?: string
  }) => ipcRenderer.invoke("directory:pick", payload),
  updatePhaseStatus: async (payload: {
    projectId: string
    phaseId: string
    status: "running" | "review_ready" | "approved" | "changes_requested" | "failed"
  }) => ipcRenderer.invoke("workflow:update-phase-status", payload)
})
