import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryOptions } from "@tanstack/react-query"
import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react"
import { useEffect, useState } from "react"
import type { UpdateChannel, UpdaterState } from "@worth/ipc"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@worth/ui"
import { callCommand, RpcError } from "../rpc"

const statsQuery = queryOptions({
  queryKey: ["system.stats"] as const,
  queryFn: () => callCommand("system.stats", {}),
  staleTime: 2_000,
})

const updaterQuery = queryOptions({
  queryKey: ["updater.getState"] as const,
  queryFn: () => callCommand("updater.getState", {}),
  staleTime: 0,
})

type Notice =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }

export const SettingsPage = () => {
  const qc = useQueryClient()
  const stats = useQuery(statsQuery)
  const updater = useQuery(updaterQuery)
  const [notice, setNotice] = useState<Notice | null>(null)

  const invalidateAll = () => qc.invalidateQueries()

  // Subscribe to main-process updater events so we reflect download progress
  // and state transitions without polling.
  useEffect(() => {
    const unsubscribe = window.worth.onUpdateEvent((raw) => {
      qc.setQueryData<UpdaterState>(updaterQuery.queryKey, raw as UpdaterState)
    })
    return unsubscribe
  }, [qc])

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

  const checkUpdatesMutation = useMutation({
    mutationFn: () => callCommand("updater.checkForUpdates", {}),
    onSuccess: (result) =>
      qc.setQueryData<UpdaterState>(updaterQuery.queryKey, result),
  })

  const downloadMutation = useMutation({
    mutationFn: () => callCommand("updater.downloadUpdate", {}),
    onSuccess: (result) =>
      qc.setQueryData<UpdaterState>(updaterQuery.queryKey, result),
  })

  const installMutation = useMutation({
    mutationFn: () => callCommand("updater.quitAndInstall", {}),
  })

  const setChannelMutation = useMutation({
    mutationFn: (channel: UpdateChannel) =>
      callCommand("updater.setChannel", { channel }),
    onSuccess: (result) =>
      qc.setQueryData<UpdaterState>(updaterQuery.queryKey, result),
  })

  const openReleaseMutation = useMutation({
    mutationFn: () => callCommand("updater.openReleasePage", {}),
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Updates</CardTitle>
          <CardDescription>
            Stable tracks tagged releases. Nightly updates on every commit to main — useful for
            trying out in-progress features, but occasionally rough.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <UpdaterPanel
            state={updater.data ?? null}
            onCheck={() => checkUpdatesMutation.mutate()}
            onDownload={() => downloadMutation.mutate()}
            onInstall={() => installMutation.mutate()}
            onOpenRelease={() => openReleaseMutation.mutate()}
            onChannelChange={(c) => setChannelMutation.mutate(c)}
            busy={
              checkUpdatesMutation.isPending ||
              downloadMutation.isPending ||
              setChannelMutation.isPending
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}

interface UpdaterPanelProps {
  readonly state: UpdaterState | null
  readonly busy: boolean
  readonly onCheck: () => void
  readonly onDownload: () => void
  readonly onInstall: () => void
  readonly onOpenRelease: () => void
  readonly onChannelChange: (channel: UpdateChannel) => void
}

const UpdaterPanel = ({
  state,
  busy,
  onCheck,
  onDownload,
  onInstall,
  onOpenRelease,
  onChannelChange,
}: UpdaterPanelProps) => {
  if (!state) {
    return (
      <div className="text-sm text-muted-foreground">Loading updater status…</div>
    )
  }

  const platformLabel =
    state.platform === "mac" ? "macOS" : state.platform === "win" ? "Windows" : "Linux"

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="text-xs uppercase text-muted-foreground">Channel</div>
          <Select
            value={state.channel}
            onValueChange={(v) => onChannelChange(v as UpdateChannel)}
            disabled={busy}
          >
            <SelectTrigger className="mt-1 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stable">Stable</SelectItem>
              <SelectItem value="nightly">Nightly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-xs uppercase text-muted-foreground">Installed version</div>
          <div className="mt-1 font-mono text-sm break-all">{state.currentVersion}</div>
          <div className="mt-1 text-xs text-muted-foreground">{platformLabel}</div>
        </div>
      </div>

      <StatusLine state={state} />

      <div className="flex flex-wrap gap-3">
        {state.status === "idle" || state.status === "not-available" || state.status === "error" ? (
          <Button onClick={onCheck} disabled={busy}>
            <RefreshCw /> {busy ? "Checking…" : "Check for updates"}
          </Button>
        ) : null}

        {state.status === "available" ? (
          state.canAutoInstall ? (
            <Button onClick={onDownload} disabled={busy}>
              <Download /> Download {state.nextVersion}
            </Button>
          ) : (
            <Button onClick={onDownload} disabled={busy}>
              <ExternalLink /> Open {state.nextVersion} on GitHub
            </Button>
          )
        ) : null}

        {state.status === "ready" ? (
          <Button onClick={onInstall}>
            <CheckCircle2 /> Restart and install {state.nextVersion}
          </Button>
        ) : null}

        {state.status !== "downloading" && (state.status === "available" || state.status === "not-available" || state.status === "ready") ? (
          <Button variant="secondary" onClick={onOpenRelease}>
            <ExternalLink /> View release notes
          </Button>
        ) : null}
      </div>

      {state.status === "available" && !state.canAutoInstall ? (
        <p className="text-xs text-muted-foreground">
          Automatic install is disabled on {platformLabel} because this build is unsigned.
          The download link opens the GitHub release — drag the new app into Applications to
          replace the old one.
        </p>
      ) : null}
    </div>
  )
}

const StatusLine = ({ state }: { readonly state: UpdaterState }) => {
  switch (state.status) {
    case "idle":
      return (
        <div className="text-sm text-muted-foreground">
          Ready. Last checked: never this session.
        </div>
      )
    case "checking":
      return <div className="text-sm text-muted-foreground">Checking for updates…</div>
    case "not-available":
      return (
        <div className="text-sm text-emerald-500">
          You're on the latest {state.channel} build.
        </div>
      )
    case "available":
      return (
        <div className="text-sm">
          <span className="text-primary">Update available:</span>{" "}
          <span className="font-mono">{state.nextVersion}</span>
        </div>
      )
    case "downloading": {
      const pct = Math.max(0, Math.min(100, state.percent))
      return (
        <div className="flex flex-col gap-2">
          <div className="text-sm">
            Downloading <span className="font-mono">{state.nextVersion}</span> —{" "}
            {pct.toFixed(0)}%
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${pct.toString()}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(state.transferred)} / {formatBytes(state.total)} ·{" "}
            {formatBytes(state.bytesPerSecond)}/s
          </div>
        </div>
      )
    }
    case "ready":
      return (
        <div className="text-sm text-emerald-500">
          <span className="font-mono">{state.nextVersion}</span> downloaded. Restart to
          install.
        </div>
      )
    case "error":
      return (
        <div className="text-sm text-destructive">Update failed: {state.message}</div>
      )
  }
}

const formatBytes = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i] ?? "B"}`
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
