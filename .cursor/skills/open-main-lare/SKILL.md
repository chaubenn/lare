---
name: open-main-lare
description: >-
  Open the current main-checkout Lare desktop app and Chrome extension watcher
  (developer build, not a release). Use when the user says "open main branch
  state of lare on desktop", "open main", "open the new lare", "run local lare",
  or wants the Tauri app from this repo instead of /Applications/Lare.app.
---

# Open main-branch Lare on desktop

`main` is the developer branch. Released `.dmg` / store packages are the stable versions. Do not bump versions or wait for CI just to try a commit.

## What to run

From the workspace root:

```bash
pnpm open:main
```

That script (`scripts/open-main.sh`):

1. Quits `/Applications/Lare.app` and any `lare-desktop` process (single-instance would otherwise focus the installed app).
2. Starts the extension watcher if it is not already up (`apps/extension/.output/chrome-mv3-dev`).
3. Starts `tauri dev` from this checkout (Vite on `http://127.0.0.1:1420`).
4. Brings the local window forward.

Logs: `.context/open-main-desktop.log`, `.context/open-main-extension.log`.

## Do not

- Open `/Applications/Lare.app`.
- Launch the bare `target/debug/lare-desktop` binary while the installed app is running.
- Bump `package.json` / `tauri.conf.json` / `Cargo.toml` versions for an iterative main commit.
- Run a release/CI build to preview UI work.

## If the window is missing

Run `pnpm open:main` again. If it still fails, read the two log files and report the error. Never fall back to the installed app.
