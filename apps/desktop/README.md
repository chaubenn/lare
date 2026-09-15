# Desktop V1 Validation

Run frontend checks from the repository root:

```sh
pnpm --filter @lare/desktop typecheck
pnpm --filter @lare/desktop test
```

The production WebSocket server can be compiled and tested without the native
recorder's FFmpeg and GUI dependencies:

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

- **Mock interviews are recorded here.** The extension's `session.start` reaches
  the registered recorder, which records in instant mode; after stop the
  interview MP4 is transcribed locally and uploaded.
- **Demo and summary captures upload during capture.** `prepare_bunny_upload`
  creates the deferred TUS target before recording, `crates/lare-recording`
  combines Cap's closed DASH fragments into one append-only `content/capture.mp4`
  while capture runs, and `lare_bunny::upload_growing_file` tails it. The
  post-recording upload command joins that tailer rather than starting a
  competing writer. See `crates/lare-recording/README.md` for the muxer's limits
  and its FFmpeg-free test harness.
- **There is no studio editor.** It was removed and is deferred; see
  `docs/deferred/studio.md`.
- Recordings stay on disk after upload and play as a local preview until their
  video is `ready`; `features/media/localCopies.ts` then deletes them (on launch,
  on the Realtime ready event, and every five minutes). Failed uploads stay
  available in their draft's Media step.

## Still Needs A Machine

Receipt is not playback: Bunny's encode wait is configuration (Early Play or
Premium/JIT), not code. Native device capture, AV sync, Whisper inference with a
downloaded model and a live Bunny round trip are not covered by any of the tests
above and need the manual passes in `docs/qa.md`.
