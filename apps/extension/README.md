# Lare extension

Chrome 116+. The toolbar opens a side panel, not a popup. OAuth/email sign-in, passive
problem/submission capture and inbox draft creation do not require the desktop app.

Published as [Lare for LeetCode](https://chromewebstore.google.com/detail/lare-for-leetcode/anlejcjfgabfkgbhbcbojlmccagbfdhg) on the Chrome Web Store. Each release also attaches
`Lare-Chrome-Extension.zip`, the same code for an unpacked install; it carries the pinned `key`
the store package leaves out, so it loads under a fixed id (see "Build, CI and releases" in
[`docs/architecture.md`](../../docs/architecture.md)).

## Mock interviews

The desktop app records mock interviews; the extension does not capture media. Starting one from
the side panel's Mock interview tab:

1. connects to the desktop over `ws://127.0.0.1:47831`, checks that it holds this account's
   pairing secret, and requires a `hello.ack` for the same account with `recordingCapable: true`
   (the panel names the blocker otherwise);
2. creates the session and problem rows, shows the on-page red dot, and sends `session.start`;
3. waits for the desktop's `recording.state` (`recording`, or `error` with a message).

Pause, resume and end send `session.pause`, `session.resume` and `session.end`; discard sends
`session.cancel`. The desktop stops recording, transcribes locally and uploads; the extension
finalizes the session and creates the draft. Closing or fully navigating the recorded tab ends the
interview; SPA problem changes keep the dot.

## Layout

`entrypoints/background.ts` wires Chrome events and routes runtime requests (`src/messages.ts` is
the contract). The work is in `src/`: `practice.ts` (inbox tracking, submission queue),
`interview.ts` (mock interview lifecycle, unsaved interviews), `desktopLink.ts` (socket, pairing
secrets, outbox), `desktopSync.ts` (recorder frames, reconnect), `pageEvents.ts` (what a tab
reports), `snapshot.ts` (snapshot, broadcast, badge), `sync.ts` (Supabase writes).

## Verification

- `pnpm --filter @lare/extension typecheck`
- `pnpm --filter @lare/extension build`
- `pnpm --filter @lare/extension e2e`

E2E drives the side panel and background worker against a local Supabase fixture and a fake
desktop socket (`e2e/fakeDesktop.ts`): no desktop, a different account, an unpaired or outdated
app, a recording error, and a full start/pause/end.
