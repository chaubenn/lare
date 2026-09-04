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

Tag `vX.Y.Z` (or run the Release workflow manually) to build unsigned installers for macOS
(Apple Silicon + Intel) and Windows x64 plus the extension zip, attached to a draft GitHub release.
Signing/notarisation needs the usual `APPLE_*` / `TAURI_SIGNING_*` secrets.


## License

AGPL-3.0-only. Portions derived from Cap (AGPL-3.0 / MIT); see `NOTICE`.
