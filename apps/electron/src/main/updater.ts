import { execFile, spawn } from "node:child_process"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { app, BrowserWindow, shell } from "electron"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema, type DrizzleClient } from "@worth/db"
import {
  UPDATE_EVENT_CHANNEL,
  type UpdateChannel,
  type UpdaterState,
} from "@worth/ipc"

const execFileP = promisify(execFile)

const UPDATE_CHANNEL_KEY = "update_channel"
const GITHUB_OWNER = "eric-minassian"
const GITHUB_REPO = "worth"
// Throttle progress events so a fast download doesn't flood IPC. 4Hz is
// plenty to feel responsive without being wasteful.
const PROGRESS_BROADCAST_INTERVAL_MS = 250

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

interface GithubAsset {
  readonly name: string
  readonly browser_download_url: string
  readonly size: number
}

interface GithubRelease {
  readonly tag_name: string
  readonly name: string
  readonly html_url: string
  readonly body: string
  readonly prerelease: boolean
  readonly draft: boolean
  readonly assets: readonly GithubAsset[]
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

/**
 * Picks the `.zip` asset from a release. electron-builder publishes both a
 * `.dmg` and a `.zip` of the app bundle; we use the ZIP because unzipping a
 * staged bundle is faster and simpler than mounting/detaching a DMG.
 */
const findZipAsset = (release: GithubRelease): GithubAsset | null => {
  const arm64Zip = release.assets.find(
    (a) => a.name.endsWith(".zip") && a.name.includes("arm64"),
  )
  if (arm64Zip) return arm64Zip
  return release.assets.find((a) => a.name.endsWith(".zip")) ?? null
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

/**
 * Walks from `app.getPath('exe')` up to the containing `.app` bundle. On
 * macOS this is always `<Foo>.app/Contents/MacOS/<exe>`, so the bundle root
 * is three levels up.
 */
const currentAppBundlePath = (): string => {
  const exe = app.getPath("exe")
  return path.resolve(exe, "..", "..", "..")
}

export interface UpdaterImpl {
  readonly getState: () => UpdaterState
  readonly checkForUpdates: () => Promise<UpdaterState>
  readonly downloadUpdate: () => Promise<UpdaterState>
  readonly quitAndInstall: () => Promise<boolean>
  readonly setChannel: (channel: UpdateChannel) => Promise<UpdaterState>
  readonly openReleasePage: () => Promise<boolean>
}

export class Updater extends Context.Service<Updater, UpdaterImpl>()(
  "@worth/electron/Updater",
) {}

const makeUpdaterImpl = (drizzleDb: DrizzleClient): UpdaterImpl => {
  const currentVersion = app.getVersion()
  const updatesDir = path.join(app.getPath("userData"), "updates")
  const stagedAppPath = path.join(updatesDir, "staged", "Worth.app")
  const zipDownloadPath = path.join(updatesDir, "download.zip")

  let channel = readChannel(drizzleDb)
  let state: UpdaterState = {
    status: "idle",
    currentVersion,
    channel,
    lastCheckedAt: null,
  }
  let latestRelease: GithubRelease | null = null

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
      if (compareVersions(remoteVersion, currentVersion) <= 0) {
        latestRelease = release
        const next: UpdaterState = {
          status: "not-available",
          currentVersion,
          channel,
          lastCheckedAt: Date.now(),
        }
        setState(next)
        return next
      }
      latestRelease = release
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

  const downloadUpdate = async (): Promise<UpdaterState> => {
    if (state.status !== "available") return state
    const release = latestRelease
    if (!release) return state
    const zip = findZipAsset(release)
    if (!zip) {
      const next: UpdaterState = {
        status: "error",
        currentVersion,
        channel,
        message: "This release does not include a zip asset — open the release page to install manually.",
      }
      setState(next)
      return next
    }

    const nextVersion = state.nextVersion
    try {
      await rm(updatesDir, { recursive: true, force: true })
      await mkdir(path.dirname(zipDownloadPath), { recursive: true })

      setState({
        status: "downloading",
        currentVersion,
        channel,
        nextVersion,
        transferred: 0,
        total: zip.size,
      })

      const res = await fetch(zip.browser_download_url, {
        redirect: "follow",
        headers: { Accept: "application/octet-stream" },
      })
      if (!res.ok || !res.body) {
        throw new Error(`Download failed: HTTP ${res.status.toString()}`)
      }
      const total =
        Number(res.headers.get("content-length")) || zip.size || 0

      let transferred = 0
      let lastBroadcast = 0
      const tap = new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          transferred += chunk.byteLength
          const now = Date.now()
          if (
            now - lastBroadcast >= PROGRESS_BROADCAST_INTERVAL_MS ||
            transferred === total
          ) {
            lastBroadcast = now
            setState({
              status: "downloading",
              currentVersion,
              channel,
              nextVersion,
              transferred,
              total,
            })
          }
          controller.enqueue(chunk)
        },
      })
      const webStream = res.body.pipeThrough(tap)
      const nodeStream = Readable.fromWeb(
        webStream as unknown as Parameters<typeof Readable.fromWeb>[0],
      )
      await pipeline(nodeStream, createWriteStream(zipDownloadPath))

      // Unzip into the staging dir. `ditto -x -k` preserves HFS metadata
      // (extended attributes, resource forks) which codesign cares about —
      // using plain `unzip` would corrupt the ad-hoc signature.
      const stagingRoot = path.join(updatesDir, "staged")
      await mkdir(stagingRoot, { recursive: true })
      await execFileP("ditto", ["-x", "-k", zipDownloadPath, stagingRoot])

      const next: UpdaterState = {
        status: "ready",
        currentVersion,
        channel,
        nextVersion,
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

  const quitAndInstall = async (): Promise<boolean> => {
    if (state.status !== "ready") return false
    const currentAppPath = currentAppBundlePath()
    const scriptPath = path.join(tmpdir(), `worth-install-${Date.now().toString()}.sh`)

    // Shell-quote for safety. Single quotes with closing-quote-escape.
    const sh = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`
    const script = `#!/bin/bash
set -u
CURRENT=${sh(currentAppPath)}
STAGED=${sh(stagedAppPath)}
UPDATES_DIR=${sh(updatesDir)}

# Give the Electron process a moment to finish quitting so the bundle's
# files aren't in use when we swap them out.
sleep 2

# Drop the old bundle and move the staged one into place. \`ditto\` preserves
# extended attributes (the ad-hoc signature) which a plain \`cp -R\` strips.
rm -rf "$CURRENT"
ditto "$STAGED" "$CURRENT"

# The zip was downloaded with quarantine inherited from the HTTPS fetch;
# clear it so Gatekeeper lets the new binary run without prompting.
xattr -cr "$CURRENT" 2>/dev/null || true

# Clean up the staging dir — the bundle is now in its final home.
rm -rf "$UPDATES_DIR"

open -a "$CURRENT"
`
    await writeFile(scriptPath, script, { mode: 0o755 })

    const child = spawn("/bin/bash", [scriptPath], {
      detached: true,
      stdio: "ignore",
    })
    child.unref()

    app.quit()
    return true
  }

  const setChannel = async (next: UpdateChannel): Promise<UpdaterState> => {
    if (next === channel) return state
    channel = next
    writeChannel(drizzleDb, channel)
    latestRelease = null
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
      latestRelease?.html_url ??
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
  }
}

export const UpdaterLive = Layer.effect(Updater)(
  Effect.gen(function* () {
    const db = yield* Db
    return makeUpdaterImpl(db.drizzle)
  }),
)
