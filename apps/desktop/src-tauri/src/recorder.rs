//! The real recorder: wires `lare-recording` (Cap's capture stack) into the app.
//!
//! Two entry points share one [`Recorder`]:
//! * the extension-driven mock interview flow (via [`RecordingBackend`]), and
//! * demo recordings started from the draft editor (via Tauri commands in `commands.rs`).
//!
//! State changes are broadcast to the extension (`recording.state` frames) and to the webview
//! (`recording:state` / `recording:completed` events).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use futures::FutureExt;
use lare_core::protocol::{AppToExt, RecordingSnapshot, RecordingState};
use lare_recording::{Feeds, StartRequest};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::{Mutex, OnceCell};
use tracing::{error, info, warn};

use crate::events;
use crate::local_server::WsHub;
use crate::project::{self, CompletedPayload, Purpose, RecordingMode, StartedManifest};
use crate::recording::{RecordingBackend, RecordingRequest};
use crate::sync::{lock, read, write};
use crate::upload::{self, UploadMarker};

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
    /// Longest-edge cap of the output. `None` = 1920.
    pub max_output_size: Option<u32>,
    /// Accelerator that hides and shows the recorder pill while recording. `None` = the platform
    /// default (`windows::DEFAULT_PILL_SHORTCUT`); `Some("")` = no shortcut.
    #[serde(default)]
    pub pill_shortcut: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoStart {
    /// Always `instant`. Still required, so a request the webview sends today is judged exactly
    /// as it was.
    pub mode: RecordingMode,
    pub post_id: Option<String>,
    #[serde(default)]
    pub facecam: bool,
    #[serde(default = "default_true")]
    pub mic: bool,
}

/// Deferred TUS object created before capture begins (`prepare_bunny_upload`).
#[derive(Debug, Clone)]
pub struct LiveUploadTarget {
    pub tus: lare_bunny::TusCredentials,
    pub upload_url: String,
}

struct LiveUpload {
    target: LiveUploadTarget,
    task: futures::future::Shared<futures::future::BoxFuture<'static, Result<String, String>>>,
    abort: tokio::task::AbortHandle,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone)]
pub struct StartSpec {
    pub purpose: Purpose,
    /// Interview session id (extension-driven recordings).
    pub session_id: Option<String>,
    /// Draft post the demo video belongs to.
    pub post_id: Option<String>,
    pub facecam: bool,
    pub mic: bool,
    pub upload: Option<LiveUploadTarget>,
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

/// A start that is still coming up.
struct Starting {
    /// The interview session it is for (`None` for a demo).
    session_id: Option<String>,
}

/// How the last recording ended. Kept so a second `stop`/`cancel` gets the same answer instead
/// of "No active recording": the pill's stop button and the extension's `session.end` frame race
/// on every interview that is ended from the browser.
enum Finish {
    Completed(Box<CompletedPayload>),
    /// The interview session the discarded recording belonged to (`None` for a demo).
    Cancelled(Option<String>),
}

impl Finish {
    fn session_id(&self) -> Option<&str> {
        match self {
            Finish::Completed(p) => p.session_id.as_deref(),
            Finish::Cancelled(sid) => sid.as_deref(),
        }
    }
}

/// How the extension finished an interview session (`session.end` or `session.cancel`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionFinish {
    Stop,
    Cancel,
}

/// Whether a change to the current recording is sent to the extension as `recording.state`
/// frames. Decided where the change is asked for:
///
/// * A recording coming up is announced only when it belongs to an interview session.
/// * Pause, resume, stop and cancel are always announced, whoever asked: the pill drives mock
///   interviews too, and the extension keeps the interview timer it owns in step (or closes the
///   session). A demo has no session id, and the extension ignores a frame that is not about its
///   own session.
/// * The stop on the way out of the process ([`Recorder::shutdown`]) is not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Announce {
    ToExtension,
    Silently,
}

/// Interview sessions remembered in [`Recorder::early_finishes`]; old entries fall off the end.
const EARLY_FINISH_LIMIT: usize = 16;

/// Sent to the extension when a `session.*` frame names a session that is not being recorded.
const NOT_THIS_SESSION: &str = "The desktop app is not recording this interview.";

/// Sent to the extension when an interview starts while another recording is running.
const ALREADY_RECORDING: &str =
    "The desktop app is already recording. Stop that recording, then start the interview again.";

/// Whether `active` is the recording a frame for `expected` may act on. `None` comes from the app
/// itself (the pill, the draft editor), which always means whatever is recording.
fn session_matches(active: &Active, expected: Option<&str>) -> bool {
    expected.is_none_or(|sid| active.session_id.as_deref() == Some(sid))
}

pub struct Recorder {
    app: AppHandle,
    hub: WsHub,
    feeds: OnceCell<Feeds>,
    active: Mutex<Option<Active>>,
    /// The start in progress, if any. A std lock: never held across an await, and read from sync
    /// code. Taken after `active` wherever both are needed.
    starting: std::sync::Mutex<Option<Starting>>,
    /// Held for the whole of `stop`/`cancel` so the two never interleave.
    finishing: Mutex<()>,
    last_finish: Mutex<Option<Finish>>,
    settings: RwLock<RecorderSettings>,
    data_dir: PathBuf,
    recordings_dir: PathBuf,
    live_uploads: Mutex<std::collections::HashMap<PathBuf, LiveUpload>>,
    prepared_upload: Mutex<Option<LiveUploadTarget>>,
    /// Interview sessions the extension ended or discarded before their recording existed (the
    /// start was still coming up, or its frame had not been handled yet). A start that lands
    /// afterwards is finished the same way instead of recording, and uploading, with no session.
    early_finishes: std::sync::Mutex<VecDeque<(String, SessionFinish)>>,
    /// The last state broadcast for the current recording, for `hello.ack.recording`.
    ext_state: std::sync::Mutex<Option<RecordingSnapshot>>,
}

impl Recorder {
    /// `data_dir` is the app's data directory; recordings, models and the recorder settings live
    /// under it. `hub` reaches the extension.
    pub fn new(app: AppHandle, hub: WsHub, data_dir: &Path) -> Arc<Self> {
        Arc::new(Self {
            app,
            hub,
            feeds: OnceCell::new(),
            active: Mutex::new(None),
            starting: std::sync::Mutex::new(None),
            finishing: Mutex::new(()),
            last_finish: Mutex::new(None),
            settings: RwLock::new(load_settings(data_dir)),
            data_dir: data_dir.to_path_buf(),
            recordings_dir: data_dir.join("recordings"),
            live_uploads: Mutex::new(std::collections::HashMap::new()),
            prepared_upload: Mutex::new(None),
            early_finishes: std::sync::Mutex::new(VecDeque::new()),
            ext_state: std::sync::Mutex::new(None),
        })
    }

    pub fn recordings_dir(&self) -> &Path {
        &self.recordings_dir
    }

    pub async fn prepare_upload(&self, tus: lare_bunny::TusCredentials) -> Result<String, String> {
        // The desktop prepares immediately before demo start. Consume this once, even
        // when starting fails, so it cannot leak to a later take.
        let mut pending = self.prepared_upload.lock().await;
        *pending = None;
        let upload_url = lare_bunny::create_deferred_upload(&lare_bunny::http_client(), &tus)
            .await
            .map_err(|e| e.to_string())?;
        *pending = Some(LiveUploadTarget {
            tus,
            upload_url: upload_url.clone(),
        });
        Ok(upload_url)
    }

    pub async fn take_prepared_upload(&self) -> Option<LiveUploadTarget> {
        self.prepared_upload.lock().await.take()
    }

    /// Join the original tailer rather than starting a second PATCH writer at stop.
    pub async fn join_live_upload(
        &self,
        path: &Path,
        tus: &lare_bunny::TusCredentials,
        url: Option<&str>,
    ) -> Result<Option<String>, String> {
        let (task, matches) = {
            let uploads = self.live_uploads.lock().await;
            let Some(upload) = uploads.get(path) else {
                return Ok(None);
            };
            (
                upload.task.clone(),
                upload.target.tus.headers == tus.headers
                    && url.is_none_or(|url| url == upload.target.upload_url),
            )
        };
        // Never hold the registry lock while waiting for stop: cancellation must
        // be able to abort this writer even if an upload command arrived early.
        let result = task.await;
        self.live_uploads.lock().await.remove(path);
        if !matches {
            return Ok(None);
        }
        result.map(Some)
    }

    async fn abort_live_upload(&self, path: Option<PathBuf>) {
        if let Some(path) = path {
            if let Some(upload) = self.live_uploads.lock().await.remove(&path) {
                upload.abort.abort();
                let _ = upload.task.await;
            }
        }
    }

    pub fn models_dir(&self) -> PathBuf {
        self.data_dir.join("models")
    }

    pub fn settings(&self) -> RecorderSettings {
        read(&self.settings).clone()
    }

    pub fn set_settings(&self, settings: RecorderSettings) {
        *write(&self.settings) = settings.clone();
        save_settings(&self.data_dir, &settings);
        // A new shortcut takes effect straight away if a recording is already running.
        crate::windows::sync_pill_shortcut(&self.app, settings.pill_shortcut);
    }

    async fn feeds(&self) -> &Feeds {
        self.feeds.get_or_init(|| async { Feeds::spawn() }).await
    }

    pub async fn status(&self) -> StatePayload {
        let active = self.active.lock().await;
        match active.as_ref() {
            None => StatePayload {
                state: if lock(&self.starting).is_some() {
                    RecordingState::Starting
                } else {
                    RecordingState::Idle
                },
                ..StatePayload::idle()
            },
            Some(a) => StatePayload {
                state: if a.paused() {
                    RecordingState::Paused
                } else {
                    RecordingState::Recording
                },
                recording_id: Some(a.recording_id.clone()),
                session_id: a.session_id.clone(),
                purpose: Some(a.purpose),
                mode: Some(RecordingMode::Instant),
                started_at: Some(a.rec.started_at_epoch_ms()),
                project_path: Some(a.rec.project_path().to_path_buf()),
                post_id: a.post_id.clone(),
                message: None,
                recorded_ms: Some(a.recorded_ms()),
            },
        }
    }

    fn emit_state(&self, payload: &StatePayload) {
        events::emit(&self.app, events::RECORDING_STATE, payload);
    }

    /// Report a change to the current recording. Every call is about the recording this
    /// recorder owns, so it also becomes what `hello.ack` reports; answers about some other
    /// session go through [`Recorder::reply_ext`] instead.
    fn broadcast_ext(
        &self,
        announce: Announce,
        session_id: Option<&str>,
        state: RecordingState,
        started_at: Option<u64>,
        message: Option<String>,
    ) {
        // Only live states stick: a finished or failed recording is nothing to catch up on,
        // and a lingering `error` would replay its toast on every reconnect.
        let live = matches!(
            state,
            RecordingState::Starting
                | RecordingState::Recording
                | RecordingState::Paused
                | RecordingState::Stopping
        );
        *lock(&self.ext_state) = live.then(|| RecordingSnapshot {
            session_id: session_id.map(str::to_string),
            state,
            started_at,
        });
        if announce == Announce::ToExtension {
            self.reply_ext(session_id, state, started_at, message);
        }
    }

    /// Send a `recording.state` frame without touching what `hello.ack` reports.
    fn reply_ext(
        &self,
        session_id: Option<&str>,
        state: RecordingState,
        started_at: Option<u64>,
        message: Option<String>,
    ) {
        self.hub.broadcast(AppToExt::RecordingState {
            session_id: session_id.map(str::to_string),
            state,
            started_at,
            message,
        });
    }

    /// What the extension was last told about the current recording.
    pub fn ext_snapshot(&self) -> Option<RecordingSnapshot> {
        lock(&self.ext_state).clone()
    }

    fn is_starting_session(&self, session_id: &str) -> bool {
        lock(&self.starting)
            .as_ref()
            .is_some_and(|s| s.session_id.as_deref() == Some(session_id))
    }

    /// Remember that the extension finished `session_id` before its recording existed. A cancel
    /// overrides an earlier end: the extension only discards a start it has given up on.
    fn note_early_finish(&self, session_id: &str, finish: SessionFinish) {
        let mut early = lock(&self.early_finishes);
        if let Some(entry) = early.iter_mut().find(|(sid, _)| sid == session_id) {
            if finish == SessionFinish::Cancel {
                entry.1 = finish;
            }
            return;
        }
        early.push_back((session_id.to_string(), finish));
        while early.len() > EARLY_FINISH_LIMIT {
            early.pop_front();
        }
    }

    fn take_early_finish(&self, session_id: &str) -> Option<SessionFinish> {
        let mut early = lock(&self.early_finishes);
        let at = early.iter().position(|(sid, _)| sid == session_id)?;
        early.remove(at).map(|(_, finish)| finish)
    }

    /// Answer a `session.pause`/`resume` for a session that is not the one recording. Nothing is
    /// sent while that session is still starting: the start's own frames will answer it, and an
    /// error here would make the extension give up on a start that is about to succeed.
    fn reject_session(&self, expected: Option<&str>) -> String {
        let Some(sid) = expected else {
            return "No active recording".into();
        };
        if !self.is_starting_session(sid) {
            self.reply_ext(
                Some(sid),
                RecordingState::Error,
                None,
                Some(NOT_THIS_SESSION.into()),
            );
        }
        NOT_THIS_SESSION.into()
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
                .or_else(|| {
                    lare_recording::devices::list_microphones()
                        .into_iter()
                        .next()
                })
                .map(|m| m.name),
        }
    }

    pub async fn start(self: &Arc<Self>, spec: StartSpec) -> Result<StatePayload, String> {
        let facecam = spec.facecam;
        let session_id = spec.session_id.clone();
        let announce = if session_id.is_some() {
            Announce::ToExtension
        } else {
            Announce::Silently
        };
        // The extension's `session.end`/`session.cancel` can be handled before this start is: each
        // frame runs on its own task. A session already finished must not start recording now.
        if let Some(finish) = session_id
            .as_deref()
            .and_then(|sid| self.take_early_finish(sid))
        {
            info!(session = ?session_id, ?finish, "interview finished before its recording started; not starting");
            return Err("The interview ended before recording started.".into());
        }
        {
            // Same order as `status`: active, then starting. Taking them the other way round
            // here would let the two deadlock against each other.
            let active = self.active.lock().await;
            let mut starting = lock(&self.starting);
            if starting.is_some() || active.is_some() {
                // Without an answer the extension waits out its whole start timeout. Not
                // `broadcast_ext`: the recording in progress is still what `hello.ack` reports.
                if session_id.is_some() {
                    self.reply_ext(
                        session_id.as_deref(),
                        RecordingState::Error,
                        None,
                        Some(ALREADY_RECORDING.into()),
                    );
                }
                return Err("A recording is already in progress".into());
            }
            *starting = Some(Starting {
                session_id: session_id.clone(),
            });
        }
        *self.last_finish.lock().await = None;
        // There is no camera track: the facecam preview window is captured as part of the
        // screen, so it must be on screen before capture starts.
        let display_id = self.settings().display_id;
        if facecam {
            if let Err(e) = crate::windows::open_camera(&self.app, display_id.as_deref()) {
                warn!(%e, "camera preview window failed to open");
            }
        }
        let result = self.start_inner(&spec, announce).await;
        // `stop`/`cancel` decide between "finish the active recording" and "remember it for the
        // start still coming up" while holding `finishing`, so clearing the start in progress and
        // collecting what they remembered under the same lock leaves no gap for one to fall into.
        let early = {
            let _finishing = self.finishing.lock().await;
            *lock(&self.starting) = None;
            session_id
                .as_deref()
                .and_then(|sid| self.take_early_finish(sid))
        };
        if let (Ok(_), Some(finish), Some(sid)) = (&result, early, session_id.as_deref()) {
            info!(session = %sid, ?finish, "interview finished while its recording was starting");
            match finish {
                SessionFinish::Cancel => {
                    if let Err(e) = self.cancel(Some(sid)).await {
                        warn!(%e, "discarding a recording that started after its interview was cancelled failed");
                    }
                }
                SessionFinish::Stop => {
                    if let Err(e) = self.stop(Some(sid)).await {
                        warn!(%e, "stopping a recording that started after its interview ended failed");
                    }
                }
            }
            return Ok(self.status().await);
        }
        match &result {
            Ok(payload) => {
                // `stop` and `cancel` can run between `start_inner` and here: the extension may
                // end a session the instant it starts one. Announcing "recording" or putting the
                // pill up after that would leave the app showing, and the pill controlling, a
                // recording that's gone. Holding `finishing` keeps them from slipping in between
                // this check and the emit / window opening.
                let _finishing = self.finishing.lock().await;
                let still_active = self.active.lock().await.as_ref().is_some_and(|a| {
                    payload.recording_id.as_deref() == Some(a.recording_id.as_str())
                });
                if still_active {
                    self.emit_state(payload);
                    if let Err(e) = crate::windows::open_recorder(
                        &self.app,
                        display_id.as_deref(),
                        self.settings().pill_shortcut,
                    ) {
                        warn!(%e, "recorder window failed to open");
                    }
                }
            }
            Err(message) => {
                crate::windows::hide_camera(&self.app);
                self.emit_state(&StatePayload {
                    state: RecordingState::Error,
                    session_id: session_id.clone(),
                    message: Some(message.clone()),
                    ..StatePayload::idle()
                });
                self.broadcast_ext(
                    announce,
                    session_id.as_deref(),
                    RecordingState::Error,
                    None,
                    Some(message.clone()),
                );
            }
        }
        result
    }

    async fn start_inner(
        self: &Arc<Self>,
        spec: &StartSpec,
        announce: Announce,
    ) -> Result<StatePayload, String> {
        let StartSpec {
            purpose,
            facecam,
            mic,
            ..
        } = *spec;
        let session_id = spec.session_id.clone();
        let post_id = spec.post_id.clone();
        if !lare_recording::permissions::check().recording_capable() {
            return Err("Screen recording permission is not granted. Enable it in System Settings > Privacy & Security > Screen Recording, then restart Lare.".into());
        }
        self.broadcast_ext(
            announce,
            session_id.as_deref(),
            RecordingState::Starting,
            None,
            None,
        );
        self.emit_state(&StatePayload {
            state: RecordingState::Starting,
            session_id: session_id.clone(),
            purpose: Some(purpose),
            mode: Some(RecordingMode::Instant),
            ..StatePayload::idle()
        });

        let recording_id = project::id::generate(now_ms());
        let dir = self.recordings_dir.join(&recording_id);
        let settings = self.settings();
        let req = StartRequest {
            dir: dir.clone(),
            display_id: settings.display_id.clone(),
            mic_label: self.resolve_mic(mic),
            // The on-screen camera preview window is captured instead of a camera track.
            camera_id: None,
            max_fps: 30,
            max_output_size: Some(settings.max_output_size.unwrap_or(1920)),
            system_audio: false,
        };
        info!(?purpose, dir = %dir.display(), "starting recording");
        let feeds = self.feeds().await;
        let rec = lare_recording::start(req, feeds)
            .await
            .map_err(|e| format!("Could not start recording: {e:#}"))?;
        if let (Some(target), Some((path, completion))) = (spec.upload.clone(), rec.live_output()) {
            let marker = UploadMarker::new(&target.upload_url, &target.tus);
            if let Err(error) = marker.write(&path).await {
                let _ = rec.cancel().await;
                feeds.release_mic().await;
                feeds.release_camera().await;
                return Err(format!("Could not persist live upload: {error}"));
            }
            let upload_path = path.clone();
            let upload_target = target.clone();
            let report = upload::progress_reporter(self.app.clone(), recording_id.clone());
            let task = tokio::spawn(async move {
                let result = lare_bunny::upload_growing_file(
                    &lare_bunny::http_client(),
                    &upload_path,
                    &upload_target.tus,
                    &upload_target.upload_url,
                    lare_bunny::DEFAULT_CHUNK_SIZE,
                    completion,
                    report,
                )
                .await
                .map_err(|e| e.to_string());
                if let Err(message) = &result {
                    warn!(%message, "live upload failed; preserving local source for retry");
                }
                result
            });
            let abort = task.abort_handle();
            let task = async move {
                task.await
                    .map_err(|e| format!("live upload task failed: {e}"))?
            }
            .boxed()
            .shared();
            self.live_uploads.lock().await.insert(
                path,
                LiveUpload {
                    target,
                    task,
                    abort,
                },
            );
        }
        let started_at = rec.started_at_epoch_ms();
        project::write_started(
            rec.project_path(),
            &StartedManifest {
                recording_id: recording_id.clone(),
                session_id: session_id.clone(),
                purpose: Some(purpose),
                mode: Some(RecordingMode::Instant),
                started_at,
                post_id: post_id.clone(),
                facecam,
            },
        );
        let payload = StatePayload {
            state: RecordingState::Recording,
            recording_id: Some(recording_id.clone()),
            session_id: session_id.clone(),
            purpose: Some(purpose),
            mode: Some(RecordingMode::Instant),
            started_at: Some(started_at),
            project_path: Some(rec.project_path().to_path_buf()),
            post_id: post_id.clone(),
            message: None,
            recorded_ms: Some(0),
        };
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
        self.broadcast_ext(
            announce,
            session_id.as_deref(),
            RecordingState::Recording,
            Some(started_at),
            None,
        );
        Ok(payload)
    }

    /// Pause the recording. `session` is the interview a `session.pause` frame names, and then
    /// only that interview's recording is paused; `None` (the pill, the draft editor) means
    /// whatever is recording.
    pub async fn pause(&self, session: Option<&str>) -> Result<StatePayload, String> {
        self.set_paused(session, true).await
    }

    /// Resume the recording; `session` as for [`Recorder::pause`].
    pub async fn resume(&self, session: Option<&str>) -> Result<StatePayload, String> {
        self.set_paused(session, false).await
    }

    async fn set_paused(
        &self,
        expected: Option<&str>,
        pause: bool,
    ) -> Result<StatePayload, String> {
        let mut guard = self.active.lock().await;
        let Some(a) = guard.as_mut().filter(|a| session_matches(a, expected)) else {
            return Err(self.reject_session(expected));
        };
        match (pause, a.paused_at) {
            (true, None) => {
                a.rec
                    .pause()
                    .await
                    .map_err(|e| format!("pause failed: {e:#}"))?;
                a.paused_at = Some(now_ms());
            }
            (false, Some(at)) => {
                a.rec
                    .resume()
                    .await
                    .map_err(|e| format!("resume failed: {e:#}"))?;
                a.paused_at = None;
                a.paused_total_ms += now_ms().saturating_sub(at);
            }
            // Already in the state asked for.
            (true, Some(_)) | (false, None) => {}
        }
        let sid = a.session_id.clone();
        let started = a.rec.started_at_epoch_ms();
        drop(guard);
        let state = if pause {
            RecordingState::Paused
        } else {
            RecordingState::Recording
        };
        self.broadcast_ext(
            Announce::ToExtension,
            sid.as_deref(),
            state,
            Some(started),
            None,
        );
        let p = self.status().await;
        self.emit_state(&p);
        Ok(p)
    }

    /// Stop and keep the recording. Safe to call twice: the loser of the race gets the same
    /// payload the winner produced, not an error.
    ///
    /// `session` is the interview a `session.end` frame names: only that interview's recording
    /// is stopped, and a start for it still coming up is stopped as soon as it lands. `None`
    /// means whatever is recording.
    pub async fn stop(&self, session: Option<&str>) -> Result<CompletedPayload, String> {
        self.stop_announcing(session, Announce::ToExtension).await
    }

    async fn stop_announcing(
        &self,
        expected: Option<&str>,
        announce: Announce,
    ) -> Result<CompletedPayload, String> {
        let _finishing = self.finishing.lock().await;
        let taken = {
            let mut slot = self.active.lock().await;
            if slot.as_ref().is_some_and(|a| session_matches(a, expected)) {
                slot.take()
            } else {
                None
            }
        };
        let Some(active) = taken else {
            if let Some(last) = &*self.last_finish.lock().await {
                if expected.is_none_or(|sid| last.session_id() == Some(sid)) {
                    return match last {
                        Finish::Completed(p) => Ok((**p).clone()),
                        Finish::Cancelled(_) => Err("The recording was discarded.".into()),
                    };
                }
            }
            let Some(sid) = expected else {
                return Err("No active recording".into());
            };
            // Not recording this session (yet): remember it so a start that lands later stops
            // straight away rather than recording on with nobody to end it.
            self.note_early_finish(sid, SessionFinish::Stop);
            if self.is_starting_session(sid) {
                return Err(
                    "The recording is still starting; it stops as soon as it begins.".into(),
                );
            }
            self.reply_ext(
                Some(sid),
                RecordingState::Error,
                None,
                Some(NOT_THIS_SESSION.into()),
            );
            return Err(NOT_THIS_SESSION.into());
        };
        // Hidden, not closed: this call usually comes from a button inside the pill's webview.
        crate::windows::hide_recorder(&self.app);
        crate::windows::hide_camera(&self.app);
        let sid = active.session_id.clone();
        let project_path = active.rec.project_path().to_path_buf();
        let started = active.rec.started_at_epoch_ms();
        let recorded_ms = active.recorded_ms();
        self.broadcast_ext(
            announce,
            sid.as_deref(),
            RecordingState::Stopping,
            Some(started),
            None,
        );
        self.emit_state(&StatePayload {
            state: RecordingState::Stopping,
            recording_id: Some(active.recording_id.clone()),
            session_id: sid.clone(),
            recorded_ms: Some(recorded_ms),
            ..StatePayload::idle()
        });

        let feeds = self.feeds().await;
        let live_path = active.rec.live_output().map(|(path, _)| path);
        let result = active.rec.stop().await;
        if result.is_err() {
            self.abort_live_upload(live_path).await;
        }
        feeds.release_mic().await;
        feeds.release_camera().await;

        // A failed stop is not a lost recording: the fragments Cap already wrote are the whole
        // take bar the final mux, so finish them from disk before giving up.
        let finished = match result {
            Ok(done) => Ok((done.project_path, done.output_mp4, done.ended_at_epoch_ms)),
            Err(e) => {
                warn!(error = %format!("{e:#}"), "stopping the recording failed; salvaging the project");
                match salvage(project_path.clone()).await {
                    // A recording is only salvaged if the mux actually produced the MP4.
                    Ok(output) if output.is_some() => Ok((project_path.clone(), output, now_ms())),
                    Ok(_) => Err(format!(
                        "Stopping the recording failed: {e:#} (there was nothing left on disk to recover)"
                    )),
                    Err(salvage_error) => Err(format!(
                        "Stopping the recording failed: {e:#} (recovering it from disk also failed: {salvage_error})"
                    )),
                }
            }
        };
        let (project_path, output_mp4, ended_at) = match finished {
            Ok(parts) => parts,
            Err(msg) => {
                error!(%msg);
                *self.last_finish.lock().await = None;
                self.broadcast_ext(
                    announce,
                    sid.as_deref(),
                    RecordingState::Error,
                    None,
                    Some(msg.clone()),
                );
                self.emit_state(&StatePayload {
                    state: RecordingState::Error,
                    message: Some(msg.clone()),
                    ..StatePayload::idle()
                });
                return Err(msg);
            }
        };
        let payload = CompletedPayload {
            recording_id: active.recording_id,
            session_id: sid.clone(),
            purpose: active.purpose,
            mode: RecordingMode::Instant,
            project_path: project_path.clone(),
            output_mp4,
            started_at: started,
            ended_at,
            post_id: active.post_id,
            facecam: active.facecam,
            recorded_ms,
        };
        // The manifest goes down before anything that can still fail: from here on the recording
        // exists on disk, and the Recordings page can retry whatever comes next.
        project::write_completed(&project_path, &payload);
        *self.last_finish.lock().await = Some(Finish::Completed(Box::new(payload.clone())));
        events::emit(&self.app, events::RECORDING_COMPLETED, &payload);
        self.broadcast_ext(announce, sid.as_deref(), RecordingState::Idle, None, None);
        self.emit_state(&StatePayload::idle());
        Ok(payload)
    }

    /// Stop and throw the recording away. Idempotent in the same way as [`Recorder::stop`].
    ///
    /// `session` is the interview a `session.cancel` frame names: only that interview's
    /// recording is discarded, and a start for it still coming up is discarded as soon as it
    /// lands. `None` means whatever is recording.
    pub async fn cancel(&self, session: Option<&str>) -> Result<(), String> {
        let _finishing = self.finishing.lock().await;
        let taken = {
            let mut slot = self.active.lock().await;
            if slot.as_ref().is_some_and(|a| session_matches(a, session)) {
                slot.take()
            } else {
                None
            }
        };
        let Some(active) = taken else {
            // Whichever of the two calls arrived first has already finished the recording;
            // there is nothing left to discard either way.
            if let Some(last) = &*self.last_finish.lock().await {
                if session.is_none_or(|sid| last.session_id() == Some(sid)) {
                    return Ok(());
                }
            }
            let Some(sid) = session else {
                return Err("No active recording".into());
            };
            // Not recording this session (yet): a start that lands later is thrown away instead
            // of recording, and uploading, an interview the extension has already discarded.
            self.note_early_finish(sid, SessionFinish::Cancel);
            if !self.is_starting_session(sid) {
                // Nothing recording for it is the answer the extension wants; anything else
                // that is recording carries on untouched.
                self.reply_ext(Some(sid), RecordingState::Idle, None, None);
            }
            return Ok(());
        };
        crate::windows::hide_recorder(&self.app);
        crate::windows::hide_camera(&self.app);
        let sid = active.session_id.clone();
        let path = active.rec.project_path().to_path_buf();
        self.abort_live_upload(active.rec.live_output().map(|(path, _)| path))
            .await;
        let feeds = self.feeds().await;
        let res = active
            .rec
            .cancel()
            .await
            .map_err(|e| format!("cancel failed: {e:#}"));
        feeds.release_mic().await;
        feeds.release_camera().await;
        let _ = std::fs::remove_dir_all(&path);
        *self.last_finish.lock().await = Some(Finish::Cancelled(sid.clone()));
        self.broadcast_ext(
            Announce::ToExtension,
            sid.as_deref(),
            RecordingState::Idle,
            None,
            None,
        );
        self.emit_state(&StatePayload::idle());
        res
    }

    /// Release everything the OS can see Lare holding: the ScreenCaptureKit stream, the camera
    /// and the microphone. Run on every way out of the process (see [`crate::shutdown`]).
    ///
    /// The take is stopped, not discarded — quitting mid-recording keeps the video, which is why
    /// this goes through the same stop as everything else rather than something cheaper. It is
    /// idempotent: `stop` answers a second caller from `last_finish` instead of erroring.
    pub async fn shutdown(&self) {
        if self.active.lock().await.is_some() {
            info!("stopping the recording before the app exits");
            match self.stop_announcing(None, Announce::Silently).await {
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
            // A project with nothing in it is retried once, not on every launch for the rest of
            // the install's life.
            if !dir.is_dir() || project::is_completed(&dir) || project::is_unrecoverable(&dir) {
                continue;
            }
            let Some(started) = project::read_started(&dir) else {
                continue;
            };
            let (Some(_), Some(purpose)) = (started.mode, started.purpose) else {
                warn!(dir = %dir.display(), "start manifest names no mode or purpose; not recovering");
                continue;
            };
            info!(dir = %dir.display(), "finishing a recording left behind by a previous run");
            let output_mp4 = match lare_recording::finalize_project(&dir) {
                Ok(output) => output,
                Err(e) => {
                    let reason = format!("{e:#}");
                    warn!(dir = %dir.display(), error = %reason, "could not recover recording");
                    project::write_unrecoverable(&dir, &reason, now_ms());
                    continue;
                }
            };
            if output_mp4.is_none() {
                warn!(dir = %dir.display(), "nothing recoverable in the project");
                project::write_unrecoverable(
                    &dir,
                    "no display segments were written before the process died",
                    now_ms(),
                );
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
                mode: RecordingMode::Instant,
                project_path: dir.clone(),
                output_mp4,
                started_at: started.started_at,
                ended_at,
                post_id: started.post_id,
                facecam: started.facecam,
                recorded_ms: ended_at.saturating_sub(started.started_at),
            };
            project::write_completed(&dir, &payload);
            recovered += 1;
        }
        recovered
    }

    /// Completed recordings, newest first.
    pub fn list_completed(&self) -> Vec<CompletedPayload> {
        let mut out: Vec<CompletedPayload> = std::fs::read_dir(&self.recordings_dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| project::read_completed(&entry.path()))
            .collect();
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
    fn start(&self, req: RecordingRequest) {
        let recorder = self.recorder.clone();
        tauri::async_runtime::spawn(async move {
            let res = recorder
                .start(StartSpec {
                    purpose: Purpose::Interview,
                    session_id: Some(req.session_id.clone()),
                    post_id: None,
                    facecam: req.facecam,
                    mic: req.mic,
                    upload: None,
                })
                .await;
            if let Err(e) = res {
                error!(session = %req.session_id, %e, "interview recording failed to start");
            }
        });
    }

    // Each frame only acts on the session it names: a stale `session.end` from the extension
    // (say, from a start it gave up on) must never stop a demo or another interview.
    fn pause(&self, session_id: &str, _at: u64) {
        let recorder = self.recorder.clone();
        let session_id = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = recorder.pause(Some(&session_id)).await {
                warn!(session = %session_id, %e, "pause failed");
            }
        });
    }

    fn resume(&self, session_id: &str, _at: u64) {
        let recorder = self.recorder.clone();
        let session_id = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = recorder.resume(Some(&session_id)).await {
                warn!(session = %session_id, %e, "resume failed");
            }
        });
    }

    fn stop(&self, session_id: &str, _at: u64) {
        let recorder = self.recorder.clone();
        let session_id = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = recorder.stop(Some(&session_id)).await {
                warn!(session = %session_id, %e, "stop failed");
            }
        });
    }

    fn cancel(&self, session_id: &str, _at: u64) {
        let recorder = self.recorder.clone();
        let session_id = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = recorder.cancel(Some(&session_id)).await {
                warn!(session = %session_id, %e, "cancel failed");
            }
        });
    }

    fn capable(&self) -> bool {
        lare_recording::permissions::check().recording_capable()
    }

    fn snapshot(&self) -> Option<RecordingSnapshot> {
        self.recorder.ext_snapshot()
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Mux/remux a project from what is on disk, off the async runtime (ffmpeg work, seconds long).
async fn salvage(project_path: PathBuf) -> Result<Option<PathBuf>, String> {
    tokio::task::spawn_blocking(move || lare_recording::finalize_project(&project_path))
        .await
        .map_err(|e| format!("recovery task panicked: {e}"))?
        .map_err(|e| format!("{e:#}"))
}

fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("recorder-settings.json")
}

/// The saved settings, or the defaults when there are none yet or they do not parse.
fn load_settings(data_dir: &Path) -> RecorderSettings {
    let path = settings_path(data_dir);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return RecorderSettings::default();
    };
    serde_json::from_str(&text).unwrap_or_else(|error| {
        warn!(path = %path.display(), %error, "recorder settings do not parse; using the defaults");
        RecorderSettings::default()
    })
}

fn save_settings(data_dir: &Path, settings: &RecorderSettings) {
    let path = settings_path(data_dir);
    let saved = std::fs::create_dir_all(data_dir).and_then(|()| {
        let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
        std::fs::write(&path, json)
    });
    if let Err(error) = saved {
        warn!(path = %path.display(), %error, "could not save the recorder settings");
    }
}
