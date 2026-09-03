//! Tauri commands for recording, devices, permissions, export, upload and transcription.
//!
//! Long jobs report progress through events (`upload:progress`, `export:progress`,
//! `transcribe:progress`) keyed by a caller-supplied `jobId`, so the React side can show
//! several jobs at once and survive re-renders.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use lare_recording::devices::{CameraInfo, DisplayInfo, MicrophoneInfo};
use lare_recording::edit::StudioEdit;
use lare_recording::permissions::{PermissionStatus, Permissions};
use lare_recording::thumbnail::MediaInfo;
use lare_recording::{ExportQuality, ExportRequest, ProjectConfiguration};
use lare_transcribe::{ModelKind, Progress, Segment, TranscribeOptions};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tracing::{info, warn};

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
        "camera" => Ok(futures::executor::block_on(lare_recording::permissions::request_camera())),
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
    recorder
        .start(
            crate::recorder::StartSpec {
                purpose: crate::recorder::Purpose::Demo,
                mode: req.mode,
                session_id: None,
                post_id: req.post_id.clone(),
                facecam: req.facecam,
                mic: req.mic,
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
pub fn open_recorder_window(app: AppHandle) -> Result<(), String> {
    windows::open_recorder(&app)
}

#[tauri::command]
pub fn close_recorder_window(app: AppHandle) {
    windows::close_recorder(&app);
}

#[tauri::command]
pub fn open_camera_window(app: AppHandle) -> Result<(), String> {
    windows::open_camera(&app)
}

#[tauri::command]
pub fn close_camera_window(app: AppHandle) {
    windows::close_camera(&app);
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
        lare_recording::thumbnail::extract_jpeg(&req.video_path, &output, at, req.max_width.unwrap_or(640))
            .map_err(|e| format!("{e:#}"))?;
        Ok(output)
    })
    .await
    .map_err(err)?
}

/// Facts about a studio project the editor needs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioProjectInfo {
    pub project_path: PathBuf,
    pub display_path: Option<PathBuf>,
    pub camera_path: Option<PathBuf>,
    pub mic_path: Option<PathBuf>,
    pub duration_ms: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[tauri::command]
pub async fn studio_project_info(project_path: PathBuf) -> Result<StudioProjectInfo, String> {
    tokio::task::spawn_blocking(move || {
        let display_path = lare_recording::find_display_track(&project_path);
        let info = display_path
            .as_deref()
            .and_then(|p| lare_recording::thumbnail::probe(p).ok());
        Ok(StudioProjectInfo {
            camera_path: lare_recording::find_camera_track(&project_path),
            mic_path: lare_recording::find_mic_track(&project_path),
            duration_ms: info.and_then(|i| i.duration_ms).unwrap_or(0),
            width: info.and_then(|i| i.width),
            height: info.and_then(|i| i.height),
            display_path,
            project_path,
        })
    })
    .await
    .map_err(err)?
}

// ---------------------------------------------------------------------------
// Export (studio projects -> MP4)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub job_id: String,
    pub project_path: PathBuf,
    #[serde(default)]
    pub edit: StudioEdit,
    /// Output file; defaults to `<project>/output/result.mp4`.
    pub output: Option<PathBuf>,
    #[serde(default = "default_quality")]
    pub quality: ExportQuality,
    #[serde(default = "default_fps")]
    pub fps: u32,
    /// Longest-edge cap, e.g. 1920. `None` keeps the source size.
    pub max_edge: Option<u32>,
}

fn default_quality() -> ExportQuality {
    ExportQuality::Social
}

fn default_fps() -> u32 {
    30
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub job_id: String,
    pub frame: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output: PathBuf,
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub size_bytes: u64,
}

/// Cancellation flags for running exports, keyed by job id.
#[derive(Default)]
pub struct Jobs {
    cancel: std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>,
}

impl Jobs {
    fn register(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut m) = self.cancel.lock() {
            m.insert(id.to_string(), flag.clone());
        }
        flag
    }

    fn finish(&self, id: &str) {
        if let Ok(mut m) = self.cancel.lock() {
            m.remove(id);
        }
    }

    pub fn cancel(&self, id: &str) -> bool {
        self.cancel
            .lock()
            .ok()
            .and_then(|m| m.get(id).cloned())
            .map(|f| {
                f.store(true, Ordering::Relaxed);
                true
            })
            .unwrap_or(false)
    }
}

#[tauri::command]
pub async fn export_studio(app: AppHandle, jobs: State<'_, Jobs>, job: ExportJob) -> Result<ExportResult, String> {
    let output = job
        .output
        .clone()
        .unwrap_or_else(|| job.project_path.join("output").join("result.mp4"));
    if let Some(parent) = output.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(err)?;
    }
    let project_path = job.project_path.clone();
    let (base_cfg, source) = tokio::task::spawn_blocking({
        let project_path = project_path.clone();
        move || {
            let cfg = ProjectConfiguration::load(&project_path).unwrap_or_default();
            let source = lare_recording::find_display_track(&project_path)
                .and_then(|p| lare_recording::thumbnail::probe(&p).ok());
            (cfg, source)
        }
    })
    .await
    .map_err(err)?;
    let duration_s = source.and_then(|s| s.duration_ms).unwrap_or(0) as f64 / 1000.0;
    let config = lare_recording::edit::apply_edit(base_cfg, &job.edit, duration_s);
    // Persist so a re-export (or Cap itself) sees the same edit.
    if let Err(e) = config.write(&project_path) {
        warn!(%e, "could not save project-config.json");
    }

    let resolution_base = match (job.max_edge, source.and_then(|s| Some((s.width?, s.height?)))) {
        (Some(max), Some((w, h))) if w.max(h) > max => {
            let scale = max as f64 / w.max(h) as f64;
            Some((((w as f64 * scale) as u32) & !1, ((h as f64 * scale) as u32) & !1))
        }
        _ => None,
    };

    let flag = jobs.register(&job.job_id);
    let job_id = job.job_id.clone();
    let emitter = app.clone();
    info!(job = %job_id, project = %project_path.display(), "export started");
    let result = lare_recording::export_studio(
        ExportRequest {
            project_path,
            config: Some(config),
            output: output.clone(),
            fps: job.fps,
            resolution_base,
            quality: job.quality,
        },
        move |frame, total| {
            let _ = emitter.emit(
                "export:progress",
                ExportProgress {
                    job_id: job_id.clone(),
                    frame,
                    total,
                },
            );
            !flag.load(Ordering::Relaxed)
        },
    )
    .await;
    jobs.finish(&job.job_id);
    let output = result.map_err(|e| format!("{e:#}"))?;
    let meta = tokio::fs::metadata(&output).await.map_err(err)?;
    let info = {
        let p = output.clone();
        tokio::task::spawn_blocking(move || lare_recording::thumbnail::probe(&p).ok())
            .await
            .map_err(err)?
    };
    Ok(ExportResult {
        size_bytes: meta.len(),
        duration_ms: info.and_then(|i| i.duration_ms),
        width: info.and_then(|i| i.width),
        height: info.and_then(|i| i.height),
        output,
    })
}

#[tauri::command]
pub fn cancel_job(jobs: State<'_, Jobs>, job_id: String) -> bool {
    jobs.cancel(&job_id)
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
pub async fn upload_to_bunny(app: AppHandle, job: UploadJob) -> Result<UploadResult, String> {
    let client = lare_bunny::http_client();
    let size_bytes = tokio::fs::metadata(&job.path).await.map_err(err)?.len();
    let job_id = job.job_id.clone();
    // Remember the upload URL next to the file so a restart can resume.
    let marker = job.path.with_extension("upload.json");
    let resume_url = job.resume_url.clone().or_else(|| {
        std::fs::read_to_string(&marker)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("uploadUrl").and_then(|u| u.as_str()).map(str::to_string))
    });
    info!(job = %job_id, path = %job.path.display(), size_bytes, resuming = resume_url.is_some(), "upload started");
    let upload_url = lare_bunny::upload_file(
        &client,
        &job.path,
        &job.tus,
        resume_url.as_deref(),
        lare_bunny::DEFAULT_CHUNK_SIZE,
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
    let _ = std::fs::remove_file(&marker);
    Ok(UploadResult { upload_url, size_bytes })
}

/// Persist an upload URL for later resume (called by the frontend right after `create-upload`).
#[tauri::command]
pub fn remember_upload(path: PathBuf, upload_url: String) -> Result<(), String> {
    let marker = path.with_extension("upload.json");
    std::fs::write(marker, serde_json::json!({ "uploadUrl": upload_url }).to_string()).map_err(err)
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
    [ModelKind::TinyEn, ModelKind::BaseEn, ModelKind::SmallEn, ModelKind::MediumEn]
        .into_iter()
        .map(|kind| WhisperModelStatus {
            kind,
            label: kind.label().to_string(),
            approx_mb: kind.approx_mb(),
            downloaded: std::fs::metadata(dir.join(kind.file_name()))
                .map(|m| m.len() > 1_000_000)
                .unwrap_or(false),
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "stage")]
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
pub async fn ensure_whisper_model(app: AppHandle, rec: Rec<'_>, job_id: String, model: ModelKind) -> Result<PathBuf, String> {
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
    /// Any media file with an audio track (studio mic track, instant MP4, ...).
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
pub async fn transcribe_recording(app: AppHandle, rec: Rec<'_>, job: TranscribeJob) -> Result<TranscribeResult, String> {
    let model = job.model.or(rec.settings().whisper_model).unwrap_or(ModelKind::SmallEn);
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
        lare_transcribe::transcribe_file(&model_path, &input, &TranscribeOptions::default(), move |p| {
            let _ = app.emit("transcribe:progress", progress_event(&job_id, p));
        })
    })
    .await
    .map_err(err)?
    .map_err(|e| format!("{e:#}"))?;
    let vtt = lare_transcribe::to_webvtt(&segments);
    Ok(TranscribeResult { model, segments, vtt })
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

/// Delete a file inside the recordings directory (e.g. a rendered export).
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
