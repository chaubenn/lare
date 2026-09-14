# QA checklist

## Automated

From the repository root:

```sh
pnpm lint                                                    # biome
pnpm -r --if-present typecheck
pnpm test                                                    # shared, capture, desktop, web unit tests
pnpm --filter @lare/extension e2e                            # Playwright, real Chromium
```

Rust (needs `pnpm setup:native` first, for the prebuilt ffmpeg):

```sh
cargo check --workspace --all-targets
cargo test -p lare-core -p lare-bunny -p lare-transcribe -p scap-dxgi
cargo clippy -p lare-core -p lare-bunny -p lare-recording -p lare-transcribe -p lare-desktop -- -D warnings
```

Two harnesses compile production code without ffmpeg, Cap or a GUI, and are worth running on
their own when you touch the capture/upload or socket paths:

```sh
cargo test --manifest-path crates/lare-recording/stream-tests/Cargo.toml      # muxer + live TUS
cargo test --manifest-path apps/desktop/src-tauri/protocol-tests/Cargo.toml   # socket + PCM
```

Edge functions (`cd supabase/functions`):

```sh
deno check --node-modules-dir=none $(find . -name '*.ts')
deno test  --node-modules-dir=none --allow-net --allow-env --allow-read
```

`ci-dev.yml` runs lint, typecheck, the shared tests and a web build on every push to `dev`.
`ci.yml` runs everything above on macOS and Windows for the `dev -> main` PR. The items below
are the manual passes — the ones that need a real microphone, a real screen, and real money
going through Bunny.

> **The one prerequisite.** A receipt is not playback. `bunny-finalize-recording` confirms Bunny
> has the bytes; how long until the video *plays* is Bunny's encode, which is a library setting
> (Allow Early Play, or Premium/JIT encoding), not something the code can shorten. Check which
> one the library has on before reading any "still processing" as a bug.

## What changed in v1, and what to point QA at

- Recording is no longer serial. Bytes upload **during** the recording, so stop should feel
  instant regardless of length. A 45-minute interview and a 45-second one should finish in about
  the same time after stop.
- The extension's toolbar icon opens a **side panel**, not a popup, and the extension — not the
  desktop app — captures interviews.
- Interviews are **graded** (desktop app running, local Whisper, AI review) or **ungraded**
  (cloud only, no transcript, no AI). Nothing degrades silently.
- There is no Recordings page. Local files are cleaned up once the cloud confirms receipt.
- The website has the desktop app's shell, plus drafts, sessions and browser recording.

## Chrome extension

- Load `apps/extension/.output/chrome-mv3-dev` at `chrome://extensions` (Developer mode) and open
  any LeetCode problem. Nothing should appear on the page — passive practice has no on-page UI.
- Click the toolbar icon: the **side panel** opens (not a popup) and stays open across tab
  switches. Sign in (GitHub or email OTP); the panel shows the handle and
  `chrome://extensions` -> Errors is empty.
- **Passive capture**: open a problem, type in the editor, **Submit** a solution. Without touching
  the extension, expect in Supabase a `session_problems` row on the user's `is_practice_inbox`
  session and a `submissions` row (runtime/memory percentiles and distribution present after the
  retry window). The panel lists the problem as `n/m accepted`.
- Open a second problem: a second `session_problems` row joins the same inbox session, and both
  show up under **Tracked problems** in the desktop app's Drafts page *and* on the web `/drafts`.
- The toolbar badge counts unposted tracked problems. Post or **Clear all** them from the
  desktop app, then open the side panel: they drop off the panel and the badge clears (the
  worker also re-checks every two minutes).
- **Clear all** in the side panel (or tick some and **Clear N selected**) asks to confirm, then
  deletes those rows from the inbox: gone from the panel, the badge, and the desktop picker.
- **Publishing** a subset from the panel or from Drafts calls `publish_practice_problems`: the
  chosen problems move off the inbox onto the new post's session and disappear from the picker;
  the ones left behind stay. `active_ms` is 0 for passively captured problems and no duration is
  rendered anywhere.
- Content-script fragility: capture survives LeetCode's SPA navigation and a hard reload
  (state restored from `chrome.storage.local`).
- Service worker restart (click *Service worker* -> stop in `chrome://extensions`): the next
  problem opened and the next submission are still captured, and a recording in progress keeps
  its red dot **and** its red tab group.

### Interview capture (the extension owns this now)

- **Toolbar hand-off**: Chrome only captures a tab the extension was invoked on (its icon or
  Alt+Shift+L on that tab), and a click inside the side panel never counts. Reload the problem
  tab, press **Start**: the panel asks for a click on the Lare icon and the badge reads `REC`.
  Click the icon on that tab: recording starts, the side panel stays open. Click it on another
  tab: the panel says to switch back. **Cancel**, or two minutes without a click, restores the
  icon to opening the panel. Starting again on the same tab without reloading needs no click.
- **First interview on a fresh profile**: Chrome cannot show a permission prompt in a side
  panel, so **Start** opens a small Lare tab that asks for the mic (and camera, if ticked),
  closes itself once allowed, and the interview starts. Deny it: the panel says what to change.
  On macOS with Chrome switched off under Privacy & Security → Microphone, the message says so
  instead of a bare "Permission denied".
- **Transcript & AI review** starts ticked only when the desktop app can grade. Tick it without
  one and the panel names the blocker: app not running, signed out, a different account, or no
  speech model. Fix it and press **Check desktop grading connection**: it reconnects and clears.
- **Graded, desktop app running**: start a mock interview from the side panel with **Transcript &
  AI review** on.
  - The red dot appears on the problem page and Chrome's tab strip turns red
    ("Lare • Recording").
  - Upload progresses *while recording*. Watch the network panel or the panel's progress.
  - Stop: the video should finalize within a couple of seconds, and the transcript should
    already be there — the AI review fires immediately rather than after a Whisper pass.
- **Word seams.** Whisper runs in ~30 s windows with ~2 s overlap. Listen specifically for
  clipped or duplicated words at window boundaries; this is the known risk of the design.
- **Ungraded**: untick **Transcript & AI review** (or close the desktop app) and start. The panel
  must say plainly that this disables the AI review. On stop: video, no transcript, no review,
  and the session reads as deliberately ungraded rather than as a failed graded one.
- **Desktop disappears mid-interview**: quit the app while recording. The extension buffers audio
  (up to five minutes unacknowledged) and resumes if the app comes back. If it does not come back
  within 45 s of stop, the session is marked ungraded with a visible explanation **and the video
  is still saved**. It must never fail the recording.
- **Stale desktop build**: an old app that advertises `recordingCapable: true` but not
  `pcm16k-f32-v1` must read as "not available for grading", not error.
- **Tab group, the destructive case**: put the LeetCode tab into one of your *own* tab groups
  first, then record. On stop, the tab must go back into **your** group with its original title,
  colour and collapsed state — not be left ungrouped.
- Drag the tab out of the Lare group mid-recording: it is re-applied once, and if you drag it out
  again it is left alone. The on-page dot stays up throughout — that is the consent signal, the
  tab group is decoration.
- Close the recorded tab mid-recording: the recording stops and finalizes with what has streamed,
  which should be nearly everything.
- Incognito (with the extension allowed): `tabGroups` may be unavailable. Degrade to the on-page
  dot; do not fail the recording.
- There is no summary/demo recorder in the extension; that is draft work in the desktop app and
  the web.

## Desktop

- First launch: sign in (GitHub, loopback redirect), onboarding sets a handle, then **Set up
  recording** lists Screen Recording, Camera and Microphone plus the speech model. Allow each,
  **Quit & reopen Lare** after Screen Recording, and it does not come back once everything is
  granted. **Skip for now** is remembered for that app version only.
- Install the next build over it: with a stable signing identity configured
  (`docs/releasing.md`) nothing is asked again; without one, setup reappears listing what the
  update revoked.
- Settings -> Recording: permissions show Granted after allowing Screen Recording, Microphone and
  Camera (macOS needs a restart after Screen Recording). Device pickers list displays/mics/cameras.
  Download `small.en` once — grading is unavailable without a local model.
- The sidebar has no **Recordings** tab, and `/recordings` is gone.
- Draft -> **Record (Instant)** with mic + facecam: camera bubble and pill appear. Upload
  progress should start climbing *during* the recording, not after stop. Stop -> video attached to
  the draft -> status goes processing -> ready (Realtime) -> player loads with a tokenised embed.
  - Then check the app data folder (`Lare/recordings`): the instant take's files are **gone**
    once the receipt is confirmed.
  - Pull the network cable mid-upload. The upload must fail visibly, the local source must be
    **kept**, and the draft's Media step must offer a retry that works.
- Draft -> **Record (Studio)** -> pause/resume once -> stop -> editor opens with "Take 1 of 2";
  trim, split, mark in/out, AI highlights (interviews) -> **Render & publish** -> draft shows the
  video; **Render only** writes `output/result.mp4`. Studio uploads after the render — that is
  expected, not a regression.
  - After publishing an edit, the project tracks stay on disk; the exported MP4 does not.
- **Unedited video skips the render.** Record instant, change nothing, publish: no render stage
  should appear in the jobs tray at all. Make one trim and it should.
- `/studio/:videoId` on a **cloud** video: it imports a signed Bunny MP4 rendition into a fresh
  local project. If the library is not configured per `docs/cloud-studio.md`, expect an explicit
  source-unavailable message, not a silent failure or a broken editor.
- Mock interview started from the extension: the desktop shows the live transcript as it is
  spoken. On stop, Sessions -> the session shows video, transcript, code timeline and the AI
  review. The 5/day limit surfaces as a toast.
- Mock interview with **facecam off**: same pipeline, no camera track, transcript and review must
  still work.
- Stopping never takes the app with it: stop an instant take from the pill, stop a studio take,
  and end an interview from the extension while the pill is still on screen. In each case the pill
  and the camera bubble leave the screen, the camera light goes out, and the app is still running.
- Pause a studio take for a while, resume, then stop: the pill's timer counts only the recorded
  stretches, and the editor's clips add up to the same length.
- Force-quit mid-recording (Activity Monitor), reopen: the take is recovered from Cap's original
  DASH tracks into a separate `output.mp4` — never by resuming the partial combined file at a
  stale offset — and the draft can still be finished.
- **Draft stepper**: Problems -> Media -> Details -> Extras -> Review & publish. Each step
  refuses to advance while invalid; Media blocks on an active capture or a pending upload; the
  draft saves continuously, so closing the window mid-step loses nothing.
- Draft -> "Include with the post": switching the **Session card** off removes the stored card and
  drops the first slide (Preview and Photos agree); switching it back on regenerates it. **AI
  scores on the session card** (interviews with a review) draws the overall grade and the five
  skill percentages on it.
- Interview draft -> **Summary video** -> Record (Instant): uploads to the second slot and appears
  as the third slide (after the session card and the session breakdown), with the full recording
  fourth. Removing it detaches only that slot.
- Publish a draft; the post page in the desktop and on the web render the runtime chart, code and
  video. A private account's public post is invisible to a stranger and visible to an accepted
  follower.

## Web

- **Signed in, `md` and up**: the sidebar shell appears, with the same nav and active-pill motion
  as the desktop app. The logo goes to the landing page.
- **Below `md`, or signed out**: the old header and bottom tab bar, untouched. Mobile must not
  have been sacrificed for the shell — check a phone viewport specifically.
- `/drafts` and `/drafts/[id]`: the same five-step stepper as the desktop app, tracked problems
  included. Autosave survives a reload mid-step.
- `/sessions` and `/sessions/[id]`: timeline, per-problem submissions with verdicts and
  percentiles, code edit timeline, transcript and AI review inline — owner-only.
  - An **ungraded** session says so, and offers no review. It must not look like a graded session
    that failed.
- **Browser recording** (`BrowserRecorder`): record a general video and a summary video on the
  web. Needs HTTPS or localhost. Chunks upload during recording, same as the extension.
- Anywhere the web hits the local-Whisper boundary, it points at the desktop app as a capability
  ("you can do everything on the web except be graded"), not as a paywall.
- `/p/[id]` for a public post renders without sign-in; the video plays; AI insights show only when
  the author enabled them.
- `/u/[handle]` for a private profile shows a lock and the follow-request button; accepting from
  the desktop/web Requests page reveals the posts.

## Database

`0015_v1.sql` is idempotent — apply it twice against a disposable database and confirm both the
second run and these behaviours. `supabase/functions/_tests/v1_schema.sql` is the isolated
fixture that does exactly this; it is **not** a migration and must never be run against real data.

- A client cannot `insert` into `videos` at all; videos come from `bunny-create-upload`.
- A video's `id`, `user_id`, `bunny_video_id` and `library_id` cannot be changed after creation.
- A video cannot be attached to somebody else's session.
- `upsert_transcript_segments` merges rolling windows by start timestamp, so a retried window
  replaces rather than duplicates.
- An `interview_reviews` write is rejected when `sessions.graded` is false — including from the
  service role.

## Windows

Built by CI only so far; run the installer on a Windows machine and repeat the Desktop section.
Known unknowns: capture device enumeration and ffmpeg DLL loading (`target/ffmpeg/bin/*.dll` are
bundled next to the executable).
