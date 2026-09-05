# Lare

Hevy for LeetCode. Log practice sessions with a pausable timer, capture your submissions
(code, runtime and memory percentiles, the runtime distribution graph), share posts with
followers, attach demo videos, and run AI-graded mock interviews.

- **Chrome extension** captures the problem, your Monaco edits and judge results; starts and stops
  the timer; triggers mock interviews.
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

## Parts

| Path | What it is |
| --- | --- |
| `apps/extension` | Chrome extension (MV3, WXT). Session timer, LeetCode problem + Monaco edit capture, judge result capture, mock-interview trigger. |
| `apps/desktop` | Tauri 2 desktop app. Drafts and publishing, recording (instant + studio), studio editor, transcription, Bunny uploads, recordings manager, interview review. |
| `apps/web` | Next.js site. Public post pages, profiles, follower feed. |
| `packages/shared` | Shared TypeScript contracts: edit-log replay, timer + media-time maths, LeetCode parsers, extension <-> desktop protocol, AI review schema. |
| `packages/ui` | Shared React components (runtime chart, code block, badges). |
| `packages/supabase-types` | Generated database types. |
| `crates/lare-recording` | Facade over the vendored Cap crates: devices, permissions, instant/studio recording, remux, headless export, thumbnails, edit -> Cap project mapping. |
| `crates/lare-transcribe` | whisper.cpp transcription (model download, ffmpeg decode, WebVTT). |
| `crates/lare-bunny` | Resumable TUS uploads to Bunny Stream. |
| `crates/lare-core` | Rust mirror of the protocol and edit-log types. |
| `crates/cap` | Vendored crates from [Cap](https://github.com/CapSoftware/Cap) (see `NOTICE`). |
| `supabase` | Migrations and Edge Functions (`bunny-create-upload`, `bunny-webhook`, `bunny-playback-token`, `bunny-captions`, `video-delete`, `ai-review`). |

## Backend

- Supabase project `lare` (`jndqrvwkwoyvzoqcveev`, Sydney): Postgres with RLS, Auth, Storage,
  Realtime, Edge Functions. Function configuration (Bunny keys, OpenAI key) is stored in Supabase
  Vault and read through `public.get_app_secrets` (service role only); values set in the Edge
  Function secrets UI take precedence.
- Bunny Stream library `lare` (id `743884`, replicated to Sydney): storage, encoding, delivery.
  Embed token authentication is enabled; players get signed URLs from `bunny-playback-token`.
- OpenAI Responses API (`gpt-5-mini` by default; `OPENAI_MODEL` overrides) grades mock interviews.

## Development

Prerequisites (macOS): Node 22, pnpm 11, Rust 1.88 (pinned by `rust-toolchain.toml`), and
`brew install cmake pkg-config deno`. Windows: Visual Studio Build Tools with the LLVM component.

```bash
pnpm install
node scripts/setup-native-deps.mjs   # prebuilt ffmpeg for the vendored Cap crates (+ .cargo/config.toml)
cp .env.example apps/desktop/.env    # then keep only the VITE_* lines (see the file)
pnpm --filter @lare/shared test
pnpm dev:extension     # then load apps/extension/.output/chrome-mv3-dev in chrome://extensions
pnpm dev:web
pnpm dev:desktop       # Tauri dev build; first compile takes several minutes
```

Useful checks: `pnpm lint`, `pnpm -r typecheck`, `cargo clippy -p lare-desktop -p lare-recording
-p lare-transcribe -p lare-bunny -- -D warnings`, and the recording smoke tests
`cargo run -p lare-recording --example record_smoke -- studio 4 "<mic name>"` followed by
`cargo run -p lare-recording --example export_smoke -- <project-dir>`.

If `pnpm install` fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` on macOS, point Node at the
system CA bundle: `echo "cafile=/etc/ssl/cert.pem" >> ~/.npmrc`.

### Environment

`.env.example` lists every variable. Clients only need the Supabase URL + publishable key, the
site URL and the Bunny library id. Server secrets never live in clients.

## Releasing

1. Bump the version in `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json` and
   `apps/desktop/src-tauri/Cargo.toml` (they must match the tag).
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.

The Release workflow builds installers for macOS (Apple Silicon + Intel) and Windows x64 and the
extension zip, signs the updater bundles with `TAURI_SIGNING_PRIVATE_KEY`, writes `latest.json`
and publishes the GitHub release as **latest**. Installed apps (tauri-plugin-updater) read
`releases/latest/download/latest.json` on launch and self-update. Stable download names
(`Lare-macOS-AppleSilicon.dmg`, `Lare-macOS-Intel.dmg`, `Lare-Windows-x64-Setup.exe`,
`Lare-Chrome-Extension.zip`) are re-uploaded alongside the versioned files so the README links
never change. Running the workflow manually produces a draft release that is never marked latest.

The updater public key lives in `tauri.conf.json` (`plugins.updater.pubkey`); the private key is
the `TAURI_SIGNING_PRIVATE_KEY` repository secret. Losing it means shipped apps can no longer
verify updates, so keep a backup. Apple notarisation is optional and picked up from the usual
`APPLE_*` secrets when present.


## License

AGPL-3.0-only. Portions derived from Cap (AGPL-3.0 / MIT); see `NOTICE`.
