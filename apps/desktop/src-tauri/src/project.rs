//! What Lare keeps in a recording's project directory beside the media (`lare_recording::layout`
//! names that): the manifests that say what the recording is and how far it got.
//!
//! A project is a directory under the recordings directory, named by its [`id`].

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tracing::warn;

/// Written the moment a recording begins.
const STARTED_MANIFEST: &str = "lare-started.json";
/// Written once the recording is finished and its MP4 exists.
const COMPLETED_MANIFEST: &str = "lare-recording.json";
/// Tombstone for a project that could not be recovered.
const UNRECOVERABLE_MANIFEST: &str = "lare-unrecoverable.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    /// Mock interview started by the Chrome extension.
    Interview,
    /// Demo video started from the draft editor.
    Demo,
}

/// How a recording was captured. There is one way, but manifests on disk and the webview both
/// carry `"mode": "instant"`, so the field stays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordingMode {
    /// One append-only MP4, the camera preview captured with the screen.
    Instant,
}

/// The start manifest, so a project abandoned by a killed process can still be identified and
/// finished at the next launch.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedManifest {
    pub recording_id: String,
    pub session_id: Option<String>,
    pub purpose: Option<Purpose>,
    pub mode: Option<RecordingMode>,
    pub started_at: u64,
    pub post_id: Option<String>,
    #[serde(default)]
    pub facecam: bool,
}

/// The completed manifest, which is also what the webview is told when a recording finishes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedPayload {
    pub recording_id: String,
    pub session_id: Option<String>,
    pub purpose: Purpose,
    pub mode: RecordingMode,
    pub project_path: PathBuf,
    pub output_mp4: Option<PathBuf>,
    pub started_at: u64,
    pub ended_at: u64,
    pub post_id: Option<String>,
    pub facecam: bool,
    /// Length of the captured media in ms, excluding paused stretches. Defaulted for manifests
    /// written before this field existed, and for recordings recovered after a crash, where the
    /// pauses are not knowable — both fall back to the wall clock.
    #[serde(default)]
    pub recorded_ms: u64,
}

pub fn write_started(project: &Path, manifest: &StartedManifest) {
    write_manifest(project, STARTED_MANIFEST, serde_json::to_string(manifest));
}

pub fn read_started(project: &Path) -> Option<StartedManifest> {
    read_manifest(project, STARTED_MANIFEST)
}

pub fn write_completed(project: &Path, payload: &CompletedPayload) {
    write_manifest(
        project,
        COMPLETED_MANIFEST,
        serde_json::to_string_pretty(payload),
    );
}

pub fn read_completed(project: &Path) -> Option<CompletedPayload> {
    read_manifest(project, COMPLETED_MANIFEST)
}

pub fn is_completed(project: &Path) -> bool {
    project.join(COMPLETED_MANIFEST).exists()
}

/// Mark a project as one recovery could not finish, so the next launch walks past it instead of
/// redoing the same failing work (and the directory says why).
pub fn write_unrecoverable(project: &Path, reason: &str, at_ms: u64) {
    let note = serde_json::json!({ "reason": reason, "at": at_ms });
    write_manifest(project, UNRECOVERABLE_MANIFEST, Ok(note.to_string()));
}

pub fn is_unrecoverable(project: &Path) -> bool {
    project.join(UNRECOVERABLE_MANIFEST).exists()
}

fn write_manifest(project: &Path, name: &str, json: serde_json::Result<String>) {
    let path = project.join(name);
    let written = json
        .map_err(std::io::Error::other)
        .and_then(|json| std::fs::write(&path, json));
    if let Err(error) = written {
        warn!(path = %path.display(), %error, "could not write a recording manifest");
    }
}

/// `None` when the manifest is not there, which is the ordinary case for a project at another
/// stage, and when it does not parse.
fn read_manifest<T: DeserializeOwned>(project: &Path, name: &str) -> Option<T> {
    let path = project.join(name);
    let text = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str(&text) {
        Ok(manifest) => Some(manifest),
        Err(error) => {
            warn!(path = %path.display(), %error, "ignoring a recording manifest that does not parse");
            None
        }
    }
}

/// Recording ids, which are also the names of the project directories.
pub mod id {
    /// A new id, `<unix-ms>-<random>` in hex: time-ordered, and safe as a directory name.
    pub fn generate(now_ms: u64) -> String {
        use std::hash::{BuildHasher, Hasher};
        let random = std::collections::hash_map::RandomState::new()
            .build_hasher()
            .finish();
        format!("{now_ms:013x}-{random:016x}")
    }

    /// Whether `id` has the shape of a recording id: hex digits and dashes only (a uuid fits the
    /// same rule). Checked before an id from the webview is joined to a path, because a denylist
    /// of separators misses that on Windows `C:` or `C:name` replaces the base path instead of
    /// extending it.
    pub fn is_well_formed(id: &str) -> bool {
        (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_generated_id_is_one_the_commands_accept() {
        assert!(id::is_well_formed(&id::generate(1_700_000_000_000)));
        assert!(id::is_well_formed(&id::generate(u64::MAX)));
    }

    #[test]
    fn a_start_manifest_from_an_earlier_build_reads_back_and_keeps_its_keys() {
        let dir = std::env::temp_dir().join(format!("lare-project-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let earlier = serde_json::json!({
            "recordingId": "0190f3a2b4c5d-0123456789abcdef",
            "sessionId": "s1",
            "purpose": "interview",
            "mode": "instant",
            "startedAt": 1_700_000_000_000u64,
            "postId": null,
            "facecam": true,
        });
        std::fs::write(dir.join(STARTED_MANIFEST), earlier.to_string()).unwrap();

        let manifest = read_started(&dir).expect("the earlier manifest parses");
        assert_eq!(manifest.purpose, Some(Purpose::Interview));
        write_started(&dir, &manifest);
        let rewritten: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join(STARTED_MANIFEST)).unwrap())
                .unwrap();
        assert_eq!(rewritten, earlier);

        assert!(!is_completed(&dir));
        assert!(read_completed(&dir).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
