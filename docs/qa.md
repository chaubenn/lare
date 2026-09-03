# QA checklist

Automated: `pnpm lint`, `pnpm -r typecheck`, `pnpm --filter @lare/shared test`, extension Playwright
e2e (Monaco fixture with mocked judge/Supabase), `cargo test`/`cargo clippy` for the Lare crates, and
the CI workflow runs all of it on macOS and Windows. The items below are the manual passes.

## Chrome extension

- Load `apps/extension/.output/chrome-mv3-dev` at `chrome://extensions` (Developer mode) and open
  any LeetCode problem. The overlay pill appears bottom-right.
- Sign in from the popup (GitHub). The popup shows the handle; `chrome://extensions` -> Errors is
  empty.
- **Start problem** -> timer runs -> type in the editor -> **Pause** -> **Resume** -> **Submit** a
  solution -> the "Accepted / Wrong Answer" toast appears -> **End**. Expect in Supabase:
  `sessions` (status ended, active_ms excludes the pause), `session_problems`, `submissions`
  (runtime/memory percentiles and distribution present after the retry window), an edit log in
  Storage, and a draft post.
- **Start session** across two problems: navigating to a second problem creates a second
  `session_problems` row; the draft lists both.
- Content-script fragility: the pill re-attaches after LeetCode's SPA navigation and after a hard
  reload mid-session (state restored from `chrome.storage.local`).
- Service worker restart mid-session (click *Service worker* -> stop in `chrome://extensions`):
  the timer continues from the event log; ending still uploads the edit log.
- Desktop offline: **Mock interview** is disabled with an explanation; with the app open it enables
  and the recorder pill appears within ~2 s of pressing start.

## Desktop

- First launch: sign in (GitHub, loopback redirect), onboarding sets a handle.
- Settings -> Recording: permissions show Granted after allowing Screen Recording, Microphone and
  Camera (macOS needs a restart after Screen Recording). Device pickers list displays/mics/cameras.
  Download `small.en` once.
- Draft -> **Record (Instant)** with mic + facecam: camera bubble and pill appear; stop -> upload
  progress in the jobs tray -> video attached to the draft -> status goes processing -> ready
  (Realtime) -> player loads with a tokenised embed URL.
- Draft -> **Record (Studio)** -> pause/resume once -> stop -> editor opens with "Take 1 of 2";
  trim, split, mark in/out, AI highlights (interviews) -> **Render & publish** -> draft shows the
  video; **Render only** writes `output/result.mp4`.
- Mock interview from the extension: on end, the jobs tray shows render -> transcribe -> upload ->
  captions; Sessions -> the session shows video, transcript, code timeline and a **Generate AI
  review** button (5/day limit surfaces as a toast).
- Recordings page: unfinished pipelines can be resumed; delete removes the folder.
- Publish a draft; the post page in the desktop and on the web render the runtime chart, code and
  video. A private account's public post is invisible to a stranger and visible to an accepted
  follower.

## Web

- `/p/[id]` for a public post renders without sign-in; the video plays; AI insights show only when
  the author enabled them.
- `/u/[handle]` for a private profile shows a lock and the follow-request button; accepting from
  the desktop/web Requests page reveals the posts.

## Windows

Built by CI only so far; run the installer on a Windows machine and repeat the Desktop section.
Known unknowns: capture device enumeration and ffmpeg DLL loading (`target/ffmpeg/bin/*.dll` are
bundled next to the executable).
