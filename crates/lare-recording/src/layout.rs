//! Where a recording's media lives inside its project directory.
//!
//! Std only: `stream-tests` compiles this file by path, next to `live.rs` and `fragmented.rs`.

use std::path::{Path, PathBuf};

/// The MP4 a recording is muxed into, fragment by fragment, while it is being captured.
pub const CAPTURE_FILE_NAME: &str = "capture.mp4";

pub fn content_dir(project: &Path) -> PathBuf {
    project.join("content")
}

/// The capture file as a running recording names it. Joined with a forward slash on every
/// platform: completed-recording manifests and the webview hold this path as a string, and that
/// is how it has always been spelt.
pub fn live_capture_file(project: &Path) -> PathBuf {
    project.join(format!("content/{CAPTURE_FILE_NAME}"))
}

/// Written beside a capture file once it has been flushed and closed, so recovery never mistakes
/// a partially written capture for a finished take.
pub fn complete_marker(capture: &Path) -> PathBuf {
    capture.with_extension("complete")
}

/// The MP4 a project is recovered into when its capture was not closed cleanly. Not
/// byte-identical to the capture file it replaces.
pub fn recovered_output(project: &Path) -> PathBuf {
    content_dir(project).join("output.mp4")
}
