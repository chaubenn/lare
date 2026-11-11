//! Lare's recording facade over the vendored Cap crates.
//!
//! * [`devices`] lists displays, cameras and microphones.
//! * [`permissions`] reports/requests OS capture permissions.
//! * [`Feeds`] owns the long-lived camera/microphone actors and hands out locks.
//! * [`start`] launches a recording (one append-only MP4, the camera preview window captured as
//!   part of the screen); [`ActiveRecording`] pauses/resumes/stops it.
//! * [`layout`] names the files a recording leaves in its project directory.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, anyhow};
use cap_recording::feeds::camera::{self, CameraFeed, CameraFeedLock};
use cap_recording::feeds::microphone::{self, MicrophoneFeed, MicrophoneFeedLock};
use cap_recording::instant_recording;
use cap_recording::sources::screen_capture::ScreenCaptureTarget;
use kameo::Actor as _;
use kameo::actor::ActorRef;
use scap_targets::{Display, DisplayId};

pub mod devices;
mod fragmented;
pub mod layout;
mod live;
pub mod permissions;
pub mod thumbnail;

// ---------------------------------------------------------------------------
// Feeds (long-lived device actors)
// ---------------------------------------------------------------------------

/// Long-lived camera + microphone actors. Create once per app; clone the `ActorRef`s freely.
pub struct Feeds {
    mic: ActorRef<MicrophoneFeed>,
    camera: ActorRef<CameraFeed>,
}

impl Feeds {
    /// Must be called from within a tokio runtime (kameo spawns tasks).
    pub fn spawn() -> Self {
        // Nothing reads the feed's stream errors: it only ever `try_send`s them, so a channel
        // with no receiver costs nothing.
        let (stream_errors, _) = flume::bounded::<cpal::StreamError>(8);
        let mic = MicrophoneFeed::spawn(MicrophoneFeed::new(stream_errors));
        let camera = CameraFeed::spawn(CameraFeed::default());
        Self { mic, camera }
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

#[derive(Debug, Clone)]
pub struct StartRequest {
    /// Directory to create the recording in (created if missing).
    pub dir: PathBuf,
    /// Display id string from [`devices::DisplayInfo::id`]; `None` = primary display.
    pub display_id: Option<String>,
    /// Microphone label; `None` = no microphone.
    pub mic_label: Option<String>,
    /// Camera device id; `None` = no camera.
    pub camera_id: Option<String>,
    pub max_fps: u32,
    /// Cap the longest output edge (e.g. 1920). `None` = native resolution.
    pub max_output_size: Option<u32>,
    /// Capture system audio too.
    pub system_audio: bool,
}

#[derive(Debug, Clone)]
pub struct CompletedRecording {
    pub project_path: PathBuf,
    /// The finished MP4.
    pub output_mp4: Option<PathBuf>,
    pub started_at_epoch_ms: u64,
    pub ended_at_epoch_ms: u64,
}

/// A running recording. Drop without `stop`/`cancel` leaves files on disk but stops nothing;
/// always call one of them.
pub struct ActiveRecording {
    project_path: PathBuf,
    started_at_epoch_ms: u64,
    handle: instant_recording::ActorHandle,
    _mic: Option<Arc<MicrophoneFeedLock>>,
    _camera: Option<Arc<CameraFeedLock>>,
    live: Option<live::LiveOutput>,
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
    let mut builder = instant_recording::Actor::builder(req.dir.clone(), target)
        .with_system_audio(req.system_audio)
        .with_max_fps(req.max_fps);
    if let Some(size) = req.max_output_size {
        builder = builder.with_max_output_size(size);
    }
    if let Some(m) = mic.clone() {
        builder = builder.with_mic_feed(m);
    }
    if let Some(c) = camera.clone() {
        builder = builder.with_camera_feed(c);
    }
    #[cfg(target_os = "macos")]
    let handle = builder.build(shareable).await?;
    #[cfg(not(target_os = "macos"))]
    let handle = builder.build().await?;

    let live = {
        let result = handle
            .take_segment_rx()
            .ok_or_else(|| anyhow!("capture has no closed-fragment stream"))
            .and_then(|rx| {
                live::LiveOutput::start(
                    &req.dir,
                    mic.is_some() || req.system_audio,
                    move |timeout| {
                        use cap_enc_ffmpeg::segmented_stream::SegmentMediaType;
                        rx.recv_timeout(timeout).map(|event| live::Fragment {
                            track: match event.media_type {
                                SegmentMediaType::Video => 0,
                                SegmentMediaType::Audio => 1,
                            },
                            path: event.path,
                            index: event.index,
                            is_init: event.is_init,
                        })
                    },
                )
            });
        match result {
            Ok(output) => Some(output),
            Err(error) => {
                let _ = handle.cancel().await;
                return Err(error);
            }
        }
    };
    Ok(ActiveRecording {
        project_path: req.dir,
        started_at_epoch_ms,
        handle,
        _mic: mic,
        _camera: camera,
        live,
    })
}

impl ActiveRecording {
    /// Append-only combined MP4 and a completion signal sent only after clean stop/close.
    pub fn live_output(&self) -> Option<(PathBuf, tokio::sync::watch::Receiver<bool>)> {
        self.live
            .as_ref()
            .map(|live| (live.path.clone(), live.completion()))
    }

    pub fn project_path(&self) -> &Path {
        &self.project_path
    }

    /// Epoch ms of media time zero (approximate: when the actor finished starting).
    pub fn started_at_epoch_ms(&self) -> u64 {
        self.started_at_epoch_ms
    }

    pub async fn pause(&self) -> anyhow::Result<()> {
        self.handle.pause().await
    }

    pub async fn resume(&self) -> anyhow::Result<()> {
        self.handle.resume().await
    }

    /// Stop and finalise files, yielding the live capture file.
    pub async fn stop(self) -> anyhow::Result<CompletedRecording> {
        let ended = now_ms();
        let result = self
            .handle
            .stop()
            .await
            .context("stopping instant recording");
        let live = self.live.ok_or_else(|| anyhow!("missing live muxer"))?;
        let output = live.finish(result.is_ok()).await;
        let done = result?;
        let output = output?;
        Ok(CompletedRecording {
            project_path: done.project_path,
            output_mp4: output.exists().then_some(output),
            started_at_epoch_ms: self.started_at_epoch_ms,
            ended_at_epoch_ms: ended,
        })
    }

    /// Abort and discard.
    pub async fn cancel(self) -> anyhow::Result<()> {
        let result = self.handle.cancel().await;
        if let Some(live) = self.live {
            let _ = live.finish(false).await;
        }
        result
    }
}

/// Finish a project from whatever is on disk, without the actor that wrote it.
///
/// [`ActiveRecording::stop`] does this with the actor's own completion handle; this is the same
/// work for the two cases where that handle is gone: `stop` itself failed, and the process was
/// killed mid-recording. The project reuses a certified live output or is recovered into
/// [`layout::recovered_output`] (returned).
pub fn finalize_project(project_path: &Path) -> anyhow::Result<Option<PathBuf>> {
    let content = layout::content_dir(project_path);
    let live = content.join(layout::CAPTURE_FILE_NAME);
    if layout::complete_marker(&live).exists() && live.exists() {
        return Ok(Some(live));
    }
    let output = layout::recovered_output(project_path);
    if !output.exists() {
        cap_recording::recovery::RecoveryManager::finalize_instant_output(
            &content.join("display"),
            &content.join("audio"),
            &output,
        )
        .map_err(|e| anyhow!("finalizing instant recording: {e}"))?;
    }
    Ok(output.exists().then_some(output))
}
