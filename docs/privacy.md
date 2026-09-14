# Privacy and consent

Lare records people's screens, voices and faces. These are the rules the product follows.

## What stays on the device

- **Speech transcription runs locally** with whisper.cpp. Audio never leaves the machine for
  transcription, and only the resulting text is stored in Supabase (`transcripts`). This is the
  one thing the desktop app does that the web cannot, and it is not moving to the cloud.
  - For an interview, the extension captures the microphone and streams it to the desktop app as
    raw 16 kHz mono PCM over the loopback socket (`ws://127.0.0.1:47831`). Loopback means the
    audio does not leave the machine; no other process can reach that socket from outside it.
    The app transcribes in rolling windows while the interview runs, so the transcript is ready
    when it ends.
- Studio projects keep their editable source tracks in the app data folder (`Lare/recordings`)
  so an edit can be redone. Everything else local is temporary — see below.

## What is uploaded, and when

- **Video is uploaded while it records, not after you stop.** Chunks are sent to Bunny Stream as
  they are produced, so at stop only the last few seconds are still in flight. The practical
  consequence for privacy: the bytes are already leaving the machine during the recording, not at
  the moment you decide to keep it. Stopping early does not keep what was already sent — discard
  the video if you do not want it kept.
- **The local copy does not survive the upload.** Once Bunny confirms receipt
  (`bunny-finalize-recording`), an instant take's local files are deleted, and an edited take's
  disposable render is deleted while its project tracks stay. Nothing is deleted before the
  receipt: a failed upload keeps its source so it can be retried from the draft's Media step.
  There is no longer a Recordings page, because there is no longer a local library to manage.
- **Practice is captured automatically**, with no start button: while the extension is installed
  and signed in, every LeetCode problem opened and every submission judged is saved (problem,
  code, verdict, runtime and memory). It is private to the account — it stays in the user's
  practice inbox and is visible to nobody until they explicitly publish a post. The extension's
  side panel lists everything held, and removing the extension stops the capture.
- **Nothing is recorded** — screen, camera or microphone — until the user starts a recording, or
  starts a mock interview from the extension's side panel. The draft editor states which mode
  uploads immediately ("Instant publishes as soon as you stop"). While an interview is recording,
  a red dot sits on the LeetCode page for its whole duration: the extension shows no other
  on-page UI, but **it never records without one**.
  - Chrome's own tab strip also turns red, via a one-tab tab group titled "Lare • Recording".
    That is **decoration, not consent** — the user can drag the tab out of it at any time, and
    the recording continues. The on-page dot is the guarantee; the tab group is an extra signal
    that survives tabbing away. When the recording ends, whatever grouping the tab had before is
    put back.
- Each video records which surface produced it (`videos.capture_source`: `desktop`, `extension`
  or `web`) so quality complaints can be diagnosed. It is metadata about the capture path, not
  about the user.
- Videos go to Bunny Stream (EU company; library replicated to Sydney) under a per-video token:
  playback requires a signed embed URL minted by `bunny-playback-token` after the same visibility
  check as the post itself. Thumbnails are stored in Supabase Storage with the same rules.
- Problem descriptions are stored for the owner's draft view and shown on public pages as an
  excerpt with a link to LeetCode.

## Graded and ungraded interviews

A mock interview is one or the other, and the user picks before it starts:

- **Graded** — the desktop app is running and signed in to the same account. The microphone is
  transcribed locally and the AI review is generated from that transcript.
- **Ungraded** — no desktop app, or the user turned **Transcript & AI review** off. The interview
  runs entirely in the cloud: video only, no transcript, no AI review. The toggle says so
  outright rather than degrading quietly.

`sessions.graded` records which one it was. A session that was downgraded mid-interview (the
desktop app went away and did not come back) cannot have a review written to it afterwards — the
database rejects the write, including from the service role, so an AI request that was already
in flight cannot resurrect grading behind the user's back. Audio is still inside the video track
of an ungraded interview; what ungraded means is that Lare never turns it into text.

## Visibility

- Posts are `public` or `private`. A public post on a **private account** is visible only to
  accepted followers; a private post only to its owner. Follow requests must be accepted.
- Mock-interview grades, transcripts and timestamped moments are shown to others only when the
  author turns on **Include AI insights with the post** for that post.

## Deleting

- Removing a video from a draft or deleting a post calls `video-delete`, which deletes the Bunny
  video, the thumbnail object and the `videos` row.
- Deleting a studio project in the app removes its local tracks. Instant takes have already been
  removed automatically once the upload was confirmed.
- Account deletion cascades through `profiles` -> sessions, posts, videos rows (Supabase Auth
  delete); Bunny objects for those videos should be removed with `video-delete` first (todo: a
  scheduled sweep for orphaned Bunny videos).

## Third parties

- Supabase (database, auth, storage), Bunny.net (video), OpenAI (interview grading from the
  transcript, code checkpoints and submissions - no video or audio is sent), GitHub/Google (OAuth).
