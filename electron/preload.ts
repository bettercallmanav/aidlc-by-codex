import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("desktopBridge", {
  getShellInfo: async () => ipcRenderer.invoke("app:get-shell-info"),
  getDashboardData: async () => ipcRenderer.invoke("project:get-dashboard-data"),
  createProject: async (payload: {
    name: string
    projectType: "new_project" | "existing_codebase"
    workspacePath?: string
  }) => ipcRenderer.invoke("project:create", payload),
  selectProject: async (projectId: string) => ipcRenderer.invoke("project:select", projectId),
  updatePhaseStatus: async (payload: {
    projectId: string
    phaseId: string
    status: "running" | "review_ready" | "approved" | "changes_requested" | "failed"
  }) => ipcRenderer.invoke("workflow:update-phase-status", payload)
})
