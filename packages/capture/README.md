# @lare/capture

Shared browser MediaRecorder capture for the website and extension offscreen document.
No Supabase dependency; the caller supplies authenticated Edge Function callbacks.

```ts
import { startCapture } from "@lare/capture";

const capture = await startCapture({
  stream, // Already acquired and mixed screen/camera/audio tracks.
  createUpload: async ({ mimeType }) => {
    const { data, error } = await supabase.functions.invoke("bunny-create-upload", {
      body: { mode: "instant", title: "Demo", captureSource: "web", mimeType },
    });
    if (error) throw error;
    return data;
  },
  finalizeUpload: async (body) => {
    const { error } = await supabase.functions.invoke("bunny-finalize-recording", { body });
    if (error) throw error;
  },
  onProgress: ({ uploadedBytes, recordedBytes }) => updateProgress(uploadedBytes, recordedBytes),
  onError: (error) => showError(error.message),
});

// At stop: wait for MediaRecorder's last event, final TUS acknowledgement, backend receipt.
const result = await capture.stop();
stream.getTracks().forEach((track) => track.stop());
// result: { videoId, uploadUrl, sizeBytes, durationMs }
// Poll videos.status for playback readiness; uploaded does not mean encoded.
```

`stop()` is idempotent. After a failed stop, `retry()` retries the retained upload and
backend finalization; it does not start another recording. `discard()` stops capture
and explicitly removes its local spill files. It does not delete the cloud video or
stop caller-owned media tracks. Use the existing `video-delete` function for cloud deletion.

`pause()` / `resume()` pause/resume MediaRecorder without losing the current upload;
paused time is excluded from `durationMs`. Pause microphone transcription separately
on the same user action to keep its media clock aligned.

`preferredMimeType()` chooses supported WebM VP9/Opus, VP8/Opus, WebM, then MP4.
`mimeType`, `timesliceMs` (default 2000), and `maxMemoryBytes` (default 128 MiB) are optional.
The API creates the target before starting the recorder. Supply `sessionId` and
`captureSource: "extension"` for extension interviews; persist `sessions.graded` explicitly.

## Reliability and limits

- Deferred TUS POST uses `Upload-Defer-Length: 1`. Relative Location is resolved against
  the endpoint; cross-origin Locations and redirects are rejected to protect credentials.
- Every chunk is written to OPFS before upload. Only acknowledged chunks are removed.
  Pending writes/memory fallback are bounded; quota or memory pressure stops recording
  with an explicit error instead of silently dropping bytes or publishing a partial take.
- PATCH errors and ambiguous responses reconcile with HEAD, including partial acceptance.
  Six exponential retry delays are used per attempt; subsequent recording chunks restart
  an exhausted uploader, allowing recovery from long outages. Requests time out at 120s.
- Final empty PATCH declares actual length. A lost final response is verified with HEAD.
  Backend receipt confirmation retries five times; `retry()` handles longer propagation delays.
- Keep the page/offscreen document alive until completion. OPFS is a spill buffer, not a
  reload/crash recovery database. There is no cross-reload recovery API in V1.
- A capture/OPFS error is fatal to publication, even if some bytes survive; `retry()` only
  recovers transport/finalization failures. Failed takes are not automatically discarded.
- The signed credential lifetime is currently 24 hours. No automatic credential refresh,
  whole-browser restart recovery, or background service-worker recording is promised.
- Stop latency depends on upload backlog and Bunny processing. No paid settings are changed.

Low-level `DeferredTusUpload.create(credentials)` / `.append(blob, absoluteStart, finalLength?)`
are exported for tests/custom producers. Calls must be sequential. Retain each blob until
append resolves; after completion use an empty blob at the total byte offset to finalize.

Tests: `node --experimental-strip-types --test packages/capture/tests/*.test.ts` from the repo root.
