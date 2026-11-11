//! Extension <-> desktop WebSocket protocol. The TypeScript side is
//! `packages/shared/src/session/protocol.ts`; both are tested against the frames in
//! `packages/shared/fixtures/bridge.json` (`tests/bridge_fixtures.rs` here).

use serde::{Deserialize, Serialize};

use crate::edits::EditEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Difficulty {
    Easy,
    Medium,
    Hard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemInfo {
    pub slug: String,
    pub frontend_id: Option<String>,
    pub title: String,
    pub difficulty: Option<Difficulty>,
    pub url: String,
    pub language: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionInfo {
    pub leetcode_submission_id: Option<u64>,
    pub submitted_at: u64,
    pub lang: Option<String>,
    pub status_display: Option<String>,
    pub status_code: Option<i32>,
    pub accepted: bool,
    pub runtime_ms: Option<f64>,
    pub runtime_percentile: Option<f64>,
    pub memory_mb: Option<f64>,
    pub memory_percentile: Option<f64>,
    pub total_correct: Option<i64>,
    pub total_testcases: Option<i64>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Practice,
    Interview,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionScope {
    Session,
    Problem,
}

fn default_true() -> bool {
    true
}

/// Messages sent by the extension to the desktop app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ExtToApp {
    #[serde(rename = "hello")]
    Hello {
        protocol: u32,
        #[serde(rename = "extVersion")]
        ext_version: String,
        #[serde(rename = "userId")]
        user_id: Option<String>,
        /// 32 random bytes (hex) the app's `auth.challenge` proof covers. Absent before v4.
        #[serde(default)]
        nonce: Option<String>,
    },
    /// The extension's half of the pairing handshake, answering `auth.challenge`.
    #[serde(rename = "auth.response")]
    AuthResponse { proof: String },
    #[serde(rename = "session.start", rename_all = "camelCase")]
    SessionStart {
        session_id: String,
        kind: SessionKind,
        scope: SessionScope,
        started_at: u64,
        problem: Option<ProblemInfo>,
        #[serde(default)]
        facecam: bool,
        #[serde(default = "default_true")]
        mic: bool,
    },
    #[serde(rename = "session.pause", rename_all = "camelCase")]
    SessionPause { session_id: String, at: u64 },
    #[serde(rename = "session.resume", rename_all = "camelCase")]
    SessionResume { session_id: String, at: u64 },
    #[serde(rename = "session.end", rename_all = "camelCase")]
    SessionEnd { session_id: String, at: u64 },
    /// The interview was discarded: stop the recording and throw it away.
    #[serde(rename = "session.cancel", rename_all = "camelCase")]
    SessionCancel { session_id: String, at: u64 },
    #[serde(rename = "problem.open", rename_all = "camelCase")]
    ProblemOpen {
        session_id: String,
        session_problem_id: String,
        at: u64,
        problem: ProblemInfo,
    },
    #[serde(rename = "edits.batch", rename_all = "camelCase")]
    EditsBatch {
        session_id: String,
        session_problem_id: String,
        slug: String,
        events: Vec<EditEvent>,
    },
    #[serde(rename = "submission", rename_all = "camelCase")]
    Submission {
        session_id: String,
        session_problem_id: String,
        submission: SubmissionInfo,
    },
    #[serde(rename = "ping")]
    Ping { at: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordingState {
    Idle,
    Starting,
    Recording,
    Paused,
    Stopping,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotSignedIn,
    UserMismatch,
    PermissionDenied,
    AlreadyRecording,
    RecordingFailed,
    BadMessage,
    UnsupportedProtocol,
    /// The extension's `auth.response` did not prove it holds the pairing secret.
    AuthFailed,
}

/// What the recorder is doing, as of the last `recording.state` it sent. Sent in `hello.ack` so an
/// extension that reconnects mid-interview can catch up on frames it missed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSnapshot {
    /// `None` for a demo recording started from the app.
    pub session_id: Option<String>,
    pub state: RecordingState,
    pub started_at: Option<u64>,
}

/// Messages sent by the desktop app to the extension.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AppToExt {
    #[serde(rename = "hello.ack", rename_all = "camelCase")]
    HelloAck {
        /// The protocol both sides will speak: the lower of the two versions.
        protocol: u32,
        app_version: String,
        user_id: Option<String>,
        recording_capable: bool,
        /// `None` when nothing is recording. Absent from apps older than protocol 3.
        #[serde(default)]
        recording: Option<RecordingSnapshot>,
    },
    #[serde(rename = "recording.state", rename_all = "camelCase")]
    RecordingState {
        session_id: Option<String>,
        state: RecordingState,
        started_at: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    /// The app's half of the pairing handshake: `proof` covers the extension's nonce, and the
    /// extension answers with one covering `nonce`. `install_id` names the secret to look up.
    #[serde(rename = "auth.challenge", rename_all = "camelCase")]
    AuthChallenge {
        install_id: String,
        nonce: String,
        proof: String,
    },
    #[serde(rename = "error")]
    Error { code: ErrorCode, message: String },
    #[serde(rename = "pong")]
    Pong { at: u64 },
}
