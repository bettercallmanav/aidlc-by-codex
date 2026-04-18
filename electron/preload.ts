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
  renameProject: async (payload: { projectId: string; name: string }) =>
    ipcRenderer.invoke("project:rename", payload),
  selectSession: async (payload: { projectId: string; sessionId: string }) =>
    ipcRenderer.invoke("session:select", payload),
  renameSession: async (payload: { projectId: string; sessionId: string; title: string }) =>
    ipcRenderer.invoke("session:rename", payload),
  archiveSession: async (payload: { projectId: string; sessionId: string }) =>
    ipcRenderer.invoke("session:archive", payload),
  deleteSession: async (payload: { projectId: string; sessionId: string }) =>
    ipcRenderer.invoke("session:delete", payload),
  getSessionMessages: async (payload: { projectId: string; sessionId: string }) =>
    ipcRenderer.invoke("session:get-messages", payload),
  sendSessionMessage: async (payload: {
    projectId: string
    sessionId: string
    body: string
  }) => ipcRenderer.invoke("session:send-message", payload),
  listWorkspaceEntries: async (payload: {
    projectId: string
    relativePath?: string
    scope: "all" | "changes"
  }) => ipcRenderer.invoke("workspace:list-entries", payload),
  readWorkspaceFile: async (payload: { projectId: string; relativePath: string }) =>
    ipcRenderer.invoke("workspace:read-file", payload),
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
