/// <reference types="vite/client" />

import type { WorthApi } from "@worth/ipc"

declare global {
  interface Window {
    readonly worth: WorthApi
  }
}
