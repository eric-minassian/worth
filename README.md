# Worth

Local-first personal-finance desktop app. Your data lives on your machine; nothing phones home.

macOS only for now (Apple Silicon).

## Download and install

Builds are published on the [Releases page](https://github.com/eric-minassian/worth/releases). There are two tracks:

- **Stable** — tagged releases (`vX.Y.Z`). This is what you probably want.
- **Nightly** — a build on every commit to `main`. Newer features, rougher edges.

Worth is **not code-signed** (no Apple Developer Program membership). The app and your data are safe, but your OS doesn't know that — you'll see a Gatekeeper warning the first time you launch, and you'll need to click through it once.

### macOS (Apple Silicon)

1. Download the latest `Worth-<version>-arm64.dmg` from Releases.
2. Open the DMG, drag `Worth.app` into `Applications`.
3. **First launch only:** open Finder, go to `Applications`, **right-click** (or Control-click) `Worth.app`, and choose **Open**. Confirm the dialog. Double-clicking won't work the first time — Gatekeeper blocks unsigned apps unless you explicitly open them once.
4. After that, launch normally.

#### Troubleshooting: *"Worth" is damaged and can't be opened*

If you see this instead of the usual "unknown developer" prompt, macOS is refusing to launch the app because of the quarantine flag that gets set on any file downloaded from the internet. Run this in Terminal to clear it:

```sh
xattr -cr /Applications/Worth.app
```

Then launch normally. Builds since `v0.1.1` ad-hoc sign the bundle so this shouldn't be needed, but older DMGs or edge cases on newer macOS releases can still trip it.

### Updating

Because the app is unsigned, macOS won't let it replace itself in place. Worth checks GitHub for new releases and surfaces them in **Settings → Updates** — click through to the release page, download the new DMG, and drag it into Applications over the old copy. Your data lives outside the bundle, so replacing the app preserves everything.

## Picking an update channel

By default Worth follows the **stable** channel. To switch:

1. Launch Worth.
2. Go to **Settings** → **Updates**.
3. Change **Channel** to `Nightly` (or back to `Stable`). The app will check for updates on the new channel immediately.

Channel preference is stored locally and survives updates.

## Where your data lives

`~/Library/Application Support/Worth/worth.db`

Back up this file, or use **Settings → Backup → Export event log** for a portable JSON backup that can be re-imported anywhere.
