# Lare extension 0.4.5

Chrome 116+. The toolbar opens a side panel, not a popup. OAuth/email sign-in,
passive problem/submission capture, inbox draft creation and ungraded interviews
do not require desktop. Transcript & AI review is an explicit opt-in requiring a
same-account desktop handshake advertising `pcm16k-f32-v1`; old
`recordingCapable: true` builds do not qualify.

## Capture

Interviews capture the screen picked in Chrome's share dialog (desktopCapture) in a small recorder window, microphone audio, optional
camera composition, and `@lare/capture` for MediaRecorder/OPFS/live TUS upload.
The side panel asks for microphone/camera permission before the hidden document
uses them. Open the toolbar on the problem tab first so Chrome grants tab capture.
Closing the side panel does not stop the interview. Closing or fully navigating
the recorded tab stops and finalizes it; full navigation deliberately stops
because it destroys the consent indicator. SPA problem changes retain the dot.

The red tab group remembers and restores the user's original group, recreating
single-tab groups that Chrome deleted. One repair is allowed if the user removes
the outline; subsequent regrouping is respected. Incognito/group API failures
fall back to the on-page red dot. Group state and capture status survive worker
restarts. A browser/offscreen crash cannot recover the recorder, although failed
uploads in a living document can be retried. Discard is explicit and confirmed.

Local Whisper receives mono float32 PCM at 16 kHz over loopback from an
AudioWorklet. PCM pauses with MediaRecorder, resumes from the desktop's sample
offset, and retains at most five minutes of unacknowledged audio. Exhaustion or
failure to complete transcription within 45 seconds after stop marks the
session ungraded with a visible explanation; video is still saved.

Summary/demo recording uses a dedicated extension page and Chrome's screen
picker. Keep that page open until upload acknowledgement. Its before-unload
warning prevents accidental navigation where Chrome permits it. Video-only
recordings can be opened directly in the web draft editor.

## Verification

- `pnpm --filter @lare/extension typecheck`
- `pnpm --filter @lare/extension build`
- `pnpm --filter @lare/extension e2e`

E2E includes real Chromium MediaRecorder, camera composition, pause/resume,
OPFS cleanup and streaming upload against a local TUS server. That test
substitutes only the share dialog's desktop stream id with Chrome fake devices;
native toolbar permission prompts and the complete local Whisper workflow still
need manual QA. Safety tests cover stale desktop capabilities, account mismatch,
PCM replay/acknowledgement and tab-group restoration.

Release prerequisites: deploy migration `0015_v1.sql` and the capture Edge
Functions, configure Supabase OAuth redirect URLs, verify Bunny deferred-length
TUS support for the configured library, and test an actual microphone/camera
with the compatible desktop build. Upload acknowledgement does not promise
immediate playback: Bunny encoding/Early Play configuration remains separate.
