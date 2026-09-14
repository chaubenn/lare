# Desktop V1 Validation

Run frontend checks from the repository root:

```sh
pnpm --filter @lare/desktop typecheck
pnpm --filter @lare/desktop test
```

The production WebSocket and PCM service can be compiled and tested without the
native recorder's FFmpeg and GUI dependencies:

```sh
cargo test --manifest-path apps/desktop/src-tauri/protocol-tests/Cargo.toml
cargo test -p lare-transcribe --no-default-features --lib
cargo test -p lare-bunny
```

These tests do not exercise real microphone capture, Whisper inference with a
downloaded model, or a live Bunny/Supabase account. Full native validation uses
`cargo test -p lare-desktop --lib` and requires the native dependencies described
in the repository's setup instructions.

## V1 Integration Status

- **Native instant capture uploads during capture.** `prepare_bunny_upload`
  creates the deferred TUS target before recording, `crates/lare-recording`
  combines Cap's closed DASH fragments into one append-only `content/capture.mp4`
  while capture runs, and `lare_bunny::upload_growing_file` tails it. The
  post-recording upload command joins that tailer rather than starting a
  competing writer. See `crates/lare-recording/README.md` for the muxer's limits
  and its FFmpeg-free test harness.
- **Studio capture and edited exports still upload after rendering.** Studio
  keeps separate editable tracks, and `cap-export`'s MP4 writer seeks and uses
  `+faststart`, so its output cannot be safely tailed. This is a deliberate
  limit, not an unfinished piece.
- **`/studio/:videoId` can import a cloud video.** `source_import.rs` downloads
  a signed Bunny MP4 rendition through `bunny-download-source` into a fresh local
  project. It is an encoded copy, not the original recording, and not separate
  camera/microphone layers. The Bunny library settings it depends on are listed
  in `docs/cloud-studio.md`; without them the studio shows the player and an
  explicit source-unavailable message instead.
- Upload receipt is confirmed by `bunny-finalize-recording` before local cleanup.
  Failed uploads stay available in their draft's Media step. Successful instant
  takes are removed; edited project tracks remain, while their exported MP4 is
  disposable.
- `pcm.complete` means the transcript was persisted and the AI review was
  scheduled. Review failures are reported in the desktop and can be retried from
  the session page. The scheduled task is not a durable queue across app exit.

## Still Needs A Machine

Receipt is not playback: Bunny's encode wait is configuration (Early Play or
Premium/JIT), not code. Native device capture, AV sync, Whisper inference with a
downloaded model and a live Bunny round trip are not covered by any of the tests
above and need the manual passes in `docs/qa.md`.
