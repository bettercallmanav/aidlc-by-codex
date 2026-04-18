import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopBridge", {
  getShellInfo: async () => ipcRenderer.invoke("app:get-shell-info")
});
