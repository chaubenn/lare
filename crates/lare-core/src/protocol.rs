//! Extension <-> desktop WebSocket protocol (mirrors packages/shared/src/protocol.ts).

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
    },
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
}

/// Messages sent by the desktop app to the extension.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AppToExt {
    #[serde(rename = "hello.ack", rename_all = "camelCase")]
    HelloAck {
        protocol: u32,
        app_version: String,
        user_id: Option<String>,
        recording_capable: bool,
    },
    #[serde(rename = "recording.state", rename_all = "camelCase")]
    RecordingState {
        session_id: Option<String>,
        state: RecordingState,
        started_at: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    #[serde(rename = "error")]
    Error { code: ErrorCode, message: String },
    #[serde(rename = "pong")]
    Pong { at: u64 },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_start_wire_format_matches_ts() {
        let raw = r#"{"type":"session.start","sessionId":"s1","kind":"interview","scope":"problem","startedAt":1700000000000,"problem":{"slug":"two-sum","frontendId":"1","title":"Two Sum","difficulty":"Easy","url":"https://leetcode.com/problems/two-sum/","language":"python"},"facecam":true,"mic":true}"#;
        let msg: ExtToApp = serde_json::from_str(raw).unwrap();
        match &msg {
            ExtToApp::SessionStart { session_id, kind, facecam, problem, .. } => {
                assert_eq!(session_id, "s1");
                assert_eq!(*kind, SessionKind::Interview);
                assert!(*facecam);
                assert_eq!(problem.as_ref().unwrap().difficulty, Some(Difficulty::Easy));
            }
            other => panic!("unexpected {other:?}"),
        }
        let back = serde_json::to_string(&msg).unwrap();
        assert!(back.contains(r#""type":"session.start""#));
        assert!(back.contains(r#""startedAt":1700000000000"#));
    }

    #[test]
    fn app_messages_serialize_with_camel_case() {
        let m = AppToExt::HelloAck {
            protocol: 1,
            app_version: "0.1.0".into(),
            user_id: None,
            recording_capable: true,
        };
        let s = serde_json::to_string(&m).unwrap();
        assert_eq!(
            s,
            r#"{"type":"hello.ack","protocol":1,"appVersion":"0.1.0","userId":null,"recordingCapable":true}"#
        );
        let e = AppToExt::Error {
            code: ErrorCode::NotSignedIn,
            message: "sign in".into(),
        };
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"type":"error","code":"not_signed_in","message":"sign in"}"#
        );
    }
}
