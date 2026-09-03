# Privacy and consent

Lare records people's screens, voices and faces. These are the rules the product follows.

## What stays on the device

- Raw recordings (Cap projects, instant MP4s, exported renders) live in the app data folder
  (`Lare/recordings`) until the user deletes them from the Recordings page.
- Speech transcription runs locally with whisper.cpp; audio never leaves the machine for
  transcription. Only the resulting text is stored in Supabase (`transcripts`).

## What is uploaded, and when

- Nothing is uploaded until the user stops a recording that they started, or ends a mock interview
  they started from the extension. The draft editor states which mode uploads immediately
  ("Instant publishes as soon as you stop").
- Videos go to Bunny Stream (EU company; library replicated to Sydney) under a per-video token:
  playback requires a signed embed URL minted by `bunny-playback-token` after the same visibility
  check as the post itself. Thumbnails are stored in Supabase Storage with the same rules.
- Problem descriptions are stored for the owner's draft view and shown on public pages as an
  excerpt with a link to LeetCode.

## Visibility

- Posts are `public` or `private`. A public post on a **private account** is visible only to
  accepted followers; a private post only to its owner. Follow requests must be accepted.
- Mock-interview grades, transcripts and timestamped moments are shown to others only when the
  author turns on **Include AI insights with the post** for that post.

## Deleting

- Removing a video from a draft or deleting a post calls `video-delete`, which deletes the Bunny
  video, the thumbnail object and the `videos` row.
- Deleting a recording in the app removes the local files.
- Account deletion cascades through `profiles` -> sessions, posts, videos rows (Supabase Auth
  delete); Bunny objects for those videos should be removed with `video-delete` first (todo: a
  scheduled sweep for orphaned Bunny videos).

## Third parties

- Supabase (database, auth, storage), Bunny.net (video), OpenAI (interview grading from the
  transcript, code checkpoints and submissions - no video or audio is sent), GitHub/Google (OAuth).
