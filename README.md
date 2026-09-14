<div align="center">

<img src="brand/wordmark.png" alt="Lare" width="260">

**Hevy for LeetCode.**
Your practice logs itself — every problem opened, every submission judged, with code,
runtime and memory percentiles and the runtime distribution graph.

[![CI](https://github.com/chaubenn/lare/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/chaubenn/lare/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chaubenn/lare?color=%2310b981&label=release)](https://github.com/chaubenn/lare/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/chaubenn/lare/total?color=%2310b981)](https://github.com/chaubenn/lare/releases)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Chrome-lightgrey)

[Install](#install) · [Architecture](docs/architecture.md) · [Releasing](docs/releasing.md) · [QA](docs/qa.md) · [Privacy](docs/privacy.md)

</div>

---

Share posts with followers, attach demo videos, and run AI-graded mock interviews.

| | |
| --- | --- |
| **Chrome extension** | Captures problems, your Monaco edits and judge results on its own — nothing to start or stop. Triggers mock interviews. |
| **Desktop app** (Tauri) | Reviews drafts, records screen/camera/mic with Cap's recording stack, transcribes, edits, and uploads to Bunny Stream. |
| **Web** | Posts, profiles and your follower feed. |

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

## Development

```bash
pnpm install
pnpm dev:web          # Next.js
pnpm dev:extension    # wxt, then load apps/extension/.output as unpacked
pnpm dev:desktop      # Tauri
```

```bash
pnpm lint             # biome
pnpm typecheck
pnpm test
```

Rust needs prebuilt ffmpeg — `pnpm setup:native` writes the cargo env for your target.

Branching, CI lanes and how to cut a release: **[docs/releasing.md](docs/releasing.md)**.

## License

AGPL-3.0-only. Portions derived from Cap (AGPL-3.0 / MIT); see [`NOTICE`](NOTICE).
