import { useState } from "react"
import { Button } from "@worth/ui"
import { callCommand, RpcError } from "./rpc"

export const App = () => {
  const [reply, setReply] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onPing = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await callCommand("ping", { message: "hello from renderer" })
      setReply(`${result.message} @ ${result.at}`)
    } catch (e) {
      setReply(null)
      setError(e instanceof RpcError ? `${e.tag}: ${e.message}` : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-8 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Worth</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Personal finance, local-first. You're looking at the M0 skeleton.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="text-lg font-medium">IPC smoke test</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Click to send a typed <code className="rounded bg-neutral-800 px-1">ping</code> command
          through the single generic RPC channel.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={onPing} disabled={busy}>
            {busy ? "Pinging…" : "Ping main process"}
          </Button>
          {reply && <span className="text-sm text-emerald-400">{reply}</span>}
          {error && <span className="text-sm text-red-400">{error}</span>}
        </div>
      </section>
    </main>
  )
}
