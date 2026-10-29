# Privacy and consent

Lare records people's screens, voices and faces. These are the rules the product follows.

## What stays on the device

- **Speech transcription runs locally** with whisper.cpp. Audio never leaves the machine for
  transcription, and only the resulting text is stored in Supabase (`transcripts`). This is the
  one thing that only happens on your machine, and it is not moving to the cloud.
  - For an interview, the desktop app records the screen and microphone itself and transcribes
    the recording after it stops. The extension only tells it when to start, pause and end, over
    the loopback socket (`ws://127.0.0.1:47831`).
- Local recordings are temporary — see below.

## What is uploaded, and when

- **Video is uploaded while it records, not after you stop.** Chunks are sent to Bunny Stream as
  they are produced, so at stop only the last few seconds are still in flight. The practical
  consequence for privacy: the bytes are already leaving the machine during the recording, not at
  the moment you decide to keep it. Stopping early does not keep what was already sent — discard
  the video if you do not want it kept.
- **The local copy lasts until the cloud copy has processed.** A desktop recording stays in the
  app data folder (`Lare/recordings`) after upload so the author can watch it immediately, and is
  deleted once its video is `ready` (or the video was removed). A failed upload or a video that
  failed to process keeps its source so it can be retried. A browser recording's preview lives
  only in that tab's memory. There is no Recordings page, because there is no local library to
  manage.
- **Practice is captured automatically**, with no start button: while the extension is installed
  and signed in, every LeetCode problem opened and every submission judged is saved (problem,
  code, verdict, runtime and memory). It is private to the account — it stays in the user's
  practice inbox and is visible to nobody until they explicitly publish a post. The extension's
  side panel lists everything held, and removing the extension stops the capture.
- **Nothing is recorded** — screen, camera or microphone — until the user starts a recording, or
  starts a mock interview from the extension's side panel. While an interview is recording, a
  red dot sits on the LeetCode page for its whole duration and the desktop app shows its recording
  pill: the extension shows no other on-page UI, but **it never starts a recording without the
  dot**.
- Each video records which surface produced it (`videos.capture_source`: `desktop`, `extension`
  or `web`; `web` is historical) so quality complaints can be diagnosed. It is metadata about the
  capture path, not
  about the user.
- Videos go to Bunny Stream (EU company; library replicated to Sydney) under a per-video token:
  **the player** requires a signed embed URL minted by `bunny-playback-token` after the same
  visibility check as the post itself. Thumbnails are stored in Supabase Storage with the same
  rules.

### The limit of that protection

The signed embed gates the *player*. It does not gate the video file behind it, and this is
worth being plain about because Lare records people's faces and voices.

Bunny Stream's embed player and its CDN token authentication are mutually exclusive — enabling
token authentication returns 403 for the playlist and segment requests the player itself makes,
so playback stops working for everything. Using the embed player therefore means the underlying
MP4 is guarded only by the library's referrer rule, which refuses requests with no `Referer`
and serves every request that has one. Anyone holding a video's Bunny GUID can fetch the file
directly.

What that does and does not mean:

- The GUID is a UUIDv4 and is only released for a video the post actually shows, so videos
  cannot be discovered, enumerated or guessed. A stranger cannot reach a private post.
  `show_video` and `show_demo_video` are enforced in `private.can_view_video`, not only in the
  UI, so a clip the author switched off is not selectable, has no playback token, and its
  thumbnail is not readable either (migration `0019`).
- But **anyone who was allowed to watch a video can keep a permanent direct link to it**, and
  that link keeps working after the post is made private, after it is unshared, after the clip
  is hidden, and after the five-minute playback token expires. Only deleting the video
  (`video-delete`, which removes it from Bunny) actually revokes access.

Treat "this person was allowed to watch it once" as "this person may keep a copy". That is true
of any un-DRM'd video on the web — a viewer can always record their own screen — but here it is
one request rather than an effort, so it should be stated rather than implied. Closing it fully
needs Bunny's DRM, which is a paid enterprise feature, and is not part of v1.
- Problem descriptions are stored for the owner's draft view and shown on public pages as an
  excerpt with a link to LeetCode.

## Interview transcripts

Every mock interview is recorded by the desktop app and transcribed there with whisper.cpp.
`sessions.graded` is true when that transcript exists; if transcription fails (for example no
speech model is installed), the session is marked ungraded, the video is still saved, and no AI
review can be written to it — the database rejects the write, including from the service role.

## Visibility

- Posts are `public` or `private`. A public post on a **private account** is visible only to
  accepted followers; a private post only to its owner. Follow requests must be accepted.
- A published post stays **pending** — visible only to its author — until every video it shows
  has finished processing (migration `0018_pending_posts.sql`). It goes live on its own when the
  last one is ready, even if the author's app is closed.
- Mock-interview grades, transcripts and timestamped moments are shown to others only when the
  author turns on **Include AI insights with the post** for that post.

## Deleting

- Removing a video from a draft or deleting a post calls `video-delete`, which deletes the Bunny
  video, the thumbnail object and the `videos` row.
- Local recordings are removed automatically once their video has processed.
- Account deletion cascades through `profiles` -> sessions, posts, videos rows (Supabase Auth
  delete); Bunny objects for those videos should be removed with `video-delete` first (todo: a
  scheduled sweep for orphaned Bunny videos).

## Third parties

- Supabase (database, auth, storage), Bunny.net (video), OpenAI (interview grading from the
  transcript, code checkpoints and submissions - no video or audio is sent), GitHub/Google (OAuth).
