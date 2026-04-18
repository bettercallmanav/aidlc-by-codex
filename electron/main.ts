import { app, BrowserWindow, ipcMain } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { desktopBridgeHandlers } from "./bridge.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f6f1e8",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.webContents.on("did-finish-load", () => {
    void window.webContents
      .executeJavaScript(
        `({
          href: window.location.href,
          hasDesktopBridge: Boolean(window.desktopBridge),
          runtime: window.__CODEX_BUILDATHON__ ?? null
        })`,
        true
      )
      .then((result) => {
        console.log("[bridge-check]", result)
      })
      .catch((error) => {
        console.error("[bridge-check:error]", error)
      })
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    await window.loadURL(devServerUrl)
    return
  }

  await window.loadFile(path.join(app.getAppPath(), "dist", "index.html"))
}

app.whenReady().then(async () => {
  ipcMain.handle("app:get-shell-info", () => {
    return {
      appName: app.getName(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform
    }
  })

  ipcMain.handle("project:get-dashboard-data", desktopBridgeHandlers.getDashboardData)
  ipcMain.handle("project:create", desktopBridgeHandlers.createProject)
  ipcMain.handle("project:select", desktopBridgeHandlers.selectProject)
  ipcMain.handle("project:rename", desktopBridgeHandlers.renameProject)
  ipcMain.handle("session:create", desktopBridgeHandlers.createSession)
  ipcMain.handle("session:select", desktopBridgeHandlers.selectSession)
  ipcMain.handle("session:rename", desktopBridgeHandlers.renameSession)
  ipcMain.handle("session:archive", desktopBridgeHandlers.archiveSession)
  ipcMain.handle("session:delete", desktopBridgeHandlers.deleteSession)
  ipcMain.handle("session:get-messages", desktopBridgeHandlers.getSessionMessages)
  ipcMain.handle("session:send-message", desktopBridgeHandlers.sendSessionMessage)
  ipcMain.handle("workspace:list-entries", desktopBridgeHandlers.listWorkspaceEntries)
  ipcMain.handle("workspace:read-file", desktopBridgeHandlers.readWorkspaceFile)
  ipcMain.handle("directory:pick", desktopBridgeHandlers.pickDirectory)
  ipcMain.handle("workflow:update-phase-status", desktopBridgeHandlers.updatePhaseStatus)

  await createWindow()

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
