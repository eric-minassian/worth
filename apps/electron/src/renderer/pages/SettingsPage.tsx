import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryOptions } from "@tanstack/react-query"
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Fingerprint,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react"
import { useEffect, useState } from "react"

import type { UpdateChannel, UpdaterState } from "@worth/ipc"
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@worth/ui"
import { callCommand, formatRpcError } from "../rpc"

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

const biometricQuery = queryOptions({
  queryKey: ["vault.biometricStatus"] as const,
  queryFn: () => callCommand("vault.biometricStatus", {}),
  staleTime: Infinity,
})

export const SettingsPage = () => {
  const qc = useQueryClient()
  const stats = useQuery(statsQuery)
  const updater = useQuery(updaterQuery)
  const biometric = useQuery(biometricQuery)
  const [rebuildOpen, setRebuildOpen] = useState(false)

  useEffect(() => {
    const unsubscribe = window.worth.onUpdateEvent((raw) => {
      qc.setQueryData<UpdaterState>(updaterQuery.queryKey, raw as UpdaterState)
    })
    return unsubscribe
  }, [qc])

  const invalidateAll = () => qc.invalidateQueries()

  const exportMutation = useMutation({
    mutationFn: () => callCommand("system.export", {}),
    onSuccess: (result) => {
      if (result.cancelled) return
      toast.success(`Exported ${result.eventCount} events`, {
        description: result.path,
      })
    },
    onError: (e) => toast.error(formatRpcError(e)),
  })

  const importMutation = useMutation({
    mutationFn: () => callCommand("system.import", {}),
    onSuccess: async (result) => {
      if (result.cancelled) return
      await invalidateAll()
      toast.success(`Imported ${result.accepted} new events`, {
        description: `${result.skipped} already present.`,
      })
    },
    onError: (e) => toast.error(formatRpcError(e)),
  })

  const rebuildMutation = useMutation({
    mutationFn: () => callCommand("system.rebuildProjections", {}),
    onSuccess: async (result) => {
      await invalidateAll()
      toast.success(`Rebuilt projections from ${result.replayed} events`)
    },
    onError: (e) => toast.error(formatRpcError(e)),
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

  const enableBiometricMutation = useMutation({
    mutationFn: () => callCommand("vault.enableBiometric", {}),
    onSuccess: async (result) => {
      if (result.ok) {
        await qc.invalidateQueries({ queryKey: biometricQuery.queryKey })
        toast.success("Touch ID enabled")
        return
      }
      toast.error(
        result.reason === "unavailable"
          ? "Touch ID is not available on this device."
          : "Unlock the vault first.",
      )
    },
    onError: (e) => toast.error(formatRpcError(e)),
  })

  const disableBiometricMutation = useMutation({
    mutationFn: () => callCommand("vault.disableBiometric", {}),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: biometricQuery.queryKey })
      toast.success("Touch ID disabled")
    },
    onError: (e) => toast.error(formatRpcError(e)),
  })


  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-6">
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Events" value={stats.data?.eventCount.toString() ?? "—"} />
            <Stat
              label="Accounts"
              value={stats.data?.accountCount.toString() ?? "—"}
            />
            <Stat
              label="Categories"
              value={stats.data?.categoryCount.toString() ?? "—"}
            />
            <Stat
              label="Transactions"
              value={stats.data?.transactionCount.toString() ?? "—"}
            />
            <Stat label="Device id" value={stats.data?.deviceId ?? "—"} mono />
            <Stat label="Latest HLC" value={stats.data?.lastHlc ?? "—"} mono />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Maintenance</CardTitle>
              <CardDescription className="text-xs">
                Rebuild projections from the event log. Use this if you suspect
                projection tables have drifted or after a schema migration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRebuildOpen(true)}
                disabled={rebuildMutation.isPending}
              >
                <RotateCcw />{" "}
                {rebuildMutation.isPending
                  ? "Rebuilding…"
                  : "Rebuild projections"}
              </Button>
              <AlertDialog open={rebuildOpen} onOpenChange={setRebuildOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Rebuild projections?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Truncates accounts, categories, and transactions, then
                      replays the entire event log. The event log itself is
                      untouched — safe to run anytime, but it can take a moment
                      on large datasets.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className={buttonVariants({ variant: "destructive" })}
                      onClick={() => rebuildMutation.mutate()}
                    >
                      Rebuild
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Touch ID</CardTitle>
              <CardDescription className="text-xs">
                Unlock Worth with Touch ID instead of your password. Your
                password is encrypted with the system keychain; the Touch ID
                prompt gates access on each unlock.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {biometric.data && !biometric.data.available ? (
                <p className="text-xs text-muted-foreground">
                  Touch ID is not available on this device.
                </p>
              ) : biometric.data?.enabled ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => disableBiometricMutation.mutate()}
                  disabled={disableBiometricMutation.isPending}
                >
                  <Fingerprint />
                  {disableBiometricMutation.isPending
                    ? "Disabling…"
                    : "Disable Touch ID"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => enableBiometricMutation.mutate()}
                  disabled={
                    enableBiometricMutation.isPending || !biometric.data
                  }
                >
                  <Fingerprint />
                  {enableBiometricMutation.isPending
                    ? "Enabling…"
                    : "Enable Touch ID"}
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backup" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Event log</CardTitle>
              <CardDescription className="text-xs">
                The event log is the canonical backup — it carries every
                mutation you've ever made and can be replayed to reconstruct
                everything.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
              >
                <Download />{" "}
                {exportMutation.isPending ? "Exporting…" : "Export"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending}
              >
                <Upload />{" "}
                {importMutation.isPending ? "Importing…" : "Import"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="updates" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Update channel</CardTitle>
              <CardDescription className="text-xs">
                Stable tracks tagged releases. Nightly updates on every commit
                to main — useful for trying out in-progress features, but
                occasionally rough.
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                  installMutation.isPending ||
                  setChannelMutation.isPending
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
      <div className="text-xs text-muted-foreground">
        Loading updater status…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase text-muted-foreground">
            Channel
          </span>
          <Select
            value={state.channel}
            onValueChange={(v) => onChannelChange(v as UpdateChannel)}
            disabled={
              busy ||
              state.status === "downloading" ||
              state.status === "ready"
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stable">Stable</SelectItem>
              <SelectItem value="nightly">Nightly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase text-muted-foreground">
            Installed version
          </span>
          <div className="flex h-7 items-center rounded-md border bg-input/20 px-2 font-mono text-xs">
            {state.currentVersion}
          </div>
        </div>
      </div>

      <Separator />

      <UpdaterStatus state={state} />

      <div className="flex flex-wrap gap-2">
        {state.status === "idle" ||
        state.status === "not-available" ||
        state.status === "error" ? (
          <Button size="sm" onClick={onCheck} disabled={busy}>
            <RefreshCw /> {busy ? "Checking…" : "Check for updates"}
          </Button>
        ) : null}

        {state.status === "available" ? (
          <Button size="sm" onClick={onDownload} disabled={busy}>
            <Download /> Download {state.nextVersion}
          </Button>
        ) : null}

        {state.status === "ready" ? (
          <Button size="sm" onClick={onInstall} disabled={busy}>
            <CheckCircle2 /> Install and relaunch
          </Button>
        ) : null}

        {state.status === "available" ||
        state.status === "not-available" ||
        state.status === "ready" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onOpenRelease}
            disabled={busy}
          >
            <ExternalLink /> Release notes
          </Button>
        ) : null}
      </div>
    </div>
  )
}

const UpdaterStatus = ({ state }: { readonly state: UpdaterState }) => {
  switch (state.status) {
    case "idle":
      return (
        <p className="text-xs text-muted-foreground">
          Ready. Last checked: never this session.
        </p>
      )
    case "checking":
      return (
        <p className="text-xs text-muted-foreground">Checking for updates…</p>
      )
    case "not-available":
      return (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>You're on the latest {state.channel} build.</AlertTitle>
        </Alert>
      )
    case "available":
      return (
        <Alert>
          <Download />
          <AlertTitle>Update available</AlertTitle>
          <AlertDescription>
            <Badge variant="outline" className="font-mono">
              {state.nextVersion}
            </Badge>
          </AlertDescription>
        </Alert>
      )
    case "downloading": {
      const pct =
        state.total > 0
          ? Math.max(0, Math.min(100, (state.transferred / state.total) * 100))
          : 0
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span>
              Downloading{" "}
              <span className="font-mono">{state.nextVersion}</span>
            </span>
            <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
          </div>
          <Progress value={pct} />
          <div className="text-xs text-muted-foreground">
            {formatBytes(state.transferred)} / {formatBytes(state.total)}
          </div>
        </div>
      )
    }
    case "ready":
      return (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>
            <span className="font-mono">{state.nextVersion}</span> downloaded
          </AlertTitle>
          <AlertDescription>
            Click install to relaunch into the new version.
          </AlertDescription>
        </Alert>
      )
    case "error":
      return (
        <Alert variant="destructive">
          <AlertTitle>Update failed</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
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
      <CardDescription className="text-xs">{label}</CardDescription>
      <CardTitle
        className={
          mono ? "font-mono text-xs break-all" : "text-lg tabular-nums"
        }
      >
        {value}
      </CardTitle>
    </CardHeader>
  </Card>
)
