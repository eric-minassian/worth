import { contextBridge, ipcRenderer } from "electron"
import { RPC_CHANNEL, type RpcRequestEnvelope, type WorthApi } from "@worth/ipc"

const api: WorthApi = {
  rpc: (message: RpcRequestEnvelope) => ipcRenderer.invoke(RPC_CHANNEL, message),
}

contextBridge.exposeInMainWorld("worth", api)
