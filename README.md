# Lare

Hevy for LeetCode. Your practice is logged as you do it — every problem opened, every
submission judged, with code, runtime and memory percentiles and the runtime distribution graph.
Share posts with followers, attach demo videos, and run AI-graded mock interviews.

- **Chrome extension** captures problems, your Monaco edits and judge results on its own, with
  nothing to start or stop; triggers mock interviews from its popup.
- **Desktop app** (Tauri) reviews drafts, records your screen/camera/mic with Cap's recording stack,
  transcribes locally with whisper.cpp, edits and uploads to Bunny Stream, and reviews interviews
  with timestamped AI feedback.
- **Web** shows posts, profiles and your follower feed.

Docs: [architecture](docs/architecture.md) · [QA checklist](docs/qa.md) · [privacy](docs/privacy.md)

## Install

Two pieces: the desktop app and the Chrome extension. About two minutes.

### 1. Desktop app

| Platform | Download |
| --- | --- |
| macOS (Apple Silicon, M1 and later) | [Lare-macOS-AppleSilicon.dmg](https://github.com/chaubenn/lare/releases/latest/download/Lare-macOS-AppleSilicon.dmg) |
| macOS (Intel) | [Lare-macOS-Intel.dmg](https://github.com/chaubenn/lare/releases/latest/download/Lare-macOS-Intel.dmg) |
| Windows 10/11 (x64) | [Lare-Windows-x64-Setup.exe](https://github.com/chaubenn/lare/releases/latest/download/Lare-Windows-x64-Setup.exe) |

All versions: [Releases](https://github.com/chaubenn/lare/releases).

- **macOS**: open the DMG, drag Lare to Applications. The build is not notarised yet, so the
  first launch needs right-click > **Open** (or `xattr -dr com.apple.quarantine /Applications/Lare.app`).
  Grant Screen Recording / Camera / Microphone when asked (needed for demo videos and interviews).
- **Windows**: run the installer. If SmartScreen appears, click **More info** > **Run anyway**.

Lare checks GitHub Releases on every launch and installs updates in the background; you can also
run **Settings > Check for updates**.

### 2. Chrome extension

1. Download [Lare-Chrome-Extension.zip](https://github.com/chaubenn/lare/releases/latest/download/Lare-Chrome-Extension.zip) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Pin the Lare icon, open the desktop app and sign in, then open any LeetCode problem. The
   footer in the desktop app shows **Extension: connected**.

The extension talks to the desktop app over `127.0.0.1`, so the app must be running while you
practise. Chrome Web Store listing is coming; until then the unpacked install is the supported path.

## Release process

1. Bump the version in `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`,
   `apps/desktop/src-tauri/Cargo.toml` (they must match the tag) and
   `apps/extension/package.json` — the extension carries the same number as the app it talks to,
   even when nothing in it changed, so a support question only ever needs one version.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.

The Release workflow builds installers for macOS (Apple Silicon + Intel) and Windows x64 and the
extension zip, signs the updater bundles with `TAURI_SIGNING_PRIVATE_KEY`, writes `latest.json`
and publishes the GitHub release as **latest**. Installed apps (tauri-plugin-updater) read
`releases/latest/download/latest.json` on launch and self-update. The release ships only the four
stable download names (`Lare-macOS-AppleSilicon.dmg`, `Lare-macOS-Intel.dmg`,
`Lare-Windows-x64-Setup.exe`, `Lare-Chrome-Extension.zip`) — everything people need to run the
app — plus `latest.json` and the signed updater artifacts it references; duplicate versioned
installers are deleted after publishing. Running the workflow manually produces a draft release
that is never marked latest.

The updater public key lives in `tauri.conf.json` (`plugins.updater.pubkey`); the private key is
the `TAURI_SIGNING_PRIVATE_KEY` repository secret. Losing it means shipped apps can no longer
verify updates, so keep a backup. Apple notarisation is optional and picked up from the usual
`APPLE_*` secrets when present.


## License

AGPL-3.0-only. Portions derived from Cap (AGPL-3.0 / MIT); see `NOTICE`.
