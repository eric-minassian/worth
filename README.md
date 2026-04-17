# Worth

Local-first personal-finance desktop app. Your data lives on your machine; nothing phones home.

## Download and install

Builds are published on the [Releases page](https://github.com/eric-minassian/worth/releases). There are two tracks:

- **Stable** — tagged releases (`vX.Y.Z`). This is what you probably want.
- **Nightly** — a build on every commit to `main`. Newer features, rougher edges.

Worth is **not code-signed**. The app and your data are safe, but your OS doesn't know that — you'll see a security warning the first time you launch, and you'll need to click through it once. This is a one-time step per install; future launches and auto-updates are silent.

### macOS (Apple Silicon)

1. Download the latest `Worth-<version>-arm64.dmg` from Releases.
2. Open the DMG, drag `Worth.app` into `Applications`.
3. **First launch only:** open Finder, go to `Applications`, **right-click** (or Control-click) `Worth.app`, and choose **Open**. Confirm the dialog. Double-clicking won't work the first time — Gatekeeper blocks unsigned apps unless you explicitly open them once.
4. After that, launch normally.

> Updates on macOS: Worth checks for new releases and shows a banner in Settings → Updates. Because the app is unsigned, it can't replace itself in place — click the banner to open the release page and drag the new DMG into Applications, replacing the old app.

### Windows (x64)

1. Download the latest `Worth-Setup-<version>.exe` from Releases.
2. Run it. Windows SmartScreen will warn that the publisher is unknown — click **More info** → **Run anyway**.
3. The installer walks you through the rest.

> Updates on Windows: automatic. Worth downloads new releases in the background and prompts you to restart when they're ready.

### Linux (x64)

1. Download the latest `Worth-<version>.AppImage` from Releases.
2. Make it executable: `chmod +x Worth-*.AppImage`
3. Run it: `./Worth-*.AppImage`

> Updates on Linux: automatic, handled by the AppImage updater.

## Picking an update channel

By default Worth follows the **stable** channel. To switch:

1. Launch Worth.
2. Go to **Settings** → **Updates**.
3. Change **Channel** to `Nightly` (or back to `Stable`). The app will check for updates on the new channel immediately.

Channel preference is stored locally and survives updates.

## Where your data lives

- **macOS:** `~/Library/Application Support/Worth/worth.db`
- **Windows:** `%APPDATA%\Worth\worth.db`
- **Linux:** `~/.config/Worth/worth.db`

Back up this file, or use **Settings → Backup → Export event log** for a portable JSON backup that can be re-imported anywhere.
