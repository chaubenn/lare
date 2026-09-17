# QA checklist

## Automated

From the repository root:

```sh
pnpm lint                                                    # biome
pnpm -r --if-present typecheck
pnpm test                                                    # shared, capture and desktop unit tests
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
cargo test --manifest-path apps/desktop/src-tauri/protocol-tests/Cargo.toml   # socket
```

Edge functions (`cd supabase/functions`):

```sh
deno check --node-modules-dir=none $(find . -name '*.ts')
deno test  --node-modules-dir=none --allow-net --allow-env --allow-read
```

`ci-dev.yml` runs lint, typecheck, every package's unit tests and a web build on each push to `dev`.
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
- The extension's toolbar icon opens a **side panel**, not a popup. Mock interviews are started
  from it and recorded by the desktop app.
- There is no Recordings page. Local files stay as a preview until their video is ready, then go.
- The website is a landing page. Everything a user does happens in the app and the extension.

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
  show up under **Tracked problems** in the desktop app's Drafts page.
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
  problem opened and the next submission are still captured, and an interview in progress keeps
  its red dot.

### Mock interviews (recorded by the desktop app)

- **No desktop app**: the Mock interview tab says to open the desktop app and **Start** is
  disabled. Signed in to a different account, or without screen recording permission, the panel
  names that instead. Fix it and press **Check desktop connection**.
- **Start** with the desktop app open: the red dot appears on the problem page, the desktop's
  recording pill appears, and the panel timer runs. With **Include camera** on, the camera bubble
  is on screen and in the recording.
- **Detection without a refresh**: open leetcode.com, then a problem from the list (in-page
  navigation): Start still finds it. Reload the extension with a problem tab already open: Start
  finds that tab too.
- **Run, and reloads, mid-interview**: press Run and Submit repeatedly, then reload the problem
  tab. The recording carries on and the red dot comes back after the reload.
- **Pause / Resume** in the panel pause and resume the desktop recording; the pill's timer only
  counts recorded stretches.
- **End & save**: the desktop stops, transcribes the recording with the local speech model, and
  uploads it; the extension creates the draft. Sessions -> the session shows video, transcript,
  code timeline and the AI review.
- **No speech model**: the interview still records and uploads; the session reads as having no
  transcript rather than failing.
- **Recording error** (deny screen recording, or quit the desktop mid-start): the panel shows the
  desktop's message, the dot goes away, and no interview is left running.
- Close the recorded tab mid-recording: the interview ends and the desktop saves what it recorded.
- There is no summary/demo recorder in the extension; that is draft work in the desktop app.

## Desktop

- First launch: sign in (GitHub, loopback redirect), onboarding sets a handle, then **Set up
  recording** lists Screen Recording, Camera and Microphone plus the speech model. Allow each,
  **Quit & reopen Lare** after Screen Recording, and it does not come back once everything is
  granted. **Skip for now** is remembered for that app version only.
- Install the next build over it: with a stable signing identity configured
  (`docs/releasing.md`) nothing is asked again; without one, setup reappears listing what the
  update revoked. In that state macOS still shows Lare switched on under Screen & System Audio
  Recording while Lare reads **Denied** — **Reset permission** clears the stale entry and asks
  again, which is the same thing as removing Lare from that list with "-" by hand.
- The window drags from anywhere along its top strip on sign-in, onboarding and **Set up
  recording**, not only inside the app shell.
- **Notifications** (⌘6) is the only place the app speaks: an upload in progress, a finished or
  failed job, a blocked microphone, an available update and every save error all land there,
  behind one badge. Nothing flashes in a corner any more, so a failed save is silent until you
  look — check the badge after anything that could fail.
- Settings -> Recording: permissions show Granted after allowing Screen Recording, Microphone and
  Camera (macOS needs a restart after Screen Recording). Device pickers list displays/mics/cameras.
  Download `small.en` once — grading is unavailable without a local model.
- The sidebar has no **Recordings** tab, and `/recordings` is gone.
- Draft -> **Record** with mic + facecam: camera bubble and pill appear. Upload
  progress should start climbing *during* the recording, not after stop. Stop -> video attached to
  the draft -> status goes processing -> ready (Realtime) -> player loads with a tokenised embed.
  - Right after stop, before the upload finishes, the draft already shows the video and plays the
    **local preview** (labelled as such) with upload progress underneath; **Remove** is disabled
    until the upload is done. The post page and feed card also play it until the video is ready. The take's folder in the app data folder (`Lare/recordings`) is still
    there; once the status turns ready it is **gone** within a few seconds (or at next launch).
  - Press play on that preview, on a recording of real length (ten minutes, not ten seconds), and
    scrub it. **Play itself must run** — a clock that only moves when you drag the timeline is the
    failure mode of an empty `<track>` inside the player (WebKit then never leaves `HAVE_CURRENT_DATA`).
    It is served from the loopback server, not `asset://`: over a custom scheme WebKit
    walks the file eight bytes at a time and never reaches a duration, so a long recording showed
    its first frame and then did nothing. A short one worked either way, which is why this needs a
    long take to test.
  - Pull the network cable mid-upload. The upload must fail visibly, the local source must be
    **kept**, and the draft's Media step must offer a retry that works.
- Mock interview started from the extension: right after stop the draft and the session page play
  the local recording while it transcribes and uploads; then Sessions -> the session shows video,
  transcript, code timeline and the AI review. The 5/day limit surfaces as a toast.
- Mock interview with **facecam off**: same pipeline, no camera track, transcript and review must
  still work.
- Stopping never takes the app with it: stop a take from the pill, and end an interview from the extension while the pill is still on screen. In each case the pill
  and the camera bubble leave the screen, the camera light goes out, and the app is still running.
- Pause a take for a while, resume, then stop: the pill's timer counts only the recorded
  stretches.
- Force-quit mid-recording (Activity Monitor), reopen: the take is recovered from Cap's original
  DASH tracks into a separate `output.mp4` — never by resuming the partial combined file at a
  stale offset — and the draft can still be finished.
- **Draft stepper**: Problems -> Media -> Details -> Extras -> Review & publish. Each step
  refuses to advance while invalid; Media blocks on an active capture or a pending upload; the
  draft saves continuously, so closing the window mid-step loses nothing.
- The session card is the first slide and is drawn, not stored: open a draft, change the title, and
  Preview shows the new title immediately. There is nothing to generate, regenerate or wait for, and
  the Photos panel holds photos only.
- Draft -> "Include with the post": switching the **Session card** off drops the first slide
  (Preview and the post agree); switching it back on restores it.
- Interview draft -> **Summary video** -> Record (Instant): uploads to the second slot and appears
  as the third slide (after the session card and the session breakdown), with the full recording
  fourth. Removing it detaches only that slot.
- Publish a draft; the post page renders the runtime chart, code and
  video. A private account's public post is invisible to a stranger and visible to an accepted
  follower.
- **Pending posts**: publish while the video is still processing. The author sees the post with a
  **Pending** badge (feed card, post page, profile tile) and can watch the local preview; a
  second account does not see it in the feed or at its link. When the video turns ready the post
  appears for the second account at the top of the feed and the badge goes. A failed video shows
  **Not visible** until it is replaced or hidden.

## Web

- The site is one page: what Lare is, and buttons to the releases and the extension. There is no
  sign-in, no feed, no post or profile pages — nothing that needs a session.
- Both download buttons reach the GitHub releases page.

## Database

### Running a fixture

Each fixture mounts its migration at `/migration.sql` and applies it twice, so a throwaway
Postgres container is the whole harness — no Supabase project, no credentials, and nothing
that can reach real data:

```bash
docker run -d --name fx -e POSTGRES_PASSWORD=postgres postgres:16
until docker exec fx pg_isready -U postgres; do sleep 1; done
docker cp supabase/migrations/0019_hidden_videos_stay_hidden.sql fx:/migration.sql
docker cp supabase/functions/_tests/hidden_videos.sql fx:/fixture.sql
docker exec fx psql -U postgres -v ON_ERROR_STOP=1 -q -f /fixture.sql
docker rm -f fx
```

A pass prints `<name> fixture passed` and exits 0; a failed assertion exits 3 with the message.
**Use a fresh container per fixture** — the fixtures `create role anon`, and roles are
cluster-wide, so a second fixture in the same container dies on `role "anon" already exists`.
On Git Bash, prefix the `docker exec` calls with `MSYS_NO_PATHCONV=1` or `/fixture.sql` is
rewritten to a Windows path.

`0018_pending_posts.sql` is idempotent; `supabase/functions/_tests/pending_posts.sql` is its
isolated fixture (pending, hidden videos, drafts, the ready trigger, swapping a video back to
pending). Run it the same way as the others, never against real data.

`0019_hidden_videos_stay_hidden.sql` is idempotent;
`supabase/functions/_tests/hidden_videos.sql` is its isolated fixture. It proves a clip the
author switched off is not selectable by a viewer of the post — which matters because the GUID
in that row is a permanent link to the file — while the author still sees their own hidden
clips. Same rules: disposable database only. Verified against the old `0010` definition too —
the fixture fails there on the hidden-video assertion, so it catches the regression rather than
passing whatever it is given.

`0020_post_references_stay_owned.sql` is idempotent;
`supabase/functions/_tests/post_references.sql` is its isolated fixture. It proves a post cannot
be pointed at another user's session or videos, or at a cover image from another post, on insert
or on update, while the author's own rows and detaching (setting a slot to null) still work. The
visibility helpers open a session's problems, submissions, transcript, review and clips to anyone
who can view a post that references them, which is what made the reference itself the leak. Same
rules: disposable database only.

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
