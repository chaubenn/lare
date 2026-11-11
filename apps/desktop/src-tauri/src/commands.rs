//! Tauri commands for recording, devices, permissions, upload and transcription.
//!
//! Long jobs report progress through events (`upload:progress`, `transcribe:progress`) keyed by
//! a caller-supplied `jobId`, so the React side can show several jobs at once and survive
//! re-renders.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use lare_recording::devices::{CameraInfo, DisplayInfo, MicrophoneInfo};
use lare_recording::permissions::{PermissionKind, PermissionStatus, Permissions};
use lare_recording::thumbnail::MediaInfo;
use lare_transcribe::{ModelKind, Progress, Segment};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tracing::info;

use crate::events;
use crate::project::{self, CompletedPayload, Purpose};
use crate::recorder::{DemoStart, Recorder, RecorderSettings, StartSpec, StatePayload};
use crate::upload::{self, UploadMarker, pinned_tus, pinned_upload_url};
use crate::windows;

type Rec<'a> = State<'a, Arc<Recorder>>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Devices, permissions, settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Devices {
    pub displays: Vec<DisplayInfo>,
    pub cameras: Vec<CameraInfo>,
    pub microphones: Vec<MicrophoneInfo>,
}

#[tauri::command]
pub async fn list_devices() -> Result<Devices, String> {
    tokio::task::spawn_blocking(|| Devices {
        displays: lare_recording::devices::list_displays(),
        cameras: lare_recording::devices::list_cameras(),
        microphones: lare_recording::devices::list_microphones(),
    })
    .await
    .map_err(err)
}

#[tauri::command]
pub fn check_permissions() -> Permissions {
    lare_recording::permissions::check()
}

/// Prompt for a permission. Returns the status afterwards; macOS only prompts once, later calls
/// should open the settings pane instead.
#[tauri::command]
pub async fn request_permission(which: PermissionKind) -> Result<PermissionStatus, String> {
    // The AVFoundation permission futures are not `Send`, so drive them on a blocking thread.
    tokio::task::spawn_blocking(move || match which {
        PermissionKind::ScreenRecording => lare_recording::permissions::request_screen_recording(),
        PermissionKind::Camera => {
            futures::executor::block_on(lare_recording::permissions::request_camera())
        }
        PermissionKind::Microphone => {
            futures::executor::block_on(lare_recording::permissions::request_microphone())
        }
    })
    .await
    .map_err(err)
}

/// Forget the screen-recording decision and ask for it again, for the case an update left a stale
/// grant behind: capture refused while System Settings still shows Lare switched on. Saves the trip
/// to System Settings to remove the entry with "-" by hand.
#[tauri::command]
pub async fn reset_screen_recording_permission(app: AppHandle) -> Result<PermissionStatus, String> {
    let bundle_id = app.config().identifier.clone();
    tokio::task::spawn_blocking(move || {
        lare_recording::permissions::reset_screen_recording(&bundle_id)?;
        Ok(lare_recording::permissions::request_screen_recording())
    })
    .await
    .map_err(err)?
}

/// A URL the webview can play this device's copy of a recording from.
///
/// Served over the loopback server rather than `asset://` because WebKit cannot get through a
/// fragmented MP4 over a custom scheme — see `preview.rs` for the measurements. Only paths inside
/// the recordings directory are ever handed out, so this cannot be turned into a file server.
#[tauri::command]
pub fn preview_url(
    rec: Rec<'_>,
    previews: State<'_, crate::preview::PreviewFiles>,
    path: String,
) -> Result<String, String> {
    let path = under_recordings(&rec, Path::new(&path))?;
    if !path.exists() {
        return Err("no such recording".to_string());
    }
    Ok(crate::local_server::preview_url(&previews.register(&path)))
}

/// URL of the OS settings pane for a permission (macOS).
#[tauri::command]
pub fn permission_settings_url(which: PermissionKind) -> String {
    lare_recording::permissions::settings_url(which).to_string()
}

/// Open the System Settings pane for a permission. Done from Rust because the opener plugin's
/// URL scope only allows web/mail schemes and `x-apple.systempreferences:` links are rejected.
#[tauri::command]
pub fn open_permission_settings(app: AppHandle, which: PermissionKind) -> Result<(), String> {
    app.opener()
        .open_url(
            lare_recording::permissions::settings_url(which),
            None::<&str>,
        )
        .map_err(|e| format!("could not open System Settings: {e}"))
}

#[tauri::command]
pub fn recorder_settings(rec: Rec<'_>) -> RecorderSettings {
    rec.settings()
}

#[tauri::command]
pub fn set_recorder_settings(rec: Rec<'_>, settings: RecorderSettings) -> Result<(), String> {
    // Refuse a shortcut that would never register, rather than saving it and failing silently
    // the next time a recording starts.
    windows::parse_pill_shortcut(settings.pill_shortcut.as_deref())?;
    rec.set_settings(settings);
    Ok(())
}

// ---------------------------------------------------------------------------
// Recording lifecycle (demo videos started from the app)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn recorder_status(rec: Rec<'_>) -> Result<StatePayload, String> {
    Ok(rec.status().await)
}

#[tauri::command]
pub async fn recording_start(rec: Rec<'_>, req: DemoStart) -> Result<StatePayload, String> {
    let recorder = rec.inner().clone();
    let upload = recorder.take_prepared_upload().await;
    recorder
        .start(StartSpec {
            purpose: Purpose::Demo,
            session_id: None,
            post_id: req.post_id.clone(),
            facecam: req.facecam,
            mic: req.mic,
            upload,
        })
        .await
}

// Pause, resume, stop and cancel come from the pill, which drives mock interviews too: they act
// on whatever is recording (no session named).
#[tauri::command]
pub async fn recording_pause(rec: Rec<'_>) -> Result<StatePayload, String> {
    rec.pause(None).await
}

#[tauri::command]
pub async fn recording_resume(rec: Rec<'_>) -> Result<StatePayload, String> {
    rec.resume(None).await
}

#[tauri::command]
pub async fn recording_stop(app: AppHandle, rec: Rec<'_>) -> Result<CompletedPayload, String> {
    let result = rec.stop(None).await;
    crate::focus_main_window(&app);
    result
}

#[tauri::command]
pub async fn recording_cancel(rec: Rec<'_>) -> Result<(), String> {
    rec.cancel(None).await
}

/// Clear a screen-sharing session macOS is still attributing to Lare.
///
/// A run that was killed outright (`kill -9`, a crash, a debugger stop) never got to call
/// `stopCapture`, and macOS holds the ScreenCaptureKit session open on its behalf: Control Center
/// keeps Lare in its screen-sharing menu with nothing listed under "Currently Sharing", and its
/// own Stop Sharing button messages the process that is no longer there. Every ordinary exit now
/// releases the stream (see [`crate::shutdown`]); this is the way out of a session an earlier
/// build — or a hard kill — left behind.
///
/// Restarting `replayd`, the per-user daemon that owns every capture session, is what actually
/// drops it; launchd starts it again with the next capture. Any *other* app's screen recording or
/// screen share stops too, which is why this is behind an explicit button and a confirmation.
#[tauri::command]
pub async fn clear_screen_sharing(rec: Rec<'_>) -> Result<(), String> {
    let recorder = rec.inner().clone();
    recorder.shutdown().await;
    #[cfg(target_os = "macos")]
    {
        // SIGKILL, not SIGTERM: `replayd` ignores a plain `killall` (it exits 0 and the daemon
        // carries on with the same pid). launchd brings it straight back with an empty session
        // table, which is what actually clears the indicator.
        let status = tokio::process::Command::new("/usr/bin/killall")
            .args(["-KILL", "replayd"])
            .status()
            .await
            .map_err(|e| format!("could not restart replayd: {e}"))?;
        // A non-zero exit only means no daemon was running, i.e. nothing was holding a session;
        // the recording side has been released either way.
        info!(
            code = status.code(),
            "restarted replayd to clear a stale screen-sharing session"
        );
    }
    Ok(())
}

/// Completed recordings on disk (newest first), including ones not yet uploaded.
#[tauri::command]
pub fn recordings_list(rec: Rec<'_>) -> Vec<CompletedPayload> {
    rec.list_completed()
}

#[tauri::command]
pub fn recording_delete(rec: Rec<'_>, recording_id: String) -> Result<(), String> {
    let dir = recording_dir(rec.recordings_dir(), &recording_id)?;
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(err)
}

/// The directory of the recording `id` names, confirmed to be one of the recordings.
///
/// The id is checked for shape before it is joined to anything (see [`project::id`]).
fn recording_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !project::id::is_well_formed(id) {
        return Err("invalid recording id".into());
    }
    let dir = confine(root, &root.join(id))?;
    if dir.parent() != Some(root) {
        return Err("invalid recording id".into());
    }
    Ok(dir)
}

/// `path` resolved and confirmed to live under the recordings directory.
///
/// Every command that takes a path from the webview goes through here (an id through
/// [`recording_dir`]). The webview renders content other users wrote, so a path it hands over is
/// not trusted to name anything outside the recordings this app made: without the check
/// `read_file_bytes` is a file reader and `make_thumbnail` a file writer for the whole disk. Both
/// sides are canonicalised, so `..`, symlinks and Windows path prefixes cannot slip a file past
/// the comparison. The file itself may not exist yet (a thumbnail about to be written, an upload
/// marker); its directory must.
///
/// The result is the recordings directory joined with what was confirmed to lie under it, which
/// is the spelling the recorder itself uses: callers act on that rather than on what was checked,
/// and it still matches the recorder's own keys (live uploads, previews).
fn under_recordings(rec: &Recorder, path: &Path) -> Result<PathBuf, String> {
    confine(rec.recordings_dir(), path)
}

fn confine(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let canonical_root = std::fs::canonicalize(root)
        .map_err(|e| format!("recordings directory unavailable: {e}"))?;
    let resolved = match std::fs::canonicalize(path) {
        Ok(resolved) => resolved,
        Err(_) => {
            let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
                return Err("invalid path".to_string());
            };
            std::fs::canonicalize(parent)
                .map_err(|e| format!("no such directory: {e}"))?
                .join(name)
        }
    };
    let inside = resolved
        .strip_prefix(&canonical_root)
        .map_err(|_| "path is outside the recordings directory".to_string())?;
    if inside.as_os_str().is_empty() {
        return Err("path is the recordings directory itself".to_string());
    }
    Ok(root.join(inside))
}

// ---------------------------------------------------------------------------
// Secondary windows
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn tuck_recorder_window(app: AppHandle) {
    windows::tuck_recorder(&app);
}

// ---------------------------------------------------------------------------
// Desktop notifications
// ---------------------------------------------------------------------------

/// Show an OS notification that, when clicked, focuses the main window and opens `route` (an
/// in-app path such as `/posts/<id>`). The notification plugin cannot report clicks on desktop,
/// so on Windows the toast is raised through WinRT with an activation handler; elsewhere it falls
/// back to the plugin, and a click only does what the OS does by default.
#[tauri::command]
pub fn show_desktop_notification(
    app: AppHandle,
    title: String,
    body: String,
    route: Option<String>,
) -> Result<(), String> {
    // Only in-app paths: the route goes straight to the router, like a `lare://` link.
    let route = route.filter(|r| r.starts_with('/'));
    show_notification(app, title, body, route)
}

#[cfg(windows)]
fn show_notification(
    app: AppHandle,
    title: String,
    body: String,
    route: Option<String>,
) -> Result<(), String> {
    use tauri_winrt_notification::Toast;

    // Same rule as tauri-plugin-notification: a build run from `target/` has no registered
    // AppUserModelID, so it borrows PowerShell's for the toast to show at all.
    let from_target = tauri::utils::platform::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent()
                .map(|dir| dir.ends_with("target/debug") || dir.ends_with("target/release"))
        })
        .unwrap_or(false);
    let app_id = if from_target {
        Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    };
    tauri::async_runtime::spawn(async move {
        let handle = app.clone();
        let shown = Toast::new(&app_id)
            .title(&title)
            .text1(&body)
            .on_activated(move |_action| {
                match &route {
                    Some(path) => crate::emit_deeplink(&handle, path),
                    None => crate::focus_main_window(&handle),
                }
                Ok(())
            })
            .show();
        if let Err(e) = shown {
            tracing::warn!(error = %e, "could not show a desktop notification");
        }
    });
    Ok(())
}

#[cfg(not(windows))]
fn show_notification(
    app: AppHandle,
    title: String,
    body: String,
    _route: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(err)
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn media_info(rec: Rec<'_>, path: PathBuf) -> Result<MediaInfo, String> {
    let path = under_recordings(&rec, &path)?;
    tokio::task::spawn_blocking(move || lare_recording::thumbnail::probe(&path).map_err(err))
        .await
        .map_err(err)?
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailRequest {
    pub video_path: PathBuf,
    /// Frame time in ms (default 1000, clamped to the duration).
    pub at_ms: Option<u64>,
    /// Output width cap (default 640).
    pub max_width: Option<u32>,
}

/// Write a JPEG poster frame to `<video dir>/thumbnail.jpg` and return its path (the webview
/// reads it back with `read_file_bytes` to upload).
#[tauri::command]
pub async fn make_thumbnail(rec: Rec<'_>, req: ThumbnailRequest) -> Result<PathBuf, String> {
    let video_path = under_recordings(&rec, &req.video_path)?;
    let output = video_path.with_file_name("thumbnail.jpg");
    tokio::task::spawn_blocking(move || {
        let duration = lare_recording::thumbnail::duration_ms(&video_path).unwrap_or(0);
        let at = req.at_ms.unwrap_or(1000).min(duration.saturating_sub(200));
        lare_recording::thumbnail::extract_jpeg(
            &video_path,
            &output,
            at,
            req.max_width.unwrap_or(640),
        )
        .map_err(|e| format!("{e:#}"))?;
        Ok(output)
    })
    .await
    .map_err(err)?
}

// ---------------------------------------------------------------------------
// Upload (TUS to Bunny with credentials from the Edge Function)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadJob {
    pub job_id: String,
    pub path: PathBuf,
    pub tus: lare_bunny::TusCredentials,
    /// Upload URL from a previous attempt, to resume.
    pub resume_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub upload_url: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub async fn prepare_bunny_upload(
    rec: Rec<'_>,
    tus: lare_bunny::TusCredentials,
) -> Result<String, String> {
    pinned_tus(&tus)?;
    rec.prepare_upload(tus).await
}

#[tauri::command]
pub async fn upload_to_bunny(
    app: AppHandle,
    rec: Rec<'_>,
    job: UploadJob,
) -> Result<UploadResult, String> {
    let path = under_recordings(&rec, &job.path)?;
    pinned_tus(&job.tus)?;
    let client = lare_bunny::http_client();
    if let Some(upload_url) = rec
        .join_live_upload(&path, &job.tus, job.resume_url.as_deref())
        .await?
    {
        return Ok(UploadResult {
            upload_url,
            size_bytes: tokio::fs::metadata(&path).await.map_err(err)?.len(),
        });
    }
    let size_bytes = tokio::fs::metadata(&path).await.map_err(err)?.len();
    let job_id = job.job_id.clone();
    let saved_url = UploadMarker::read(&path)
        .filter(|marker| marker.created_with(&job.tus))
        .map(|marker| marker.upload_url);
    // A recovered take is remuxed into a new file, which is NOT byte-identical to the capture
    // file. The frontend may still hold the pre-capture URL after salvage. Never resume that
    // object's offset against the replacement file. Prefer a matching per-file checkpoint on
    // subsequent retries over the stale UI URL.
    let capture_path = path
        .parent()
        .map(|p| p.join(lare_recording::layout::CAPTURE_FILE_NAME));
    let inherited_capture_url = capture_path
        .as_ref()
        .filter(|p| *p != &path)
        .and_then(|p| UploadMarker::read(p))
        .map(|marker| marker.upload_url);
    let resume_url = saved_url
        .or_else(|| job.resume_url.clone())
        .filter(|url| Some(url) != inherited_capture_url.as_ref());
    let resume_url = match resume_url {
        Some(url) => {
            pinned_upload_url(&url)?;
            url
        }
        None => lare_bunny::create_deferred_upload(&client, &job.tus)
            .await
            .map_err(err)?,
    };
    UploadMarker::new(&resume_url, &job.tus)
        .write(&path)
        .await
        .map_err(err)?;
    info!(job = %job_id, path = %path.display(), size_bytes, "upload started");
    // Retries are closed files. Captures still being written join their live tailer above.
    let (_finished, completion) = tokio::sync::watch::channel(true);
    let upload_url = lare_bunny::upload_growing_file(
        &client,
        &path,
        &job.tus,
        &resume_url,
        lare_bunny::DEFAULT_CHUNK_SIZE,
        completion,
        upload::progress_reporter(app, job_id),
    )
    .await
    .map_err(|e| format!("{e}"))?;
    // Keep the receipt URL until cloud finalization succeeds; a retry must not create another upload.
    Ok(UploadResult {
        upload_url,
        size_bytes,
    })
}

// ---------------------------------------------------------------------------
// Transcription (whisper.cpp)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelStatus {
    pub kind: ModelKind,
    pub label: String,
    pub approx_mb: u32,
    pub downloaded: bool,
}

#[tauri::command]
pub fn whisper_models(rec: Rec<'_>) -> Vec<WhisperModelStatus> {
    let dir = rec.models_dir();
    ModelKind::ALL
        .into_iter()
        .map(|kind| WhisperModelStatus {
            kind,
            label: kind.label().to_string(),
            approx_mb: kind.approx_mb(),
            downloaded: std::fs::metadata(dir.join(kind.file_name()))
                .map(|m| m.len() == kind.size())
                .unwrap_or(false),
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
// `rename_all` only renames the variants; `rename_all_fields` is what turns `job_id` into the
// `jobId` the frontend filters on. Without it no progress event ever matched a job.
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "stage"
)]
pub enum TranscribeProgress {
    Download {
        job_id: String,
        received: u64,
        total: Option<u64>,
    },
    Decoding {
        job_id: String,
    },
    Transcribing {
        job_id: String,
        percent: u32,
    },
}

fn progress_event(job_id: &str, p: Progress) -> TranscribeProgress {
    let job_id = job_id.to_string();
    match p {
        Progress::Download { received, total } => TranscribeProgress::Download {
            job_id,
            received,
            total,
        },
        Progress::Decoding => TranscribeProgress::Decoding { job_id },
        Progress::Transcribing { percent } => TranscribeProgress::Transcribing { job_id, percent },
    }
}

/// Download a whisper model (no-op when present). Emits `transcribe:progress` download events.
#[tauri::command]
pub async fn ensure_whisper_model(
    app: AppHandle,
    rec: Rec<'_>,
    job_id: String,
    model: ModelKind,
) -> Result<PathBuf, String> {
    let dir = rec.models_dir();
    lare_transcribe::ensure_model(&dir, model, |p| {
        events::emit(
            &app,
            events::TRANSCRIBE_PROGRESS,
            progress_event(&job_id, p),
        );
    })
    .await
    .map_err(|e| format!("{e:#}"))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeJob {
    pub job_id: String,
    /// Any media file with an audio track (an instant MP4).
    pub input: PathBuf,
    pub model: Option<ModelKind>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub model: ModelKind,
    pub segments: Vec<Segment>,
    pub vtt: String,
}

#[tauri::command]
pub async fn transcribe_recording(
    app: AppHandle,
    rec: Rec<'_>,
    job: TranscribeJob,
) -> Result<TranscribeResult, String> {
    let model = job
        .model
        .or(rec.settings().whisper_model)
        .unwrap_or(ModelKind::SmallEn);
    let model_path = lare_transcribe::ensure_model(&rec.models_dir(), model, {
        let app = app.clone();
        let job_id = job.job_id.clone();
        move |p| {
            events::emit(
                &app,
                events::TRANSCRIBE_PROGRESS,
                progress_event(&job_id, p),
            );
        }
    })
    .await
    .map_err(|e| format!("{e:#}"))?;
    let input = under_recordings(&rec, &job.input)?;
    if !input.exists() {
        return Err(format!("{} does not exist", input.display()));
    }
    let job_id = job.job_id.clone();
    info!(job = %job_id, input = %input.display(), ?model, "transcription started");
    let segments = tokio::task::spawn_blocking(move || {
        lare_transcribe::transcribe_file(&model_path, &input, move |p| {
            events::emit(
                &app,
                events::TRANSCRIBE_PROGRESS,
                progress_event(&job_id, p),
            );
        })
    })
    .await
    .map_err(err)?
    .map_err(|e| format!("{e:#}"))?;
    let vtt = lare_transcribe::to_webvtt(&segments);
    Ok(TranscribeResult {
        model,
        segments,
        vtt,
    })
}

/// Read a small file (thumbnail/VTT) as bytes for uploading from the webview.
#[tauri::command]
pub async fn read_file_bytes(rec: Rec<'_>, path: PathBuf) -> Result<tauri::ipc::Response, String> {
    let path = under_recordings(&rec, &path)?;
    let meta = tokio::fs::metadata(&path).await.map_err(err)?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("file too large to read into memory".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Whether a recording path exists (used to detect recordings deleted outside the app).
/// Anything outside the recordings directory reports `false` rather than being probed.
#[tauri::command]
pub fn path_exists(rec: Rec<'_>, path: PathBuf) -> bool {
    under_recordings(&rec, &path).is_ok_and(|p| p.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("lare-commands-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("0190f3a2b4c5d-0123456789abcdef")).unwrap();
        root
    }

    #[test]
    fn recording_ids_name_a_directory_under_the_root() {
        let root = temp_root();
        let dir = recording_dir(&root, "0190f3a2b4c5d-0123456789abcdef").unwrap();
        assert_eq!(dir, root.join("0190f3a2b4c5d-0123456789abcdef"));
        // Not there yet (or already gone) is still a recording directory.
        assert!(recording_dir(&root, "6f2c9e0a-1b2c-4d3e-8f90-0a1b2c3d4e5f").is_ok());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn recording_ids_that_could_leave_the_root_are_refused() {
        let root = temp_root();
        // Drive-relative (`C:name`) is the one a separator denylist missed.
        let separators = ["a/b", r"a\b", "/tmp", r"\\server\share"];
        let ids = ["", "C:", "C:name", "..", ".", "abc.d"];
        for id in ids.into_iter().chain(separators) {
            assert!(recording_dir(&root, id).is_err(), "{id:?} was accepted");
        }
        assert!(recording_dir(&root, &"a".repeat(65)).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn paths_are_confined_and_keep_the_root_spelling() {
        let root = temp_root();
        let take = root.join("0190f3a2b4c5d-0123456789abcdef");
        let file = take.join("capture.mp4");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(confine(&root, &file).unwrap(), file);
        // A file about to be written, in a directory that exists.
        let thumb = take.join("thumbnail.jpg");
        assert_eq!(confine(&root, &thumb).unwrap(), thumb);
        assert!(confine(&root, &take.join("..").join("..").join("elsewhere")).is_err());
        assert!(confine(&root, &root).is_err());
        assert!(confine(&root, &std::env::temp_dir()).is_err());
        std::fs::remove_dir_all(&root).ok();
    }
}
