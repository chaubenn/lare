//! Recording extension point.
//!
//! Interview sessions started from the extension are supposed to trigger a screen (+ mic,
//! optional facecam) recording on the desktop. The recorder itself (recycled from Cap) lands
//! in a later phase; until then the WebSocket server answers every interview `session.start`
//! with a `recording.state` error frame so the extension can tell the user.
//!
//! To wire a real recorder, implement [`RecordingBackend`] and register it with
//! [`crate::ws_server::ServerContext::set_recording_backend`]. Implementations report progress
//! by broadcasting [`lare_core::protocol::AppToExt::RecordingState`] frames through the
//! [`WsHub`] they are handed, e.g. `starting` -> `recording` (with `started_at` = epoch ms of
//! media time 0) -> `stopping` -> `idle`.

use std::sync::{Arc, RwLock};

use crate::ws_server::WsHub;

/// Everything the recorder needs from an interview `session.start` frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordingRequest {
    pub session_id: String,
    /// Epoch ms when the session timer started (for aligning edits/transcript later).
    pub started_at: u64,
    /// Record the webcam as a picture-in-picture track.
    pub facecam: bool,
    /// Capture the microphone.
    pub mic: bool,
}

/// Pluggable recorder. All methods are fire-and-forget: report state asynchronously by
/// broadcasting [`lare_core::protocol::AppToExt::RecordingState`] on the hub (it reaches every
/// connected extension client).
pub trait RecordingBackend: Send + Sync {
    /// Start recording for an interview session.
    fn start(&self, hub: &WsHub, req: RecordingRequest);
    /// The session timer was paused (`session.pause`).
    fn pause(&self, hub: &WsHub, session_id: &str, at: u64);
    /// The session timer resumed (`session.resume`).
    fn resume(&self, hub: &WsHub, session_id: &str, at: u64);
    /// The session ended (`session.end`): finish the recording and hand it to the upload pipeline.
    fn stop(&self, hub: &WsHub, session_id: &str, at: u64);
    /// Whether screen recording permission is granted and devices are available right now.
    /// Reported to the extension as `hello.ack.recordingCapable`.
    fn capable(&self) -> bool {
        true
    }
}

/// Shared slot for an optional backend (`None` until a recorder ships).
pub type SharedRecordingBackend = Arc<RwLock<Option<Arc<dyn RecordingBackend>>>>;

/// Message sent to the extension when an interview starts and no recorder is registered.
pub const RECORDING_UNAVAILABLE_MESSAGE: &str = "Recording is not available in this build yet";
