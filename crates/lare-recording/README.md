# Native Realtime Output

Instant recordings retain Cap's native display capture, microphone/system-audio
mixing, camera preview behavior, encoders, and pause/resume timestamps. Cap still
writes its recovery DASH tracks. `live.rs` consumes Cap's closed-fragment events
and `fragmented.rs` combines their movie headers and remaps track IDs into one
append-only `content/capture.mp4` while capture is running. It does not concatenate
two standalone MP4 files or wait until stop to combine tracks.

The combined file contains one video track and optional mixed AAC audio. Sample
payloads, decode timestamps, sample durations, composition offsets and track edit
lists are preserved. Single-track DASH indexes are omitted; fragment sequence
numbers and track IDs are rewritten before appending. Only moof-relative fragments
are accepted. Unsupported layouts fail rather than silently corrupting offsets.

The desktop's `prepare_bunny_upload` registers one pending target for the next
`recording_start`. Start consumes it even on a failed/studio attempt. An explicit
`upload: { tus, uploadUrl }` start argument can override it. Instant capture starts
`lare_bunny::upload_growing_file` immediately and persists its resume URL beside
the file. The existing post-recording upload command joins that tailer instead of
starting a competing PATCH writer. Backend receipt confirmation and deletion
remain in the frontend publishing pipeline.

## Completion And Recovery

- Temporary EOF is not completion. Stop joins Cap's producer, drains queued closed
  fragments, flushes/syncs/closes the combined file, writes `capture.complete`, and
  only then signals final length to the uploader.
- Cancellation aborts the tailer before deleting files. A muxer/producer failure
  never signals successful completion. Failed uploads keep the source and URL for
  retry; live upload errors are surfaced by the completion upload command.
- The completion marker makes crash recovery distinguish a finished capture from
  a partial append-only file. Without it, recovery uses Cap's original tracks and
  produces a separate `output.mp4`, never resumes a changed file at an old offset.
- Original DASH tracks coexist with the combined output until cloud receipt and
  cleanup. This increases temporary disk usage. There is no cross-process resume
  of a still-running producer, nor credential refresh during long captures.

## Limits

- Realtime upload applies to **instant demo captures** with a prepared target.
  Studio capture keeps separate editable tracks and uses the unchanged full
  renderer. Studio/interview upload still follows rendering.
- Edited rendering cannot safely stream through the current public cap-export
  API: its MP4File writer seeks and uses `+faststart`. No unsafe tailing of that
  output, reduced editor, or replacement renderer was introduced.
- Latency is fragment-scale, not frame-scale: Cap normally closes video fragments
  around two seconds and audio fragments around three seconds, plus encoder and
  network delay. Short captures may only publish media at stop.
- The muxer accepts Cap's single-track, 32-bit-size, unencrypted DASH boxes with
  moof-relative sample offsets and matching movie timescales. It is not a general
  MP4 importer. It preserves Cap's timing, rather than introducing new AV-sync or
  drift correction. Camera in instant mode remains the captured preview window.
- A network failure does not interrupt local capture. A mux failure is reported
  at stop, where the desktop attempts its existing source-fragment recovery.
- No native device run, decoder/playback test, or live Bunny receipt was performed
  in the dependency-free validation environment. Live Bunny deferred-length
  support and native AV sync still require release smoke testing.

## Validation Without FFmpeg

From the repository root:

```sh
cargo test --manifest-path crates/lare-recording/stream-tests/Cargo.toml
cargo clippy --manifest-path crates/lare-recording/stream-tests/Cargo.toml --all-targets -- -D warnings
cargo test -p lare-bunny
```

The isolated harness compiles the **production** muxer and producer lifecycle,
without Cap, FFmpeg libraries, capture permissions, or GUI dependencies. Its seven
tests cover track/header remapping, timestamps/data offsets, immutable prefixes,
silent capture, malformed/unsupported fragments, missing tracks, failed/dropped
producers, and an HTTP TUS capture/upload lifecycle. The HTTP test proves combined
video/audio bytes arrive before stop, drains a final queued fragment, checks exact
uploaded bytes, and verifies that length remains deferred until close. Synthetic
box payloads test container behavior, not H.264/AAC decoding.

Full native checks (`cargo check -p lare-recording` and desktop checks) need the
repository's FFmpeg development libraries; they are blocked when `libavutil.pc`
is unavailable.
