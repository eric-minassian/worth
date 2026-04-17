import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryOptions } from "@tanstack/react-query"
import { Download, RotateCcw, Upload } from "lucide-react"
import { useState } from "react"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@worth/ui"
import { callCommand, RpcError } from "../rpc"

const statsQuery = queryOptions({
  queryKey: ["system.stats"] as const,
  queryFn: () => callCommand("system.stats", {}),
  staleTime: 2_000,
})

type Notice =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }

export const SettingsPage = () => {
  const qc = useQueryClient()
  const stats = useQuery(statsQuery)
  const [notice, setNotice] = useState<Notice | null>(null)

  const invalidateAll = () => qc.invalidateQueries()

  const exportMutation = useMutation({
    mutationFn: () => callCommand("system.export", {}),
    onSuccess: (result) => {
      if (result.cancelled) return
      setNotice({
        kind: "success",
        message: `Exported ${result.eventCount} events to ${result.path}`,
      })
    },
    onError: (e) =>
      setNotice({
        kind: "error",
        message: e instanceof RpcError ? `${e.tag}: ${e.message}` : String(e),
      }),
  })

  const importMutation = useMutation({
    mutationFn: () => callCommand("system.import", {}),
    onSuccess: async (result) => {
      if (result.cancelled) return
      await invalidateAll()
      setNotice({
        kind: "success",
        message: `Imported ${result.accepted} new events from ${result.path}. ${result.skipped} already present.`,
      })
    },
    onError: (e) =>
      setNotice({
        kind: "error",
        message: e instanceof RpcError ? `${e.tag}: ${e.message}` : String(e),
      }),
  })

  const rebuildMutation = useMutation({
    mutationFn: () => callCommand("system.rebuildProjections", {}),
    onSuccess: async (result) => {
      await invalidateAll()
      setNotice({
        kind: "success",
        message: `Rebuilt projections from ${result.replayed} events.`,
      })
    },
    onError: (e) =>
      setNotice({
        kind: "error",
        message: e instanceof RpcError ? `${e.tag}: ${e.message}` : String(e),
      }),
  })

  const onRebuild = () => {
    const ok = window.confirm(
      "Rebuild projections?\n\nThis truncates accounts, categories, and transactions, then replays the entire event log. The event log itself is untouched. Safe to run anytime.",
    )
    if (!ok) return
    rebuildMutation.mutate()
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-10">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Device info, backup, and maintenance.
        </p>
      </header>

      {notice && (
        <Card
          className={
            notice.kind === "success"
              ? "border-emerald-500/40 bg-emerald-500/5"
              : "border-destructive/40 bg-destructive/5"
          }
        >
          <CardContent className="py-4 text-sm">{notice.message}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Stat label="Device id" value={stats.data?.deviceId ?? "—"} mono />
        <Stat label="Latest HLC" value={stats.data?.lastHlc ?? "—"} mono />
        <Stat label="Events" value={stats.data?.eventCount.toString() ?? "—"} />
        <Stat label="Accounts" value={stats.data?.accountCount.toString() ?? "—"} />
        <Stat label="Categories" value={stats.data?.categoryCount.toString() ?? "—"} />
        <Stat label="Transactions" value={stats.data?.transactionCount.toString() ?? "—"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Backup</CardTitle>
          <CardDescription>
            The event log is the canonical backup — it carries every mutation you've ever made
            and can be replayed to reconstruct everything.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            <Download /> {exportMutation.isPending ? "Exporting…" : "Export event log"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
          >
            <Upload /> {importMutation.isPending ? "Importing…" : "Import event log"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Maintenance</CardTitle>
          <CardDescription>
            Rebuild projections from the event log. Use this if you suspect the projection
            tables have drifted or after a projection-schema migration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="secondary"
            onClick={onRebuild}
            disabled={rebuildMutation.isPending}
          >
            <RotateCcw /> {rebuildMutation.isPending ? "Rebuilding…" : "Rebuild projections"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

interface StatProps {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}

const Stat = ({ label, value, mono = false }: StatProps) => (
  <Card>
    <CardHeader>
      <CardDescription>{label}</CardDescription>
      <CardTitle
        className={mono ? "font-mono text-sm break-all" : "text-2xl"}
      >
        {value}
      </CardTitle>
    </CardHeader>
  </Card>
)
