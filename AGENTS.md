# Repository Guide

See [.ai/README.md](.ai/README.md) for agent resources and
[docs/architecture.md](docs/architecture.md) for application architecture.

First-party Rust crates live in `crates/lare-*`; upstream Cap code is in
`crates/vendor/cap` and is maintained with `scripts/sync-cap.sh`.
Desktop capture and editing live under `features/media`; drafts and posts under
`features/publishing`. Shared TypeScript domains are grouped under
`packages/shared/src`, with their public API exported from `index.ts`.

Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` for TypeScript changes.
Native validation also needs the dependencies described in `apps/desktop/README.md`.
