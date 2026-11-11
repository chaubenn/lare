//! The Tauri events the Rust side emits. The webview's map of the same names and their payloads
//! is `TauriEvents` in `apps/desktop/src/lib/tauri.ts` (and `RecorderEvents` in `recorder.ts`).

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tracing::warn;

pub const DEEPLINK_NAVIGATE: &str = "deeplink:navigate";
pub const AUTH_CALLBACK: &str = "auth:callback";
pub const AUTH_ERROR: &str = "auth:error";
pub const EXT_CONNECTED: &str = "ext:connected";
pub const RECORDING_STATE: &str = "recording:state";
pub const RECORDING_COMPLETED: &str = "recording:completed";
pub const UPLOAD_PROGRESS: &str = "upload:progress";
pub const TRANSCRIBE_PROGRESS: &str = "transcribe:progress";
/// Whether the facecam preview window should be holding the webcam open.
pub const CAMERA_ACTIVE: &str = "camera:active";
/// The pointer's position over the pill window, in points from its top-left (`null` when it is
/// off the window).
pub const RECORDER_POINTER: &str = "recorder:pointer";

/// Emit to every window.
pub fn emit<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Err(error) = app.emit(event, payload) {
        warn!(event, %error, "could not emit an event to the webview");
    }
}

/// Emit to the window labelled `window` only.
pub fn emit_to<S: Serialize + Clone>(app: &AppHandle, window: &str, event: &str, payload: S) {
    if let Err(error) = app.emit_to(window, event, payload) {
        warn!(event, window, %error, "could not emit an event to the webview");
    }
}
