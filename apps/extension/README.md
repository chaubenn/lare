# Lare extension 0.4.8

Chrome 116+. The toolbar opens a side panel, not a popup. OAuth/email sign-in, passive
problem/submission capture and inbox draft creation do not require the desktop app.

## Mock interviews

The desktop app records mock interviews; the extension does not capture media. Starting one from
the side panel's Mock interview tab:

1. connects to the desktop over `ws://127.0.0.1:47831` and requires a `hello.ack` for the same
   account with `recordingCapable: true` (the panel names the blocker otherwise);
2. creates the session and problem rows, shows the on-page red dot, and sends `session.start`;
3. waits for the desktop's `recording.state` (`recording`, or `error` with a message).

Pause, resume and end send `session.pause`, `session.resume` and `session.end`. The desktop stops
recording, transcribes locally and uploads; the extension finalizes the session and creates the
draft. Closing or fully navigating the recorded tab ends the interview; SPA problem changes keep
the dot.

## Verification

- `pnpm --filter @lare/extension typecheck`
- `pnpm --filter @lare/extension build`
- `pnpm --filter @lare/extension e2e`

E2E drives the side panel and background worker against a local Supabase fixture and a fake
desktop socket (`e2e/fakeDesktop.ts`): no desktop, a different account, a recording error, and a
full start/pause/end.
