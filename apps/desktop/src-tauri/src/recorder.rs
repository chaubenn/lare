//! The real recorder: wires `lare-recording` (Cap's capture stack) into the app.
//!
//! Two entry points share one [`Recorder`]:
//! * the extension-driven mock interview flow (via [`RecordingBackend`]), and
//! * demo recordings started from the draft editor (via Tauri commands in `commands.rs`).
//!
//! State changes are broadcast to the extension (`recording.state` frames) and to the webview
//! (`recording:state` / `recording:completed` events).

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use lare_core::protocol::{AppToExt, RecordingState};
use lare_recording::{Feeds, RecordingMode, StartRequest};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, OnceCell};
use tracing::{error, info, warn};

use crate::recording::{RecordingBackend, RecordingRequest};
use crate::ws_server::WsHub;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    /// Mock interview started by the Chrome extension.
    Interview,
    /// Demo video started from the draft editor.
    Demo,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecorderSettings {
    /// `None` = primary display.
    pub display_id: Option<String>,
    /// `None` = system default microphone; `Some("")` = no microphone.
    pub mic_label: Option<String>,
    /// `None` = first camera.
    pub camera_id: Option<String>,
    #[serde(default)]
    pub whisper_model: Option<lare_transcribe::ModelKind>,
    /// Instant mode longest-edge cap. `None` = 1920.
    pub max_output_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePayload {
    pub state: RecordingState,
    pub recording_id: Option<String>,
    pub session_id: Option<String>,
    pub purpose: Option<Purpose>,
    pub mode: Option<RecordingMode>,
    pub started_at: Option<u64>,
    pub project_path: Option<PathBuf>,
    pub post_id: Option<String>,
    pub message: Option<String>,
    /// Media captured so far in ms, excluding paused stretches — the length of the video the
    /// user will actually get. `None` when nothing is recording.
    #[serde(default)]
    pub recorded_ms: Option<u64>,
}

impl StatePayload {
    fn idle() -> Self {
        Self {
            state: RecordingState::Idle,
            recording_id: None,
            session_id: None,
            purpose: None,
            mode: None,
            started_at: None,
            project_path: None,
            post_id: None,
            message: None,
            recorded_ms: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedPayload {
    pub recording_id: String,
    pub session_id: Option<String>,
    pub purpose: Purpose,
    pub mode: RecordingMode,
    pub project_path: PathBuf,
    pub output_mp4: Option<PathBuf>,
    pub mic_track: Option<PathBuf>,
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

/// The start manifest (`lare-started.json`), written the moment a recording begins so a project
/// abandoned by a killed process can still be identified and finished at the next launch.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartedManifest {
    recording_id: String,
    session_id: Option<String>,
    purpose: Option<Purpose>,
    mode: Option<RecordingMode>,
    started_at: u64,
    post_id: Option<String>,
    #[serde(default)]
    facecam: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoStart {
    pub mode: RecordingMode,
    pub post_id: Option<String>,
    #[serde(default)]
    pub facecam: bool,
    #[serde(default = "default_true")]
    pub mic: bool,
}

fn default_true() -> bool {
    true
}

/// Everything needed to start a recording.
#[derive(Debug, Clone)]
pub struct StartSpec {
    pub purpose: Purpose,
    pub mode: RecordingMode,
    /// Interview session id (extension-driven recordings).
    pub session_id: Option<String>,
    /// Draft post the demo video belongs to.
    pub post_id: Option<String>,
    pub facecam: bool,
    pub mic: bool,
}

struct Active {
    recording_id: String,
    session_id: Option<String>,
    purpose: Purpose,
    post_id: Option<String>,
    facecam: bool,
    rec: lare_recording::ActiveRecording,
    /// When the current pause began; `None` while recording.
    paused_at: Option<u64>,
    /// Time already spent paused, in ms.
    paused_total_ms: u64,
}

impl Active {
    fn paused(&self) -> bool {
        self.paused_at.is_some()
    }

    /// Wall clock since the start, less every paused stretch (including one in progress).
    fn recorded_ms(&self) -> u64 {
        let now = now_ms();
        let paused = self.paused_total_ms + self.paused_at.map_or(0, |at| now.saturating_sub(at));
        now.saturating_sub(self.rec.started_at_epoch_ms())
            .saturating_sub(paused)
    }
}

/// How the last recording ended. Kept so a second `stop`/`cancel` gets the same answer instead
/// of "No active recording": the pill's stop button and the extension's `session.end` frame race
/// on every interview that is ended from the browser.
enum Finish {
    Completed(Box<CompletedPayload>),
    Cancelled,
}

pub struct Recorder {
    app: AppHandle,
    feeds: OnceCell<Feeds>,
    active: Mutex<Option<Active>>,
    starting: Mutex<bool>,
    /// Held for the whole of `stop`/`cancel` so the two never interleave.
    finishing: Mutex<()>,
    last_finish: Mutex<Option<Finish>>,
    settings: RwLock<RecorderSettings>,
    recordings_dir: PathBuf,
}

impl Recorder {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let base = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("lare"));
        let recordings_dir = base.join("recordings");
        let settings = load_settings(&base);
        Arc::new(Self {
            app,
            feeds: OnceCell::new(),
            active: Mutex::new(None),
            starting: Mutex::new(false),
            finishing: Mutex::new(()),
            last_finish: Mutex::new(None),
            settings: RwLock::new(settings),
            recordings_dir,
        })
    }

    pub fn recordings_dir(&self) -> &Path {
        &self.recordings_dir
    }

    pub fn models_dir(&self) -> PathBuf {
        self.recordings_dir
            .parent()
            .map(|p| p.join("models"))
            .unwrap_or_else(|| std::env::temp_dir().join("lare-models"))
    }

    pub fn settings(&self) -> RecorderSettings {
        self.settings.read().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn set_settings(&self, settings: RecorderSettings) {
        if let Ok(mut s) = self.settings.write() {
            *s = settings.clone();
        }
        if let Some(base) = self.recordings_dir.parent() {
            save_settings(base, &settings);
        }
    }

    async fn feeds(&self) -> &Feeds {
        self.feeds.get_or_init(|| async { Feeds::spawn() }).await
    }

    pub fn permissions(&self) -> lare_recording::permissions::Permissions {
        lare_recording::permissions::check()
    }

    pub async fn status(&self) -> StatePayload {
        // `active` is always taken before `starting`; `start` uses the same order.
        let active = self.active.lock().await;
        match active.as_ref() {
            None => {
                let starting = *self.starting.lock().await;
                let mut p = StatePayload::idle();
                if starting {
                    p.state = RecordingState::Starting;
                }
                p
            }
            Some(a) => StatePayload {
                state: if a.paused() {
                    RecordingState::Paused
                } else {
                    RecordingState::Recording
                },
                recording_id: Some(a.recording_id.clone()),
                session_id: a.session_id.clone(),
                purpose: Some(a.purpose),
                mode: Some(a.rec.mode()),
                started_at: Some(a.rec.started_at_epoch_ms()),
                project_path: Some(a.rec.project_path().to_path_buf()),
                post_id: a.post_id.clone(),
                message: None,
                recorded_ms: Some(a.recorded_ms()),
            },
        }
    }

    fn emit_state(&self, payload: &StatePayload) {
        if let Err(e) = self.app.emit("recording:state", payload) {
            warn!(%e, "emit recording:state failed");
        }
    }

    fn broadcast_ext(&self, hub: Option<&WsHub>, session_id: Option<&str>, state: RecordingState, started_at: Option<u64>, message: Option<String>) {
        if let Some(hub) = hub {
            hub.broadcast(AppToExt::RecordingState {
                session_id: session_id.map(str::to_string),
                state,
                started_at,
                message,
            });
        }
    }

    fn resolve_mic(&self, want_mic: bool) -> Option<String> {
        if !want_mic {
            return None;
        }
        match self.settings().mic_label {
            Some(label) if label.is_empty() => None,
            Some(label) => Some(label),
            None => lare_recording::devices::list_microphones()
                .into_iter()
                .find(|m| m.default)
                .or_else(|| lare_recording::devices::list_microphones().into_iter().next())
                .map(|m| m.name),
        }
    }

    fn resolve_camera(&self, want_camera: bool) -> Option<String> {
        if !want_camera {
            return None;
        }
        self.settings()
            .camera_id
            .or_else(|| lare_recording::devices::list_cameras().into_iter().next().map(|c| c.id))
    }

    /// Start a recording. `hub` is set for extension-driven interviews so the extension is kept
    /// informed with `recording.state` frames.
    pub async fn start(self: &Arc<Self>, spec: StartSpec, hub: Option<WsHub>) -> Result<StatePayload, String> {
        let StartSpec {
            mode,
            facecam,
            ref session_id,
            ..
        } = spec;
        let session_id = session_id.clone();
        {
            // Same order as `status`: active, then starting. Taking them the other way round
            // here would let the two deadlock against each other.
            let active = self.active.lock().await;
            let mut starting = self.starting.lock().await;
            if *starting || active.is_some() {
                return Err("A recording is already in progress".into());
            }
            *starting = true;
        }
        *self.last_finish.lock().await = None;
        // Instant mode has no camera track: the facecam preview window is captured as part
        // of the screen, so it must be on screen before capture starts.
        let display_id = self.settings().display_id;
        if facecam && mode == RecordingMode::Instant {
            if let Err(e) = crate::windows::open_camera(&self.app, display_id.as_deref()) {
                warn!(%e, "camera preview window failed to open");
            }
        }
        let result = self.start_inner(&spec, hub.as_ref()).await;
        *self.starting.lock().await = false;
        match &result {
            Ok(payload) => {
                self.emit_state(payload);
                if let Err(e) = crate::windows::open_recorder(&self.app, display_id.as_deref()) {
                    warn!(%e, "recorder window failed to open");
                }
            }
            Err(message) => {
                crate::windows::hide_camera(&self.app);
                let mut p = StatePayload::idle();
                p.state = RecordingState::Error;
                p.session_id = session_id.clone();
                p.message = Some(message.clone());
                self.emit_state(&p);
                self.broadcast_ext(hub.as_ref(), session_id.as_deref(), RecordingState::Error, None, Some(message.clone()));
            }
        }
        result
    }

    async fn start_inner(self: &Arc<Self>, spec: &StartSpec, hub: Option<&WsHub>) -> Result<StatePayload, String> {
        let StartSpec {
            purpose,
            mode,
            facecam,
            mic,
            ..
        } = *spec;
        let session_id = spec.session_id.clone();
        let post_id = spec.post_id.clone();
        let perms = self.permissions();
        if !perms.recording_capable() {
            return Err("Screen recording permission is not granted. Enable it in System Settings > Privacy & Security > Screen Recording, then restart Lare.".into());
        }
        self.broadcast_ext(hub, session_id.as_deref(), RecordingState::Starting, None, None);
        let mut starting = StatePayload::idle();
        starting.state = RecordingState::Starting;
        starting.session_id = session_id.clone();
        starting.purpose = Some(purpose);
        starting.mode = Some(mode);
        self.emit_state(&starting);

        let recording_id = uuid_like();
        let dir = self.recordings_dir.join(&recording_id);
        let settings = self.settings();
        // Instant mode captures the on-screen camera preview window instead of a camera track.
        let camera_id = match mode {
            RecordingMode::Studio => self.resolve_camera(facecam),
            RecordingMode::Instant => None,
        };
        let req = StartRequest {
            mode,
            dir: dir.clone(),
            display_id: settings.display_id.clone(),
            mic_label: self.resolve_mic(mic),
            camera_id,
            max_fps: 30,
            max_output_size: Some(settings.max_output_size.unwrap_or(1920)),
            system_audio: false,
        };
        info!(?purpose, ?mode, dir = %dir.display(), "starting recording");
        let feeds = self.feeds().await;
        let rec = lare_recording::start(req, feeds)
            .await
            .map_err(|e| format!("Could not start recording: {e:#}"))?;
        let started_at = rec.started_at_epoch_ms();
        let payload = StatePayload {
            state: RecordingState::Recording,
            recording_id: Some(recording_id.clone()),
            session_id: session_id.clone(),
            purpose: Some(purpose),
            mode: Some(mode),
            started_at: Some(started_at),
            project_path: Some(rec.project_path().to_path_buf()),
            post_id: post_id.clone(),
            message: None,
            recorded_ms: Some(0),
        };
        write_manifest(rec.project_path(), &payload, facecam);
        *self.active.lock().await = Some(Active {
            recording_id,
            session_id: session_id.clone(),
            purpose,
            post_id,
            facecam,
            rec,
            paused_at: None,
            paused_total_ms: 0,
        });
        self.broadcast_ext(hub, session_id.as_deref(), RecordingState::Recording, Some(started_at), None);
        Ok(payload)
    }

    pub async fn pause(&self, hub: Option<&WsHub>) -> Result<StatePayload, String> {
        let mut guard = self.active.lock().await;
        let a = guard.as_mut().ok_or("No active recording")?;
        if a.paused_at.is_none() {
            a.rec.pause().await.map_err(|e| format!("pause failed: {e:#}"))?;
            a.paused_at = Some(now_ms());
        }
        let sid = a.session_id.clone();
        let started = a.rec.started_at_epoch_ms();
        drop(guard);
        self.broadcast_ext(hub, sid.as_deref(), RecordingState::Paused, Some(started), None);
        let p = self.status().await;
        self.emit_state(&p);
        Ok(p)
    }

    pub async fn resume(&self, hub: Option<&WsHub>) -> Result<StatePayload, String> {
        let mut guard = self.active.lock().await;
        let a = guard.as_mut().ok_or("No active recording")?;
        if let Some(at) = a.paused_at {
            a.rec.resume().await.map_err(|e| format!("resume failed: {e:#}"))?;
            a.paused_at = None;
            a.paused_total_ms += now_ms().saturating_sub(at);
        }
        let sid = a.session_id.clone();
        let started = a.rec.started_at_epoch_ms();
        drop(guard);
        self.broadcast_ext(hub, sid.as_deref(), RecordingState::Recording, Some(started), None);
        let p = self.status().await;
        self.emit_state(&p);
        Ok(p)
    }

    /// Stop and keep the recording. Safe to call twice: the loser of the race gets the same
    /// payload the winner produced, not an error.
    pub async fn stop(&self, hub: Option<&WsHub>) -> Result<CompletedPayload, String> {
        let _finishing = self.finishing.lock().await;
        let Some(active) = self.active.lock().await.take() else {
            return match &*self.last_finish.lock().await {
                Some(Finish::Completed(p)) => Ok((**p).clone()),
                Some(Finish::Cancelled) => Err("The recording was discarded.".into()),
                None => Err("No active recording".into()),
            };
        };
        // Hidden, not closed: this call usually comes from a button inside the pill's webview.
        crate::windows::hide_recorder(&self.app);
        crate::windows::hide_camera(&self.app);
        let sid = active.session_id.clone();
        let mode = active.rec.mode();
        let project_path = active.rec.project_path().to_path_buf();
        let started = active.rec.started_at_epoch_ms();
        let recorded_ms = active.recorded_ms();
        self.broadcast_ext(hub, sid.as_deref(), RecordingState::Stopping, Some(started), None);
        let mut stopping = StatePayload::idle();
        stopping.state = RecordingState::Stopping;
        stopping.recording_id = Some(active.recording_id.clone());
        stopping.session_id = sid.clone();
        stopping.recorded_ms = Some(recorded_ms);
        self.emit_state(&stopping);

        let feeds = self.feeds().await;
        let result = active.rec.stop().await;
        feeds.release_mic().await;
        feeds.release_camera().await;

        // A failed stop is not a lost recording: the fragments Cap already wrote are the whole
        // take bar the final mux, so finish them from disk before giving up.
        let finished = match result {
            Ok(done) => Ok((done.project_path, done.output_mp4, done.mic_track, done.ended_at_epoch_ms)),
            Err(e) => {
                warn!(error = %format!("{e:#}"), "stopping the recording failed; salvaging the project");
                match salvage(mode, project_path.clone()).await {
                    // An instant recording is only salvaged if the mux actually produced the MP4;
                    // a studio project has no single output until the exporter runs either way.
                    Ok(output) if mode == RecordingMode::Studio || output.is_some() => {
                        Ok((project_path.clone(), output, mic_track(mode, &project_path), now_ms()))
                    }
                    Ok(_) => Err(format!(
                        "Stopping the recording failed: {e:#} (there was nothing left on disk to recover)"
                    )),
                    Err(salvage_error) => Err(format!(
                        "Stopping the recording failed: {e:#} (recovering it from disk also failed: {salvage_error})"
                    )),
                }
            }
        };
        let (project_path, output_mp4, mic_track, ended_at) = match finished {
            Ok(parts) => parts,
            Err(msg) => {
                error!(%msg);
                *self.last_finish.lock().await = None;
                self.broadcast_ext(hub, sid.as_deref(), RecordingState::Error, None, Some(msg.clone()));
                let mut p = StatePayload::idle();
                p.state = RecordingState::Error;
                p.message = Some(msg.clone());
                self.emit_state(&p);
                return Err(msg);
            }
        };
        let payload = CompletedPayload {
            recording_id: active.recording_id,
            session_id: sid.clone(),
            purpose: active.purpose,
            mode,
            project_path: project_path.clone(),
            output_mp4,
            mic_track,
            started_at: started,
            ended_at,
            post_id: active.post_id,
            facecam: active.facecam,
            recorded_ms,
        };
        // The manifest goes down before anything that can still fail: from here on the recording
        // exists on disk, and the Recordings page can retry whatever comes next.
        write_completed(&project_path, &payload);
        *self.last_finish.lock().await = Some(Finish::Completed(Box::new(payload.clone())));
        if let Err(e) = self.app.emit("recording:completed", &payload) {
            warn!(%e, "emit recording:completed failed");
        }
        self.broadcast_ext(hub, sid.as_deref(), RecordingState::Idle, None, None);
        self.emit_state(&StatePayload::idle());
        Ok(payload)
    }

    /// Stop and throw the recording away. Idempotent in the same way as [`Recorder::stop`].
    pub async fn cancel(&self, hub: Option<&WsHub>) -> Result<(), String> {
        let _finishing = self.finishing.lock().await;
        let Some(active) = self.active.lock().await.take() else {
            // Whichever of the two calls arrived first has already finished the recording;
            // there is nothing left to discard either way.
            return match &*self.last_finish.lock().await {
                Some(_) => Ok(()),
                None => Err("No active recording".into()),
            };
        };
        crate::windows::hide_recorder(&self.app);
        crate::windows::hide_camera(&self.app);
        let sid = active.session_id.clone();
        let path = active.rec.project_path().to_path_buf();
        let feeds = self.feeds().await;
        let res = active.rec.cancel().await.map_err(|e| format!("cancel failed: {e:#}"));
        feeds.release_mic().await;
        feeds.release_camera().await;
        let _ = std::fs::remove_dir_all(&path);
        *self.last_finish.lock().await = Some(Finish::Cancelled);
        self.broadcast_ext(hub, sid.as_deref(), RecordingState::Idle, None, None);
        self.emit_state(&StatePayload::idle());
        res
    }

    /// Release everything the OS can see Lare holding: the ScreenCaptureKit stream, the camera
    /// and the microphone. Run on every way out of the process (see [`crate::shutdown`]).
    ///
    /// The take is stopped, not discarded — quitting mid-recording keeps the video, which is why
    /// this goes through [`Recorder::stop`] rather than something cheaper. It is idempotent:
    /// `stop` answers a second caller from `last_finish` instead of erroring.
    pub async fn shutdown(&self) {
        if self.active.lock().await.is_some() {
            info!("stopping the recording before the app exits");
            match self.stop(None).await {
                Ok(p) => info!(recording = %p.recording_id, "recording saved on the way out"),
                Err(e) => warn!(%e, "could not save the recording on the way out"),
            }
        }
        // The feeds outlive individual recordings, so the camera light and the microphone stay
        // on until they are asked to stop even when nothing was being recorded.
        if let Some(feeds) = self.feeds.get() {
            feeds.release_mic().await;
            feeds.release_camera().await;
        }
    }

    /// Finish recordings a previous run left behind — a project with a start manifest but no
    /// completed one, which is what a crash or a force-quit leaves. Runs once at launch, before
    /// the Recordings page asks for the list, so an interrupted take simply turns up in it.
    pub fn recover_incomplete(&self) -> usize {
        let Ok(entries) = std::fs::read_dir(&self.recordings_dir) else {
            return 0;
        };
        let mut recovered = 0;
        for entry in entries.flatten() {
            let dir = entry.path();
            // `lare-unrecoverable.json` is the tombstone below: a project with nothing in it is
            // retried once, not on every launch for the rest of the install's life.
            if !dir.is_dir()
                || dir.join("lare-recording.json").exists()
                || dir.join("lare-unrecoverable.json").exists()
            {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(dir.join("lare-started.json")) else {
                continue;
            };
            let Ok(started) = serde_json::from_str::<StartedManifest>(&text) else {
                continue;
            };
            let (Some(mode), Some(purpose)) = (started.mode, started.purpose) else {
                continue;
            };
            info!(dir = %dir.display(), "finishing a recording left behind by a previous run");
            let output_mp4 = match lare_recording::finalize_project(mode, &dir) {
                Ok(output) => output,
                Err(e) => {
                    let reason = format!("{e:#}");
                    warn!(dir = %dir.display(), error = %reason, "could not recover recording");
                    write_unrecoverable(&dir, &reason);
                    continue;
                }
            };
            if mode == RecordingMode::Instant && output_mp4.is_none() {
                warn!(dir = %dir.display(), "nothing recoverable in the project");
                write_unrecoverable(&dir, "no display segments were written before the process died");
                continue;
            }
            // The kill took the pause bookkeeping with it, so the wall clock is the best guess
            // at the length; the file itself is the source of truth once it is opened.
            let ended_at = std::fs::metadata(&dir)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or_else(now_ms)
                .max(started.started_at);
            let payload = CompletedPayload {
                recording_id: started.recording_id,
                session_id: started.session_id,
                purpose,
                mode,
                project_path: dir.clone(),
                output_mp4,
                mic_track: mic_track(mode, &dir),
                started_at: started.started_at,
                ended_at,
                post_id: started.post_id,
                facecam: started.facecam,
                recorded_ms: ended_at.saturating_sub(started.started_at),
            };
            write_completed(&dir, &payload);
            recovered += 1;
        }
        recovered
    }

    /// List completed recordings (manifests) newest first.
    pub fn list_completed(&self) -> Vec<CompletedPayload> {
        let mut out = Vec::new();
        if let Ok(rd) = std::fs::read_dir(&self.recordings_dir) {
            for entry in rd.flatten() {
                let p = entry.path().join("lare-recording.json");
                if let Ok(text) = std::fs::read_to_string(&p) {
                    if let Ok(c) = serde_json::from_str::<CompletedPayload>(&text) {
                        out.push(c);
                    }
                }
            }
        }
        out.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
        out
    }
}

/// Bridge from the extension's `session.*` frames to the recorder (mock interviews).
pub struct CapRecordingBackend {
    recorder: Arc<Recorder>,
}

impl CapRecordingBackend {
    pub fn new(recorder: Arc<Recorder>) -> Self {
        Self { recorder }
    }
}

impl RecordingBackend for CapRecordingBackend {
    fn start(&self, hub: &WsHub, req: RecordingRequest) {
        let recorder = self.recorder.clone();
        let hub = hub.clone();
        tauri::async_runtime::spawn(async move {
            let res = recorder
                .start(
                    StartSpec {
                        purpose: Purpose::Interview,
                        mode: RecordingMode::Studio,
                        session_id: Some(req.session_id.clone()),
                        post_id: None,
                        facecam: req.facecam,
                        mic: req.mic,
                    },
                    Some(hub),
                )
                .await;
            if let Err(e) = res {
                error!(session = %req.session_id, %e, "interview recording failed to start");
            }
        });
    }

    fn pause(&self, hub: &WsHub, _session_id: &str, _at: u64) {
        let recorder = self.recorder.clone();
        let hub = hub.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = recorder.pause(Some(&hub)).await {
                warn!(%e, "pause failed");
            }
        });
    }

    fn resume(&self, hub: &WsHub, _session_id: &str, _at: u64) {
        let recorder = self.recorder.clone();
        let hub = hub.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = recorder.resume(Some(&hub)).await {
                warn!(%e, "resume failed");
            }
        });
    }

    fn stop(&self, hub: &WsHub, _session_id: &str, _at: u64) {
        let recorder = self.recorder.clone();
        let hub = hub.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = recorder.stop(Some(&hub)).await {
                warn!(%e, "stop failed");
            }
        });
    }

    fn capable(&self) -> bool {
        self.recorder.permissions().recording_capable()
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Mux/remux a project from what is on disk, off the async runtime (ffmpeg work, seconds long).
async fn salvage(mode: RecordingMode, project_path: PathBuf) -> Result<Option<PathBuf>, String> {
    tokio::task::spawn_blocking(move || lare_recording::finalize_project(mode, &project_path))
        .await
        .map_err(|e| format!("recovery task panicked: {e}"))?
        .map_err(|e| format!("{e:#}"))
}

/// Studio projects keep the microphone as its own track; instant recordings mux it into the MP4.
fn mic_track(mode: RecordingMode, project_path: &Path) -> Option<PathBuf> {
    match mode {
        RecordingMode::Studio => lare_recording::find_mic_track(project_path),
        RecordingMode::Instant => None,
    }
}

fn uuid_like() -> String {
    // Time-ordered, filesystem-safe id without pulling in uuid: <unix-ms>-<random>
    let ms = now_ms();
    let rand: u64 = rand_u64();
    format!("{ms:013x}-{rand:016x}")
}

fn rand_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    std::collections::hash_map::RandomState::new().build_hasher().finish()
}

fn settings_path(base: &Path) -> PathBuf {
    base.join("recorder-settings.json")
}

fn load_settings(base: &Path) -> RecorderSettings {
    std::fs::read_to_string(settings_path(base))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(base: &Path, settings: &RecorderSettings) {
    if std::fs::create_dir_all(base).is_ok() {
        if let Ok(json) = serde_json::to_string_pretty(settings) {
            let _ = std::fs::write(settings_path(base), json);
        }
    }
}

fn write_manifest(project: &Path, payload: &StatePayload, facecam: bool) {
    let manifest = serde_json::json!({
        "recordingId": payload.recording_id,
        "sessionId": payload.session_id,
        "purpose": payload.purpose,
        "mode": payload.mode,
        "startedAt": payload.started_at,
        "postId": payload.post_id,
        "facecam": facecam,
    });
    let _ = std::fs::write(project.join("lare-started.json"), manifest.to_string());
}

/// Tombstone for a project [`Recorder::recover_incomplete`] could not finish, so the next launch
/// walks past it instead of redoing the same failing work (and the directory says why).
fn write_unrecoverable(project: &Path, reason: &str) {
    let note = serde_json::json!({ "reason": reason, "at": now_ms() });
    let _ = std::fs::write(project.join("lare-unrecoverable.json"), note.to_string());
}

fn write_completed(project: &Path, payload: &CompletedPayload) {
    if let Ok(json) = serde_json::to_string_pretty(payload) {
        let _ = std::fs::write(project.join("lare-recording.json"), json);
    }
}
