import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

const here = import.meta.dirname

// Workspace packages are bundled into main and preload rather than externalized,
// so Node never has to resolve extensionless TS imports across package
// boundaries at runtime.
const worthWorkspaceDeps = [
  "@worth/core",
  "@worth/db",
  "@worth/domain",
  "@worth/importers",
  "@worth/ipc",
  "@worth/sync",
]

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: worthWorkspaceDeps },
      rollupOptions: {
        input: path.resolve(here, "src/main/index.ts"),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: worthWorkspaceDeps },
      rollupOptions: {
        input: path.resolve(here, "src/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: path.resolve(here, "src/renderer"),
    build: {
      rollupOptions: {
        input: path.resolve(here, "src/renderer/index.html"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
})
