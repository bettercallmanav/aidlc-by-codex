import { BrowserWindow, dialog, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron"
import { interruptCodexSession } from "./codex-app-server.js"
import {
  archiveSession,
  createProject,
  createSession,
  deleteSession,
  getDashboardData,
  getSessionMessages,
  listWorkspaceEntries,
  readWorkspaceFile,
  renameProject,
  renameSession,
  selectProject,
  selectSession,
  sendSessionMessage,
  updateSessionPreferences,
  updatePhaseStatus
} from "./project-service.js"

type CreateProjectPayload = {
  name: string
  projectType: "new_project" | "existing_codebase"
  workflowMode: "full_sdlc" | "scaffold_first" | "analyze_existing"
  workspacePath?: string
}

type UpdatePhasePayload = {
  projectId: string
  phaseId: string
  status: "running" | "review_ready" | "approved" | "changes_requested" | "failed"
}

type DirectoryPickerPayload = {
  mode: "new_project" | "existing_codebase"
  defaultPath?: string
}

type SessionMessagesPayload = {
  projectId: string
  sessionId: string
}

type SendMessagePayload = SessionMessagesPayload & {
  body: string
}

type UpdateSessionPreferencesPayload = SessionMessagesPayload & {
  selectedModel?: string | null
  selectedAgentId?:
    | "auto"
    | "workspace"
    | "plan"
    | "build"
    | "discovery"
    | "architecture"
    | "journey"
    | "wireframe"
    | "coder"
    | "testing"
    | "devops"
    | "handover"
}

type WorkspaceEntriesPayload = {
  projectId: string
  relativePath?: string
  scope: "all" | "changes"
}

type WorkspaceFilePayload = {
  projectId: string
  relativePath: string
}

export const desktopBridgeHandlers = {
  getDashboardData: async (_event: IpcMainInvokeEvent) => getDashboardData(),
  createProject: async (_event: IpcMainInvokeEvent, payload: CreateProjectPayload) =>
    createProject(payload),
  selectProject: async (_event: IpcMainInvokeEvent, projectId: string) => selectProject(projectId),
  createSession: async (
    _event: IpcMainInvokeEvent,
    payload: { projectId: string; title?: string }
  ) => createSession(payload.projectId, payload.title),
  renameProject: async (
    _event: IpcMainInvokeEvent,
    payload: { projectId: string; name: string }
  ) => renameProject(payload.projectId, payload.name),
  selectSession: async (
    _event: IpcMainInvokeEvent,
    payload: { projectId: string; sessionId: string }
  ) => selectSession(payload.projectId, payload.sessionId),
  renameSession: async (
    _event: IpcMainInvokeEvent,
    payload: { projectId: string; sessionId: string; title: string }
  ) => renameSession(payload.projectId, payload.sessionId, payload.title),
  archiveSession: async (
    _event: IpcMainInvokeEvent,
    payload: { projectId: string; sessionId: string }
  ) => archiveSession(payload.projectId, payload.sessionId),
  deleteSession: async (
    _event: IpcMainInvokeEvent,
    payload: { projectId: string; sessionId: string }
  ) => deleteSession(payload.projectId, payload.sessionId),
  getSessionMessages: async (_event: IpcMainInvokeEvent, payload: SessionMessagesPayload) =>
    getSessionMessages(payload.projectId, payload.sessionId),
  sendSessionMessage: async (_event: IpcMainInvokeEvent, payload: SendMessagePayload) =>
    sendSessionMessage(payload.projectId, payload.sessionId, payload.body),
  updateSessionPreferences: async (
    _event: IpcMainInvokeEvent,
    payload: UpdateSessionPreferencesPayload
  ) =>
    updateSessionPreferences(payload.projectId, payload.sessionId, {
      selectedModel: payload.selectedModel,
      selectedAgentId: payload.selectedAgentId
    }),
  interruptSession: async (_event: IpcMainInvokeEvent, payload: SessionMessagesPayload) =>
    interruptCodexSession(payload.projectId, payload.sessionId),
  listWorkspaceEntries: async (_event: IpcMainInvokeEvent, payload: WorkspaceEntriesPayload) =>
    listWorkspaceEntries(payload.projectId, payload.relativePath, payload.scope),
  readWorkspaceFile: async (_event: IpcMainInvokeEvent, payload: WorkspaceFilePayload) =>
    readWorkspaceFile(payload.projectId, payload.relativePath),
  pickDirectory: async (_event: IpcMainInvokeEvent, payload?: DirectoryPickerPayload) => {
    const parentWindow = BrowserWindow.fromWebContents(_event.sender) ?? undefined
    const options: OpenDialogOptions = {
      title:
        payload?.mode === "existing_codebase"
          ? "Select Existing Project Folder"
          : "Choose Project Location",
      buttonLabel:
        payload?.mode === "existing_codebase" ? "Use This Folder" : "Choose Location",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: payload?.defaultPath?.trim() || undefined
    }
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled) {
      return null
    }

    return result.filePaths[0] ?? null
  },
  updatePhaseStatus: async (_event: IpcMainInvokeEvent, payload: UpdatePhasePayload) =>
    updatePhaseStatus(payload.projectId, payload.phaseId, payload.status)
}
