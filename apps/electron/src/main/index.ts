import { app, BrowserWindow, ipcMain } from "electron"
import path from "node:path"
import { RPC_CHANNEL } from "@worth/ipc"
import { makeRpcHandler } from "./rpc"
import { createAppRuntime } from "./runtime"

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.on("ready-to-show", () => win.show())

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"]
  if (rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
}

const dbPath = (): string => {
  const override = process.env["WORTH_DB_PATH"]
  if (override) return override
  return path.join(app.getPath("userData"), "worth.db")
}

app.whenReady().then(() => {
  const runtime = createAppRuntime(dbPath())
  const handleRpc = makeRpcHandler(runtime)

  ipcMain.handle(RPC_CHANNEL, async (_event, request: unknown) => handleRpc(request))

  app.on("before-quit", () => {
    void runtime.dispose()
  })

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
