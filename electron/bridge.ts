import { BrowserWindow, dialog, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron"
import {
  createProject,
  createSession,
  getDashboardData,
  selectProject,
  selectSession,
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

export const desktopBridgeHandlers = {
  getDashboardData: async (_event: IpcMainInvokeEvent) => getDashboardData(),
  createProject: async (_event: IpcMainInvokeEvent, payload: CreateProjectPayload) =>
    createProject(payload),
  selectProject: async (_event: IpcMainInvokeEvent, projectId: string) => selectProject(projectId),
  createSession: async (
    _event: IpcMainInvokeEvent,
    payload: { projectId: string; title: string }
  ) => createSession(payload.projectId, payload.title),
  selectSession: async (
    _event: IpcMainInvokeEvent,
    payload: { projectId: string; sessionId: string }
  ) => selectSession(payload.projectId, payload.sessionId),
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
