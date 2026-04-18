import type { IpcMainInvokeEvent } from "electron"
import { createProject, getDashboardData, selectProject, updatePhaseStatus } from "./project-service.js"

type CreateProjectPayload = {
  name: string
  projectType: "new_project" | "existing_codebase"
  workspacePath?: string
}

type UpdatePhasePayload = {
  projectId: string
  phaseId: string
  status: "running" | "review_ready" | "approved" | "changes_requested" | "failed"
}

export const desktopBridgeHandlers = {
  getDashboardData: async (_event: IpcMainInvokeEvent) => getDashboardData(),
  createProject: async (_event: IpcMainInvokeEvent, payload: CreateProjectPayload) =>
    createProject(payload),
  selectProject: async (_event: IpcMainInvokeEvent, projectId: string) => selectProject(projectId),
  updatePhaseStatus: async (_event: IpcMainInvokeEvent, payload: UpdatePhasePayload) =>
    updatePhaseStatus(payload.projectId, payload.phaseId, payload.status)
}
