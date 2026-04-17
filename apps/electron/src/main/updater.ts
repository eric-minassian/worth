import { app, BrowserWindow, shell } from "electron"
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

/**
 * Semver-ish comparator for our version format (`X.Y.Z` or
 * `X.Y.Z-nightly.<ts>.<sha>`). Prerelease suffixes sort lexicographically —
 * works because the nightly timestamp is fixed-width and leading.
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
  readonly setChannel: (channel: UpdateChannel) => Promise<UpdaterState>
  readonly openReleasePage: () => Promise<boolean>
}

export class Updater extends Context.Service<Updater, UpdaterImpl>()(
  "@worth/electron/Updater",
) {}

const makeUpdaterImpl = (drizzleDb: DrizzleClient): UpdaterImpl => {
  const currentVersion = app.getVersion()
  let channel = readChannel(drizzleDb)
  let state: UpdaterState = {
    status: "idle",
    currentVersion,
    channel,
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

  const checkForUpdates = async (): Promise<UpdaterState> => {
    try {
      if (!app.isPackaged) {
        const next: UpdaterState = {
          status: "not-available",
          currentVersion,
          channel,
          lastCheckedAt: Date.now(),
        }
        setState(next)
        return next
      }
      setState({ status: "checking", currentVersion, channel })
      const release = await fetchLatestRelease(channel)
      if (!release) {
        const next: UpdaterState = {
          status: "not-available",
          currentVersion,
          channel,
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
          lastCheckedAt: Date.now(),
        }
        setState(next)
        return next
      }
      const next: UpdaterState = {
        status: "available",
        currentVersion,
        channel,
        nextVersion: remoteVersion,
        releaseUrl: release.html_url,
        releaseNotes: release.body || null,
      }
      setState(next)
      return next
    } catch (err) {
      const next: UpdaterState = {
        status: "error",
        currentVersion,
        channel,
        message: err instanceof Error ? err.message : String(err),
      }
      setState(next)
      return next
    }
  }

  const setChannel = async (next: UpdateChannel): Promise<UpdaterState> => {
    if (next === channel) return state
    channel = next
    writeChannel(drizzleDb, channel)
    setState({
      status: "idle",
      currentVersion,
      channel,
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
    setChannel,
    openReleasePage,
  }
}

export const UpdaterLive = Layer.effect(Updater)(
  Effect.gen(function* () {
    const db = yield* Db
    return makeUpdaterImpl(db.drizzle)
  }),
)
