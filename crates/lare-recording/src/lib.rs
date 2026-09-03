//! Lare's recording facade over the vendored Cap crates.
//!
//! * [`devices`] lists displays, cameras and microphones.
//! * [`permissions`] reports/requests OS capture permissions.
//! * [`Feeds`] owns the long-lived camera/microphone actors and hands out locks.
//! * [`start`] launches an **instant** (single MP4, camera window captured as part of the
//!   screen) or **studio** (separate display/camera/mic tracks in a `.cap` project) recording;
//!   [`ActiveRecording`] pauses/resumes/stops it.
//! * [`export_studio`] renders a studio project to MP4 headlessly with `cap-export`.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, anyhow};
use cap_recording::feeds::camera::{self, CameraFeed, CameraFeedLock};
use cap_recording::feeds::microphone::{self, MicrophoneFeed, MicrophoneFeedLock};
use cap_recording::sources::screen_capture::ScreenCaptureTarget;
use cap_recording::{instant_recording, studio_recording};
use kameo::Actor as _;
use kameo::actor::ActorRef;
use scap_targets::{Display, DisplayId};
use serde::{Deserialize, Serialize};

pub use cap_project::{ProjectConfiguration, RecordingMeta};

pub mod devices;
pub mod permissions;

// ---------------------------------------------------------------------------
// Feeds (long-lived device actors)
// ---------------------------------------------------------------------------

/// Long-lived camera + microphone actors. Create once per app; clone the `ActorRef`s freely.
pub struct Feeds {
    mic: ActorRef<MicrophoneFeed>,
    camera: ActorRef<CameraFeed>,
    mic_errors: flume::Receiver<cpal::StreamError>,
}

impl Feeds {
    /// Must be called from within a tokio runtime (kameo spawns tasks).
    pub fn spawn() -> Self {
        let (err_tx, err_rx) = flume::bounded(8);
        let mic = MicrophoneFeed::spawn(MicrophoneFeed::new(err_tx));
        let camera = CameraFeed::spawn(CameraFeed::default());
        Self {
            mic,
            camera,
            mic_errors: err_rx,
        }
    }

    pub fn mic(&self) -> &ActorRef<MicrophoneFeed> {
        &self.mic
    }

    pub fn camera(&self) -> &ActorRef<CameraFeed> {
        &self.camera
    }

    /// Drain any microphone stream errors reported since the last call.
    pub fn take_mic_errors(&self) -> Vec<String> {
        self.mic_errors.try_iter().map(|e| e.to_string()).collect()
    }

    /// Select and lock a microphone by its device label (as listed by [`devices::list_microphones`]).
    pub async fn lock_mic(&self, label: &str) -> anyhow::Result<Arc<MicrophoneFeedLock>> {
        let ready = self
            .mic
            .ask(microphone::SetInput {
                label: label.to_string(),
                settings: None,
            })
            .await
            .map_err(|e| anyhow!("failed to select microphone '{label}': {e}"))?;
        ready
            .await
            .map_err(|e| anyhow!("microphone '{label}' did not become ready: {e}"))?;
        let lock = self
            .mic
            .ask(microphone::Lock)
            .await
            .map_err(|e| anyhow!("failed to lock microphone '{label}': {e}"))?;
        Ok(Arc::new(lock))
    }

    /// Select and lock a camera by device id (as listed by [`devices::list_cameras`]).
    pub async fn lock_camera(&self, device_id: &str) -> anyhow::Result<Arc<CameraFeedLock>> {
        let info = cap_camera::list_cameras()
            .find(|c| c.device_id() == device_id)
            .ok_or_else(|| anyhow!("camera '{device_id}' not found"))?;
        let id = camera::DeviceOrModelID::from_info(&info);
        let ready = self
            .camera
            .ask(camera::SetInput { id, settings: None })
            .await
            .map_err(|e| anyhow!("failed to select camera '{device_id}': {e}"))?;
        ready
            .await
            .map_err(|e| anyhow!("camera '{device_id}' did not become ready: {e}"))?;
        let lock = self
            .camera
            .ask(camera::Lock)
            .await
            .map_err(|e| anyhow!("failed to lock camera '{device_id}': {e}"))?;
        Ok(Arc::new(lock))
    }

    /// Stop the microphone stream (call after a recording finishes).
    pub async fn release_mic(&self) {
        let _ = self.mic.ask(microphone::RemoveInput).await;
    }

    /// Stop the camera stream (call after a recording finishes).
    pub async fn release_camera(&self) {
        let _ = self.camera.ask(camera::RemoveInput).await;
    }
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordingMode {
    /// One MP4 (`content/output.mp4`), camera preview window captured as part of the screen.
    Instant,
    /// Separate display/camera/mic tracks in a `.cap` project, rendered later via [`export_studio`].
    Studio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartRequest {
    pub mode: RecordingMode,
    /// Directory to create the recording in (created if missing).
    pub dir: PathBuf,
    /// Display id string from [`devices::DisplayInfo::id`]; `None` = primary display.
    pub display_id: Option<String>,
    /// Microphone label; `None` = no microphone.
    pub mic_label: Option<String>,
    /// Camera device id; `None` = no camera track (studio) / no camera (instant).
    pub camera_id: Option<String>,
    #[serde(default = "default_fps")]
    pub max_fps: u32,
    /// Instant mode: cap the longest output edge (e.g. 1920). `None` = native resolution.
    pub max_output_size: Option<u32>,
    /// Capture system audio too.
    #[serde(default)]
    pub system_audio: bool,
}

fn default_fps() -> u32 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletedRecording {
    pub mode: RecordingMode,
    pub project_path: PathBuf,
    /// Instant mode: the finished MP4. Studio mode: `None` until [`export_studio`] runs.
    pub output_mp4: Option<PathBuf>,
    /// Studio mode: the microphone track (`content/segments/segment-0/audio-input.ogg`) if recorded.
    pub mic_track: Option<PathBuf>,
    pub started_at_epoch_ms: u64,
    pub ended_at_epoch_ms: u64,
}

enum Handle {
    Instant(instant_recording::ActorHandle),
    Studio(studio_recording::ActorHandle),
}

/// A running recording. Drop without `stop`/`cancel` leaves files on disk but stops nothing;
/// always call one of them.
pub struct ActiveRecording {
    mode: RecordingMode,
    project_path: PathBuf,
    started_at_epoch_ms: u64,
    handle: Handle,
    _mic: Option<Arc<MicrophoneFeedLock>>,
    _camera: Option<Arc<CameraFeedLock>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn resolve_target(display_id: Option<&str>) -> anyhow::Result<ScreenCaptureTarget> {
    let id: DisplayId = match display_id {
        Some(s) => s
            .parse()
            .map_err(|e| anyhow!("invalid display id '{s}': {e}"))?,
        None => Display::primary().id(),
    };
    if Display::from_id(&id).is_none() {
        return Err(anyhow!("display {id} is not connected"));
    }
    Ok(ScreenCaptureTarget::Display { id })
}

/// Start a recording. Returns once frames are flowing.
pub async fn start(req: StartRequest, feeds: &Feeds) -> anyhow::Result<ActiveRecording> {
    tokio::fs::create_dir_all(&req.dir)
        .await
        .with_context(|| format!("creating {}", req.dir.display()))?;
    let target = resolve_target(req.display_id.as_deref())?;

    let mic = match &req.mic_label {
        Some(label) => Some(feeds.lock_mic(label).await?),
        None => None,
    };
    let camera = match &req.camera_id {
        Some(id) => Some(feeds.lock_camera(id).await?),
        None => None,
    };

    #[cfg(target_os = "macos")]
    let shareable = Some(
        cidre::sc::ShareableContent::current()
            .await
            .map_err(|e| anyhow!("ScreenCaptureKit shareable content unavailable (screen recording permission?): {e}"))?
            .into(),
    );

    let started_at_epoch_ms = now_ms();
    let handle = match req.mode {
        RecordingMode::Instant => {
            let mut b = instant_recording::Actor::builder(req.dir.clone(), target)
                .with_system_audio(req.system_audio)
                .with_max_fps(req.max_fps);
            if let Some(size) = req.max_output_size {
                b = b.with_max_output_size(size);
            }
            if let Some(m) = mic.clone() {
                b = b.with_mic_feed(m);
            }
            if let Some(c) = camera.clone() {
                b = b.with_camera_feed(c);
            }
            #[cfg(target_os = "macos")]
            let h = b.build(shareable).await?;
            #[cfg(not(target_os = "macos"))]
            let h = b.build().await?;
            Handle::Instant(h)
        }
        RecordingMode::Studio => {
            let mut b = studio_recording::Actor::builder(req.dir.clone(), target)
                .with_system_audio(req.system_audio)
                .with_max_fps(req.max_fps)
                .with_custom_cursor(true);
            if let Some(m) = mic.clone() {
                b = b.with_mic_feed(m);
            }
            if let Some(c) = camera.clone() {
                b = b.with_camera_feed(c);
            }
            #[cfg(target_os = "macos")]
            let h = b.build(shareable).await?;
            #[cfg(not(target_os = "macos"))]
            let h = b.build().await?;
            Handle::Studio(h)
        }
    };

    Ok(ActiveRecording {
        mode: req.mode,
        project_path: req.dir,
        started_at_epoch_ms,
        handle,
        _mic: mic,
        _camera: camera,
    })
}

impl ActiveRecording {
    pub fn mode(&self) -> RecordingMode {
        self.mode
    }

    pub fn project_path(&self) -> &Path {
        &self.project_path
    }

    /// Epoch ms of media time zero (approximate: when the actor finished starting).
    pub fn started_at_epoch_ms(&self) -> u64 {
        self.started_at_epoch_ms
    }

    pub async fn pause(&self) -> anyhow::Result<()> {
        match &self.handle {
            Handle::Instant(h) => h.pause().await,
            Handle::Studio(h) => h.pause().await,
        }
    }

    pub async fn resume(&self) -> anyhow::Result<()> {
        match &self.handle {
            Handle::Instant(h) => h.resume().await,
            Handle::Studio(h) => h.resume().await,
        }
    }

    /// Stop and finalise files. Instant mode yields `content/output.mp4`.
    pub async fn stop(self) -> anyhow::Result<CompletedRecording> {
        let ended = now_ms();
        match self.handle {
            Handle::Instant(h) => {
                let done = h.stop().await.context("stopping instant recording")?;
                // Cap's instant pipeline writes DASH fragments (content/display, content/audio);
                // mux them into one progressive MP4 for upload.
                let content = done.project_path.join("content");
                let output = content.join("output.mp4");
                if !output.exists() {
                    let display_dir = content.join("display");
                    let audio_dir = content.join("audio");
                    let out = output.clone();
                    let completion = done.clean_completion;
                    tokio::task::spawn_blocking(move || {
                        use cap_recording::recovery::RecoveryManager;
                        match completion {
                            Some(c) => RecoveryManager::finalize_completed_instant_output(
                                &display_dir,
                                &audio_dir,
                                &out,
                                c,
                            ),
                            None => RecoveryManager::finalize_instant_output(&display_dir, &audio_dir, &out),
                        }
                    })
                    .await
                    .context("finalize task panicked")?
                    .map_err(|e| anyhow!("finalizing instant recording: {e}"))?;
                }
                Ok(CompletedRecording {
                    mode: RecordingMode::Instant,
                    project_path: done.project_path,
                    output_mp4: output.exists().then_some(output),
                    mic_track: None,
                    started_at_epoch_ms: self.started_at_epoch_ms,
                    ended_at_epoch_ms: ended,
                })
            }
            Handle::Studio(h) => {
                let done = h.stop().await.context("stopping studio recording")?;
                let mic_track = find_mic_track(&done.project_path);
                Ok(CompletedRecording {
                    mode: RecordingMode::Studio,
                    project_path: done.project_path,
                    output_mp4: None,
                    mic_track,
                    started_at_epoch_ms: self.started_at_epoch_ms,
                    ended_at_epoch_ms: ended,
                })
            }
        }
    }

    /// Abort and discard.
    pub async fn cancel(self) -> anyhow::Result<()> {
        match self.handle {
            Handle::Instant(h) => h.cancel().await,
            Handle::Studio(h) => h.cancel().await,
        }
    }
}

/// Locate the microphone track of a studio project (first segment).
pub fn find_mic_track(project_path: &Path) -> Option<PathBuf> {
    let segments = project_path.join("content").join("segments");
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&segments)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    for dir in dirs {
        for name in ["audio-input.ogg", "audio-input.mp3", "audio-input.wav"] {
            let p = dir.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Export (studio projects)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportQuality {
    Maximum,
    Social,
    Web,
    Potato,
}

impl From<ExportQuality> for cap_export::mp4::ExportCompression {
    fn from(q: ExportQuality) -> Self {
        match q {
            ExportQuality::Maximum => cap_export::mp4::ExportCompression::Maximum,
            ExportQuality::Social => cap_export::mp4::ExportCompression::Social,
            ExportQuality::Web => cap_export::mp4::ExportCompression::Web,
            ExportQuality::Potato => cap_export::mp4::ExportCompression::Potato,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportRequest {
    pub project_path: PathBuf,
    /// Timeline/camera/background configuration. `None` = the project's saved
    /// `project-config.json`, or Cap's defaults (full recording, camera bottom-right).
    pub config: Option<ProjectConfiguration>,
    pub output: PathBuf,
    #[serde(default = "default_fps")]
    pub fps: u32,
    /// Longest edge of the rendered video, e.g. 1920 (defaults to the source size).
    pub resolution_base: Option<(u32, u32)>,
    pub quality: ExportQuality,
}

/// Render a studio project to MP4. `on_progress(rendered_frames, total_frames)`; return
/// `false` from it to cancel.
pub async fn export_studio<F>(req: ExportRequest, mut on_progress: F) -> anyhow::Result<PathBuf>
where
    F: FnMut(u32, u32) -> bool + Send + 'static,
{
    let mut builder = cap_export::ExporterBase::builder(req.project_path.clone())
        .with_output_path(req.output.clone());
    if let Some(cfg) = req.config.clone() {
        builder = builder.with_config(cfg);
    }
    let base = builder.build().await.map_err(|e| anyhow!("export setup failed: {e}"))?;
    let total = base.total_frames(req.fps);
    let (w, h) = req
        .resolution_base
        .unwrap_or_else(|| (1920, 1080));
    let settings = cap_export::mp4::Mp4ExportSettings {
        fps: req.fps,
        resolution_base: cap_project::XY::new(w, h),
        compression: req.quality.into(),
        custom_bpp: None,
        force_ffmpeg_decoder: false,
        optimize_filesize: true,
    };
    let path = settings
        .export(base, move |frame| on_progress(frame, total))
        .await
        .map_err(|e| anyhow!("export failed: {e}"))?;
    Ok(path)
}
