//! The seam between the local server and the recorder.
//!
//! Interview sessions started from the extension record the screen (+ mic, optional facecam) on
//! the desktop. The server only knows [`RecordingBackend`]: the app registers
//! `recorder::CapRecordingBackend` with
//! [`crate::local_server::ServerContext::set_recording_backend`], and the server's tests register
//! a fake. Until a backend is registered the server answers every interview `session.start` with
//! a `recording.state` error frame so the extension can tell the user.

use std::sync::{Arc, RwLock};

use lare_core::protocol::RecordingSnapshot;

/// Everything the recorder needs from an interview `session.start` frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordingRequest {
    pub session_id: String,
    /// Epoch ms when the session timer started (for aligning edits/transcript later).
    pub started_at: u64,
    /// Show the facecam preview, which is captured as part of the screen.
    pub facecam: bool,
    /// Capture the microphone.
    pub mic: bool,
}

/// The recorder, as the local server sees it. All methods are fire-and-forget: the implementation
/// reports state asynchronously with [`lare_core::protocol::AppToExt::RecordingState`] frames to
/// every connected extension client, e.g. `starting` -> `recording` (with `started_at` = epoch ms
/// of media time 0) -> `stopping` -> `idle`.
///
/// `pause`, `resume`, `stop` and `cancel` must only touch the recording of the session they name.
/// Anything else may be recording (a demo from the draft editor, or another interview), and a
/// stale frame from the extension must not stop it.
pub trait RecordingBackend: Send + Sync {
    /// Start recording for an interview session.
    fn start(&self, req: RecordingRequest);
    /// The session timer was paused (`session.pause`).
    fn pause(&self, session_id: &str, at: u64);
    /// The session timer resumed (`session.resume`).
    fn resume(&self, session_id: &str, at: u64);
    /// The session ended (`session.end`): finish the recording and hand it to the upload pipeline.
    fn stop(&self, session_id: &str, at: u64);
    /// The session was discarded (`session.cancel`): stop the recording and delete it. Also
    /// covers a start that is still coming up: that recording must be thrown away once it lands.
    fn cancel(&self, session_id: &str, at: u64);
    /// Whether screen recording permission is granted and devices are available right now.
    /// Reported to the extension as `hello.ack.recordingCapable`.
    fn capable(&self) -> bool {
        true
    }
    /// What is recording right now, as last reported to the extension. Sent as
    /// `hello.ack.recording` so a reconnecting extension catches up on frames it missed.
    fn snapshot(&self) -> Option<RecordingSnapshot> {
        None
    }
}

/// Shared slot for the backend (`None` until the app has built its recorder).
pub type SharedRecordingBackend = Arc<RwLock<Option<Arc<dyn RecordingBackend>>>>;

/// Message sent to the extension when an interview starts and no recorder is registered.
pub const RECORDING_UNAVAILABLE_MESSAGE: &str = "Recording is not available in this build yet";
