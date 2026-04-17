import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import {
  RPC_CHANNEL,
  UPDATE_EVENT_CHANNEL,
  type RpcRequestEnvelope,
  type WorthApi,
} from "@worth/ipc"

const api: WorthApi = {
  rpc: (message: RpcRequestEnvelope) => ipcRenderer.invoke(RPC_CHANNEL, message),
  onUpdateEvent: (handler) => {
    const listener = (_event: IpcRendererEvent, state: unknown) => handler(state)
    ipcRenderer.on(UPDATE_EVENT_CHANNEL, listener)
    return () => {
      ipcRenderer.off(UPDATE_EVENT_CHANNEL, listener)
    }
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld("worth", api)
