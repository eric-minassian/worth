import { app, BrowserWindow, shell } from "electron"
import { autoUpdater, type AppUpdater } from "electron-updater"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema, type DrizzleClient } from "@worth/db"
import {
  UPDATE_EVENT_CHANNEL,
  type UpdateChannel,
  type UpdaterState,
} from "@worth/ipc"

const UPDATE_CHANNEL_KEY = "update_channel"
const GITHUB_OWNER = "eric-minassian"
const GITHUB_REPO = "worth"

type Platform = "mac" | "win" | "linux"

const detectPlatform = (): Platform => {
  if (process.platform === "darwin") return "mac"
  if (process.platform === "win32") return "win"
  return "linux"
}

/**
 * Semver-ish comparator for our version format (`X.Y.Z` or
 * `X.Y.Z-nightly.<ts>.<sha>`). Prerelease suffixes sort lexicographically,
 * which works because the nightly timestamp is fixed-width and leading.
 */
const compareVersions = (a: string, b: string): number => {
  const [aMain, ...aRest] = a.split("-")
  const [bMain, ...bRest] = b.split("-")
  const aPre = aRest.join("-")
  const bPre = bRest.join("-")
  const aParts = (aMain ?? "0").split(".").map((p) => Number(p) || 0)
  const bParts = (bMain ?? "0").split(".").map((p) => Number(p) || 0)
  for (let i = 0; i < 3; i++) {
    const av = aParts[i] ?? 0
    const bv = bParts[i] ?? 0
    if (av !== bv) return av - bv
  }
  if (aPre === bPre) return 0
  if (!aPre) return 1
  if (!bPre) return -1
  return aPre < bPre ? -1 : 1
}

const isNightlyVersion = (v: string): boolean => v.includes("-nightly.")

interface GithubRelease {
  readonly tag_name: string
  readonly name: string
  readonly html_url: string
  readonly body: string
  readonly prerelease: boolean
  readonly draft: boolean
}

const versionFromTag = (tag: string): string =>
  tag.startsWith("v") ? tag.slice(1) : tag

const fetchLatestRelease = async (
  channel: UpdateChannel,
): Promise<GithubRelease | null> => {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  )
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status.toString()}: ${res.statusText}`)
  }
  const releases = (await res.json()) as GithubRelease[]
  const candidates = releases
    .filter((r) => !r.draft)
    .filter((r) =>
      channel === "nightly"
        ? r.prerelease && isNightlyVersion(versionFromTag(r.tag_name))
        : !r.prerelease,
    )
    .sort((a, b) =>
      compareVersions(versionFromTag(b.tag_name), versionFromTag(a.tag_name)),
    )
  return candidates[0] ?? null
}

const readChannel = (drizzleDb: DrizzleClient): UpdateChannel => {
  const row = drizzleDb
    .select()
    .from(schema.meta)
    .where(eq(schema.meta.key, UPDATE_CHANNEL_KEY))
    .get()
  const raw = row?.value ?? "stable"
  return raw === "nightly" ? "nightly" : "stable"
}

const writeChannel = (drizzleDb: DrizzleClient, channel: UpdateChannel): void => {
  drizzleDb
    .insert(schema.meta)
    .values({ key: UPDATE_CHANNEL_KEY, value: channel })
    .onConflictDoUpdate({ target: schema.meta.key, set: { value: channel } })
    .run()
}

export interface UpdaterImpl {
  readonly getState: () => UpdaterState
  readonly checkForUpdates: () => Promise<UpdaterState>
  readonly downloadUpdate: () => Promise<UpdaterState>
  readonly quitAndInstall: () => boolean
  readonly setChannel: (channel: UpdateChannel) => Promise<UpdaterState>
  readonly openReleasePage: () => Promise<boolean>
  readonly dispose: () => void
}

export class Updater extends Context.Service<Updater, UpdaterImpl>()(
  "@worth/electron/Updater",
) {}

const makeUpdaterImpl = (drizzleDb: DrizzleClient): UpdaterImpl => {
  const platform = detectPlatform()
  const currentVersion = app.getVersion()
  // Auto-install only works on Win/Linux — macOS needs a signed build to
  // replace the app bundle via Squirrel.Mac.
  const canAutoInstall = platform !== "mac" && app.isPackaged

  let channel = readChannel(drizzleDb)
  let state: UpdaterState = {
    status: "idle",
    currentVersion,
    channel,
    platform,
    canAutoInstall,
    lastCheckedAt: null,
  }
  let latestReleaseUrl: string | null = null

  const broadcast = (): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(UPDATE_EVENT_CHANNEL, state)
      }
    }
  }

  const setState = (next: UpdaterState): void => {
    state = next
    broadcast()
  }

  const electronUpdater: AppUpdater = autoUpdater
  electronUpdater.autoDownload = false
  electronUpdater.autoInstallOnAppQuit = false
  electronUpdater.allowPrerelease = channel === "nightly"
  electronUpdater.channel = channel === "nightly" ? "nightly" : "latest"

  if (platform !== "mac" && app.isPackaged) {
    electronUpdater.on("checking-for-update", () => {
      setState({
        status: "checking",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
      })
    })

    electronUpdater.on("update-available", (info) => {
      setState({
        status: "available",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        nextVersion: info.version,
        releaseUrl: latestReleaseUrl,
        releaseNotes:
          typeof info.releaseNotes === "string" ? info.releaseNotes : null,
      })
    })

    electronUpdater.on("update-not-available", () => {
      setState({
        status: "not-available",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        lastCheckedAt: Date.now(),
      })
    })

    electronUpdater.on("download-progress", (progress) => {
      const nextVersion =
        state.status === "available" || state.status === "downloading"
          ? state.nextVersion
          : currentVersion
      setState({
        status: "downloading",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        nextVersion,
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      })
    })

    electronUpdater.on("update-downloaded", (info) => {
      setState({
        status: "ready",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        nextVersion: info.version,
      })
    })

    electronUpdater.on("error", (err) => {
      setState({
        status: "error",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        message: err.message,
      })
    })
  }

  const checkViaGithub = async (): Promise<UpdaterState> => {
    setState({
      status: "checking",
      currentVersion,
      channel,
      platform,
      canAutoInstall,
    })
    const release = await fetchLatestRelease(channel)
    if (!release) {
      const next: UpdaterState = {
        status: "not-available",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        lastCheckedAt: Date.now(),
      }
      setState(next)
      return next
    }
    const remoteVersion = versionFromTag(release.tag_name)
    latestReleaseUrl = release.html_url
    if (compareVersions(remoteVersion, currentVersion) <= 0) {
      const next: UpdaterState = {
        status: "not-available",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        lastCheckedAt: Date.now(),
      }
      setState(next)
      return next
    }
    const next: UpdaterState = {
      status: "available",
      currentVersion,
      channel,
      platform,
      canAutoInstall,
      nextVersion: remoteVersion,
      releaseUrl: release.html_url,
      releaseNotes: release.body || null,
    }
    setState(next)
    return next
  }

  const checkForUpdates = async (): Promise<UpdaterState> => {
    try {
      if (!app.isPackaged) {
        const next: UpdaterState = {
          status: "not-available",
          currentVersion,
          channel,
          platform,
          canAutoInstall,
          lastCheckedAt: Date.now(),
        }
        setState(next)
        return next
      }
      if (platform === "mac") {
        return await checkViaGithub()
      }
      try {
        const release = await fetchLatestRelease(channel)
        latestReleaseUrl = release?.html_url ?? null
      } catch {
        // Non-fatal; electron-updater reads its own feed regardless.
      }
      await electronUpdater.checkForUpdates()
      return state
    } catch (err) {
      const next: UpdaterState = {
        status: "error",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        message: err instanceof Error ? err.message : String(err),
      }
      setState(next)
      return next
    }
  }

  const downloadUpdate = async (): Promise<UpdaterState> => {
    if (platform === "mac") {
      // Unsigned macOS builds can't be swapped in-place by Squirrel.Mac — we
      // open the release page so the user grabs the DMG themselves.
      if (latestReleaseUrl) {
        await shell.openExternal(latestReleaseUrl)
      }
      return state
    }
    if (state.status !== "available") return state
    try {
      setState({
        status: "downloading",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        nextVersion: state.nextVersion,
        percent: 0,
        bytesPerSecond: 0,
        transferred: 0,
        total: 0,
      })
      await electronUpdater.downloadUpdate()
      return state
    } catch (err) {
      const next: UpdaterState = {
        status: "error",
        currentVersion,
        channel,
        platform,
        canAutoInstall,
        message: err instanceof Error ? err.message : String(err),
      }
      setState(next)
      return next
    }
  }

  const quitAndInstall = (): boolean => {
    if (!canAutoInstall) return false
    if (state.status !== "ready") return false
    electronUpdater.quitAndInstall(false, true)
    return true
  }

  const setChannel = async (next: UpdateChannel): Promise<UpdaterState> => {
    if (next === channel) return state
    channel = next
    writeChannel(drizzleDb, channel)
    electronUpdater.allowPrerelease = channel === "nightly"
    electronUpdater.channel = channel === "nightly" ? "nightly" : "latest"
    setState({
      status: "idle",
      currentVersion,
      channel,
      platform,
      canAutoInstall,
      lastCheckedAt: null,
    })
    return checkForUpdates()
  }

  const openReleasePage = async (): Promise<boolean> => {
    const url =
      latestReleaseUrl ??
      `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`
    await shell.openExternal(url)
    return true
  }

  return {
    getState: () => state,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    setChannel,
    openReleasePage,
    dispose: () => {
      electronUpdater.removeAllListeners()
    },
  }
}

export const UpdaterLive = Layer.effect(Updater)(
  Effect.gen(function* () {
    const db = yield* Db
    return makeUpdaterImpl(db.drizzle)
  }),
)
