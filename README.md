# Lare

Hevy for LeetCode. Log practice sessions with a pausable timer, capture your submissions
(code, runtime and memory percentiles, the runtime distribution graph), share posts with
followers, attach demo videos, and run AI-graded mock interviews.

## Parts

| Path | What it is |
| --- | --- |
| `apps/extension` | Chrome extension (MV3, WXT). Session timer, LeetCode problem + Monaco edit capture, judge result capture, mock-interview trigger. |
| `apps/desktop` | Tauri 2 desktop app. Drafts and publishing, screen/camera/mic recording (recycled from Cap), whisper.cpp transcription, Bunny uploads, interview review. |
| `apps/web` | Next.js site. Public post pages, profiles, follower feed. |
| `packages/shared` | Shared TypeScript contracts: edit-log replay, timer maths, LeetCode parsers, extension <-> desktop protocol, AI review schema. |
| `packages/supabase-types` | Generated database types. |
| `crates/lare-core` | Rust mirror of the protocol and edit-log types. |
| `crates/cap` | Vendored crates from [Cap](https://github.com/CapSoftware/Cap) (see `NOTICE`). |
| `supabase` | Migrations and Edge Functions. |

## Backend

- Supabase project `lare` (`jndqrvwkwoyvzoqcveev`, Sydney): Postgres with RLS, Auth, Storage, Realtime, Edge Functions.
- Bunny Stream library `lare` (id `743884`): video storage, encoding and delivery.

## Development

```bash
# prerequisites (macOS): brew install cmake pkg-config pnpm deno vercel-cli supabase/tap/supabase
pnpm install
pnpm --filter @lare/shared test
pnpm dev:extension     # then load apps/extension/.output/chrome-mv3-dev in chrome://extensions
pnpm dev:web
pnpm dev:desktop
```

If `pnpm install` fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` on macOS, point Node at
the system CA bundle: `echo "cafile=/etc/ssl/cert.pem" >> ~/.npmrc`.

## License

AGPL-3.0-only. Portions derived from Cap (AGPL-3.0 / MIT); see `NOTICE`.
