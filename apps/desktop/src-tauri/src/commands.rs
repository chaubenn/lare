//! Tauri commands for recording, devices, permissions, upload and transcription.
//!
//! Long jobs report progress through events (`upload:progress`, `transcribe:progress`) keyed by a caller-supplied `jobId`, so the React side can show
//! several jobs at once and survive re-renders.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use lare_recording::devices::{CameraInfo, DisplayInfo, MicrophoneInfo};
use lare_recording::permissions::{PermissionStatus, Permissions};
use lare_recording::thumbnail::MediaInfo;
use lare_transcribe::{ModelKind, Progress, Segment, TranscribeOptions};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tracing::info;

use crate::recorder::{CompletedPayload, DemoStart, Recorder, RecorderSettings, StatePayload};
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

/// Prompt for a permission (`screen_recording` | `camera` | `microphone`). Returns the status
/// afterwards; macOS only prompts once, later calls should open the settings pane instead.
#[tauri::command]
pub async fn request_permission(which: String) -> Result<PermissionStatus, String> {
    // The AVFoundation permission futures are not `Send`, so drive them on a blocking thread.
    tokio::task::spawn_blocking(move || match which.as_str() {
        "screen_recording" => Ok(lare_recording::permissions::request_screen_recording()),
        "camera" => Ok(futures::executor::block_on(
            lare_recording::permissions::request_camera(),
        )),
        "microphone" => Ok(futures::executor::block_on(
            lare_recording::permissions::request_microphone(),
        )),
        other => Err(format!("unknown permission '{other}'")),
    })
    .await
    .map_err(err)?
}

/// URL of the OS settings pane for a permission (macOS), if any.
#[tauri::command]
pub fn permission_settings_url(which: String) -> Option<String> {
    lare_recording::permissions::settings_url(&which).map(str::to_string)
}

/// Open the System Settings pane for a permission. Done from Rust because the opener plugin's
/// URL scope only allows web/mail schemes and `x-apple.systempreferences:` links are rejected.
#[tauri::command]
pub fn open_permission_settings(app: AppHandle, which: String) -> Result<(), String> {
    let url = lare_recording::permissions::settings_url(&which)
        .ok_or_else(|| format!("no settings pane for {which}"))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("could not open System Settings: {e}"))
}

#[tauri::command]
pub fn recorder_settings(rec: Rec<'_>) -> RecorderSettings {
    rec.settings()
}

#[tauri::command]
pub fn set_recorder_settings(rec: Rec<'_>, settings: RecorderSettings) {
    rec.set_settings(settings);
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
    let prepared = recorder.take_prepared_upload().await;
    recorder
        .start(
            crate::recorder::StartSpec {
                purpose: crate::recorder::Purpose::Demo,
                mode: req.mode,
                session_id: None,
                post_id: req.post_id.clone(),
                facecam: req.facecam,
                mic: req.mic,
                upload: req.upload.or(prepared),
            },
            None,
        )
        .await
}

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
    let dir = rec.recordings_dir().join(safe_id(&recording_id)?);
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(err)
}

fn safe_id(id: &str) -> Result<&str, String> {
    if id.is_empty() || id.contains(['/', '\\', '.']) {
        return Err("invalid recording id".into());
    }
    Ok(id)
}

// ---------------------------------------------------------------------------
// Secondary windows
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_recorder_window(app: AppHandle, rec: Rec<'_>) -> Result<(), String> {
    windows::open_recorder(&app, rec.settings().display_id.as_deref())
}

#[tauri::command]
pub fn hide_recorder_window(app: AppHandle) {
    windows::hide_recorder(&app);
}

#[tauri::command]
pub fn open_camera_window(app: AppHandle, rec: Rec<'_>) -> Result<(), String> {
    windows::open_camera(&app, rec.settings().display_id.as_deref())
}

#[tauri::command]
pub fn hide_camera_window(app: AppHandle) {
    windows::hide_camera(&app);
}

#[tauri::command]
pub fn resize_camera_window(app: AppHandle, size: f64) -> Result<(), String> {
    windows::resize_camera(&app, size)
}

#[tauri::command]
pub fn focus_main(app: AppHandle) {
    crate::focus_main_window(&app);
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn media_info(path: PathBuf) -> Result<MediaInfo, String> {
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
    /// Where to write; defaults to `<video dir>/thumbnail.jpg`.
    pub output: Option<PathBuf>,
}

/// Write a JPEG poster frame and return its path (read it with the fs plugin to upload).
#[tauri::command]
pub async fn make_thumbnail(req: ThumbnailRequest) -> Result<PathBuf, String> {
    tokio::task::spawn_blocking(move || {
        let output = req
            .output
            .unwrap_or_else(|| req.video_path.with_file_name("thumbnail.jpg"));
        let duration = lare_recording::thumbnail::duration_ms(&req.video_path).unwrap_or(0);
        let at = req.at_ms.unwrap_or(1000).min(duration.saturating_sub(200));
        lare_recording::thumbnail::extract_jpeg(
            &req.video_path,
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
pub struct UploadProgress {
    pub job_id: String,
    pub uploaded: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub upload_url: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub async fn prepare_bunny_upload(rec: Rec<'_>, tus: lare_bunny::TusCredentials) -> Result<String, String> {
    rec.prepare_upload(tus).await
}

#[tauri::command]
pub async fn upload_to_bunny(app: AppHandle, rec: Rec<'_>, job: UploadJob) -> Result<UploadResult, String> {
    let client = lare_bunny::http_client();
    if let Some(upload_url) = rec.join_live_upload(&job.path, &job.tus, job.resume_url.as_deref()).await? {
        return Ok(UploadResult { upload_url, size_bytes: tokio::fs::metadata(&job.path).await.map_err(err)?.len() });
    }
    let size_bytes = tokio::fs::metadata(&job.path).await.map_err(err)?.len();
    let job_id = job.job_id.clone();
    // Remember the upload URL next to the file so a restart can resume.
    let marker = job.path.with_extension("upload.json");
    let saved_url = {
        std::fs::read_to_string(&marker)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .filter(|v| v["headers"] == serde_json::to_value(&job.tus.headers).unwrap_or_default())
            .and_then(|v| {
                v.get("uploadUrl")
                    .and_then(|u| u.as_str())
                    .map(str::to_string)
            })
    };
    // A recovered take is remuxed to output.mp4, which is NOT byte-identical to
    // capture.mp4. The frontend may still hold the pre-capture URL after salvage.
    // Never resume that object's offset against the replacement file. Prefer a
    // matching per-file checkpoint on subsequent retries over the stale UI URL.
    let capture_path = job.path.parent().map(|p| p.join("capture.mp4"));
    let inherited_capture_url = capture_path.as_ref().filter(|p| *p != &job.path)
        .and_then(|p| std::fs::read_to_string(p.with_extension("upload.json")).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["uploadUrl"].as_str().map(str::to_string));
    let resume_url = saved_url.or_else(|| job.resume_url.clone())
        .filter(|url| Some(url) != inherited_capture_url.as_ref());
    let resume_url = match resume_url {
        Some(url) => url,
        None => lare_bunny::create_deferred_upload(&client, &job.tus)
            .await
            .map_err(err)?,
    };
    tokio::fs::write(
        &marker,
        serde_json::json!({"uploadUrl":resume_url,"headers":job.tus.headers}).to_string(),
    )
    .await
    .map_err(err)?;
    info!(job = %job_id, path = %job.path.display(), size_bytes, "upload started");
    // Retries are closed files. Instant captures join their live tailer above.
    let (_finished, completion) = tokio::sync::watch::channel(true);
    let upload_url = lare_bunny::upload_growing_file(
        &client,
        &job.path,
        &job.tus,
        &resume_url,
        lare_bunny::DEFAULT_CHUNK_SIZE,
        completion,
        |p| {
            let _ = app.emit(
                "upload:progress",
                UploadProgress {
                    job_id: job_id.clone(),
                    uploaded: p.uploaded,
                    total: p.total,
                },
            );
        },
    )
    .await
    .map_err(|e| format!("{e}"))?;
    // Keep the receipt URL until cloud finalization succeeds; a retry must not create another upload.
    Ok(UploadResult {
        upload_url,
        size_bytes,
    })
}

/// Persist an upload URL for later resume (called by the frontend right after `create-upload`).
#[tauri::command]
pub fn remember_upload(path: PathBuf, upload_url: String) -> Result<(), String> {
    let marker = path.with_extension("upload.json");
    std::fs::write(
        marker,
        serde_json::json!({ "uploadUrl": upload_url }).to_string(),
    )
    .map_err(err)
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
    [
        ModelKind::TinyEn,
        ModelKind::BaseEn,
        ModelKind::SmallEn,
        ModelKind::MediumEn,
    ]
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
        let _ = app.emit("transcribe:progress", progress_event(&job_id, p));
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
            let _ = app.emit("transcribe:progress", progress_event(&job_id, p));
        }
    })
    .await
    .map_err(|e| format!("{e:#}"))?;
    let input = job.input.clone();
    if !input.exists() {
        return Err(format!("{} does not exist", input.display()));
    }
    let job_id = job.job_id.clone();
    info!(job = %job_id, input = %input.display(), ?model, "transcription started");
    let segments = tokio::task::spawn_blocking(move || {
        lare_transcribe::transcribe_file(
            &model_path,
            &input,
            &TranscribeOptions::default(),
            move |p| {
                let _ = app.emit("transcribe:progress", progress_event(&job_id, p));
            },
        )
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
pub async fn read_file_bytes(path: PathBuf) -> Result<tauri::ipc::Response, String> {
    let meta = tokio::fs::metadata(&path).await.map_err(err)?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("file too large to read into memory".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Delete a file inside the recordings directory.
#[tauri::command]
pub fn delete_file(rec: Rec<'_>, path: PathBuf) -> Result<(), String> {
    if !path.starts_with(rec.recordings_dir()) {
        return Err("refusing to delete outside the recordings directory".into());
    }
    std::fs::remove_file(&path).map_err(err)
}

/// Whether a path exists (used to detect recordings deleted outside the app).
#[tauri::command]
pub fn path_exists(path: PathBuf) -> bool {
    Path::new(&path).exists()
}
