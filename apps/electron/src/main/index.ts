import { app, BrowserWindow, ipcMain } from "electron"
import path from "node:path"
import { Effect } from "effect"
import { RPC_CHANNEL } from "@worth/ipc"
import { makeRpcHandler } from "./rpc"
import { makeVaultController } from "./vault"
import { Updater } from "./updater"

const createWindow = (): BrowserWindow => {
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
  return win
}

const dbPath = (): string => {
  const override = process.env["WORTH_DB_PATH"]
  if (override) return override
  return path.join(app.getPath("userData"), "worth.db")
}

let updateCheckScheduled = false

app.whenReady().then(() => {
  const vault = makeVaultController(dbPath())
  const handleRpc = makeRpcHandler(vault)

  ipcMain.handle(RPC_CHANNEL, async (_event, request: unknown) => {
    const response = await handleRpc(request)
    // Kick off a deferred update check the first time the vault is unlocked.
    // We gate the updater on unlock because it lives inside the app runtime.
    if (!updateCheckScheduled && vault.isUnlocked()) {
      updateCheckScheduled = true
      setTimeout(() => {
        const rt = vault.getRuntime()
        if (!rt) return
        void rt.runPromise(
          Effect.gen(function* () {
            const updater = yield* Updater
            yield* Effect.promise(() => updater.checkForUpdates())
          }),
        )
      }, 5_000)
    }
    return response
  })

  app.on("before-quit", () => {
    void vault.lock()
  })

  // Re-lock whenever every window is closed. On macOS the app stays alive,
  // so reopening from the dock must re-prompt for the password.
  app.on("window-all-closed", () => {
    updateCheckScheduled = false
    void vault.lock()
    if (process.platform !== "darwin") app.quit()
  })

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
