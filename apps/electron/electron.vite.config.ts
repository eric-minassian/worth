import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

const here = import.meta.dirname

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: path.resolve(here, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
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
