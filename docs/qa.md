# QA checklist

Automated: `pnpm lint`, `pnpm -r typecheck`, `pnpm --filter @lare/shared test`, extension Playwright
e2e (Monaco fixture with mocked judge/Supabase), `cargo test`/`cargo clippy` for the Lare crates, and
the CI workflow runs all of it on macOS and Windows. The items below are the manual passes.

## Chrome extension

- Load `apps/extension/.output/chrome-mv3-dev` at `chrome://extensions` (Developer mode) and open
  any LeetCode problem. Nothing should appear on the page — practice has no on-page UI.
- Sign in from the popup (GitHub). The popup shows the handle; `chrome://extensions` -> Errors is
  empty.
- **Passive capture**: open a problem, type in the editor, **Submit** a solution. Without touching
  the extension, expect in Supabase a `session_problems` row on the user's `is_practice_inbox`
  session and a `submissions` row (runtime/memory percentiles and distribution present after the
  retry window). The popup lists the problem as `n/m accepted`.
- Open a second problem: a second `session_problems` row joins the same inbox session, and both
  show up under **Tracked problems** in the desktop app's Drafts page.
- **Publishing** a subset from Drafts calls `publish_practice_problems`: the chosen problems move
  off the inbox onto the new post's session and disappear from the picker; the ones left behind
  stay. `active_ms` is 0 for passively captured problems and no duration is rendered anywhere.
- Content-script fragility: capture survives LeetCode's SPA navigation and a hard reload
  (state restored from `chrome.storage.local`).
- Service worker restart (click *Service worker* -> stop in `chrome://extensions`): the next
  problem opened and the next submission are still captured.
- Desktop offline: **Mock interview** is disabled with an explanation; with the app open it enables,
  the recorder pill appears within ~2 s of pressing start, and the red recording dot — the
  extension's only on-page element — shows on the problem page for as long as it records, then
  goes when the interview ends.

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
- Mock interview with **Include facecam unchecked**: same pipeline, no camera track, and the
  transcript + **Generate AI review** must still work. The render is not allowed to take the
  transcript down with it — the mic track is the fallback.
- Interview draft -> **Summary video** -> Record (Instant): uploads to the second slot and appears
  as the third slide (after the session card and the session breakdown), with the full recording
  fourth. Removing it detaches only that slot.
- Draft -> "Include with the post": switching the **Session card** off removes the stored card and
  drops the first slide (Preview and Photos agree); switching it back on regenerates it. **AI
  scores on the session card** (interviews with a review) draws the overall grade and the five
  skill percentages on it.
- Stopping never takes the app with it: stop an instant take from the pill, stop a studio take,
  and end an interview from the extension while the pill is still on screen. In each case the pill
  and the camera bubble leave the screen, the camera light goes out, and the app is still running.
- Pause a studio take for a while, resume, then stop: the pill's timer counts only the recorded
  stretches, and the editor's clips add up to the same length.
- Force-quit mid-recording (Activity Monitor), reopen: the take is finished on launch and appears
  on the Recordings page rather than being lost.
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
