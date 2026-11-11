//! `GET /`: the WebSocket the Chrome extension talks over. Which origins may open it, the `hello`
//! and pairing handshake, and the dispatch of session frames to the recorder.

use std::time::Duration;

use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use lare_core::{
    MIN_EXT_PROTOCOL_VERSION, PROTOCOL_VERSION,
    protocol::{AppToExt, ErrorCode, ExtToApp, RecordingState, SessionKind},
};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use super::ServerContext;
use super::pairing::authenticate;
use crate::recording::{RECORDING_UNAVAILABLE_MESSAGE, RecordingRequest};

/// What an extension's `Origin` header starts with; the rest is its id.
pub(super) const EXTENSION_SCHEME: &str = "chrome-extension://";
/// Chrome extension id (pinned by the `key` in `apps/extension/wxt.config.ts`). Every build but the
/// Chrome Web Store package carries that key.
pub const EXTENSION_ID: &str = "koplffaeeahehnfikinmldhhmmldghhl";
/// Id the Chrome Web Store assigned to the published extension. The store package is built without
/// the pinned `key` (`pnpm zip:store`), so the store gives it a different id, and without this a
/// store install could never reach the app. The `LARE_STORE_EXTENSION_ID` build-time environment
/// variable overrides it (for a build that targets a different listing).
pub const STORE_EXTENSION_ID: &str = match option_env!("LARE_STORE_EXTENSION_ID") {
    Some(id) => id,
    None => "anlejcjfgabfkgbhbcbojlmccagbfdhg",
};

/// How long a new client gets to say `hello`.
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);

/// Largest frame accepted from the extension, in bytes.
const MAX_MESSAGE_BYTES: usize = 16000 * 4 * 30;

/// Start of the `unsupported_protocol` refusal, followed by the app's protocol number. Shipped
/// extensions read that number out of the message with `/speaks protocol v(\d+)/` to tell "update
/// the app" from "update the extension" (`apps/extension/src/ws.ts`), so the wording is frozen.
const SPEAKS_PROTOCOL_PREFIX: &str = "desktop app speaks protocol v";

/// The extension ids whose origin may open the WebSocket in a release build: the pinned id and
/// the Chrome Web Store one.
pub(super) fn default_extension_ids() -> Vec<String> {
    // An empty override (`LARE_STORE_EXTENSION_ID=`) means "no store listing".
    [EXTENSION_ID, STORE_EXTENSION_ID]
        .into_iter()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect()
}

fn origin_allowed(ctx: &ServerContext, headers: &HeaderMap) -> bool {
    match headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        None => ctx.allow_any_extension_origin,
        Some(origin) => {
            let id = origin
                .strip_prefix(EXTENSION_SCHEME)
                .map(|rest| rest.trim_end_matches('/'));
            match id {
                Some(id) => {
                    ctx.allow_any_extension_origin
                        || ctx.extension_ids.iter().any(|allowed| allowed == id)
                }
                None => false,
            }
        }
    }
}

pub(super) async fn ws_upgrade(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !origin_allowed(&ctx, &headers) {
        let origin = headers
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("<none>");
        warn!(origin, "rejected websocket upgrade from disallowed origin");
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    ws.max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, ctx))
}

fn error_frame(code: ErrorCode, message: impl Into<String>) -> AppToExt {
    AppToExt::Error {
        code,
        message: message.into(),
    }
}

pub(super) async fn send_frame(socket: &mut WebSocket, msg: &AppToExt) -> Result<(), axum::Error> {
    let text = serde_json::to_string(msg).map_err(axum::Error::new)?;
    socket.send(Message::Text(text.into())).await
}

/// The next text frame, or `None` once the client has gone quiet for `limit`, hung up, or sent a
/// binary frame (which it is told about).
pub(super) async fn recv_text(socket: &mut WebSocket, limit: Duration) -> Option<String> {
    let deadline = tokio::time::Instant::now() + limit;
    loop {
        match tokio::time::timeout_at(deadline, socket.recv()).await {
            Ok(Some(Ok(Message::Text(text)))) => return Some(text.as_str().to_owned()),
            Ok(Some(Ok(Message::Ping(_) | Message::Pong(_)))) => continue,
            Ok(Some(Ok(Message::Binary(_)))) => {
                refuse(socket, ErrorCode::BadMessage, "expected a text frame").await;
                return None;
            }
            Ok(Some(Ok(Message::Close(_))) | Some(Err(_)) | None) | Err(_) => return None,
        }
    }
}

/// Tell a client that has not finished the handshake why it is being dropped.
pub(super) async fn refuse(socket: &mut WebSocket, code: ErrorCode, message: &str) {
    let _ = send_frame(socket, &error_frame(code, message)).await;
}

/// Handshake, then pump frames until the client goes away.
async fn handle_socket(mut socket: WebSocket, ctx: ServerContext) {
    let Some(first) = recv_text(&mut socket, HELLO_TIMEOUT).await else {
        return;
    };

    let hello = serde_json::from_str::<ExtToApp>(first.as_str());
    let (protocol, ext_version, ext_user, ext_nonce) = match hello {
        Ok(ExtToApp::Hello {
            protocol,
            ext_version,
            user_id,
            nonce,
        }) => (protocol, ext_version, user_id, nonce),
        Ok(_) => {
            refuse(
                &mut socket,
                ErrorCode::BadMessage,
                "first message must be hello",
            )
            .await;
            return;
        }
        Err(err) => {
            refuse(
                &mut socket,
                ErrorCode::BadMessage,
                &format!("invalid hello: {err}"),
            )
            .await;
            return;
        }
    };

    // Newer extensions are accepted: the ack carries the lower version and the extension decides
    // whether this app is new enough. Only an extension older than anything still served (which
    // includes every one that cannot pair) is turned away.
    if protocol < MIN_EXT_PROTOCOL_VERSION {
        warn!(protocol, "extension uses an unsupported protocol version");
        refuse(
            &mut socket,
            ErrorCode::UnsupportedProtocol,
            &format!(
                "{SPEAKS_PROTOCOL_PREFIX}{PROTOCOL_VERSION}, extension sent v{protocol}. Update the Lare extension."
            ),
        )
        .await;
        return;
    }

    if authenticate(&mut socket, &ctx, ext_user, ext_nonce)
        .await
        .is_none()
    {
        return;
    }
    let ack = ctx.hello_ack(protocol);
    if send_frame(&mut socket, &ack).await.is_err() {
        return;
    }
    info!(ext_version, protocol, "extension connected");

    // Only now is the client registered with the hub. The socket is split: a writer task drains
    // the per-client channel, the loop below reads frames.
    let (tx, mut rx) = mpsc::unbounded_channel::<AppToExt>();
    let client_id = ctx.hub.register(tx.clone());
    let (mut sink, mut stream) = socket.split();
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let text = match serde_json::to_string(&msg) {
                Ok(t) => t,
                Err(err) => {
                    error!(%err, "failed to serialise frame");
                    continue;
                }
            };
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    while let Some(frame) = stream.next().await {
        match frame {
            Ok(Message::Text(text)) => handle_frame(&ctx, &tx, text.as_str()),
            Ok(Message::Binary(_)) => {
                let _ = tx.send(error_frame(
                    ErrorCode::BadMessage,
                    "binary frames are not supported",
                ));
            }
            Ok(Message::Ping(_) | Message::Pong(_)) => {}
            Ok(Message::Close(_)) => break,
            Err(err) => {
                debug!(%err, "websocket read error");
                break;
            }
        }
    }

    info!("extension disconnected");
    ctx.hub.unregister(client_id);
    drop(tx);
    let _ = tokio::time::timeout(Duration::from_secs(2), writer).await;
}

/// Handle one post-handshake frame from the extension.
fn handle_frame(ctx: &ServerContext, tx: &mpsc::UnboundedSender<AppToExt>, raw: &str) {
    // Parsed in two steps so the extension can tell broken JSON from a frame this app does not
    // know.
    let value: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(err) => {
            let _ = tx.send(error_frame(
                ErrorCode::BadMessage,
                format!("invalid JSON: {err}"),
            ));
            return;
        }
    };
    let msg: ExtToApp = match serde_json::from_value(value) {
        Ok(m) => m,
        Err(err) => {
            let _ = tx.send(error_frame(
                ErrorCode::BadMessage,
                format!("unknown or malformed message: {err}"),
            ));
            return;
        }
    };

    match msg {
        ExtToApp::Ping { at } => {
            let _ = tx.send(AppToExt::Pong { at });
        }
        ExtToApp::Hello { protocol, .. } => {
            // A repeated hello is harmless: answer it again so the client can re-sync.
            let _ = tx.send(ctx.hello_ack(protocol.max(MIN_EXT_PROTOCOL_VERSION)));
        }
        ExtToApp::SessionStart {
            session_id,
            kind: SessionKind::Interview,
            started_at,
            facecam,
            mic,
            ..
        } => match ctx.recording_backend() {
            Some(backend) => backend.start(RecordingRequest {
                session_id,
                started_at,
                facecam,
                mic,
            }),
            None => {
                let _ = tx.send(AppToExt::RecordingState {
                    session_id: Some(session_id),
                    state: RecordingState::Error,
                    started_at: None,
                    message: Some(RECORDING_UNAVAILABLE_MESSAGE.to_string()),
                });
            }
        },
        ExtToApp::SessionPause { session_id, at } => {
            if let Some(backend) = ctx.recording_backend() {
                backend.pause(&session_id, at);
            }
        }
        ExtToApp::SessionResume { session_id, at } => {
            if let Some(backend) = ctx.recording_backend() {
                backend.resume(&session_id, at);
            }
        }
        ExtToApp::SessionEnd { session_id, at } => {
            if let Some(backend) = ctx.recording_backend() {
                backend.stop(&session_id, at);
            }
        }
        ExtToApp::SessionCancel { session_id, at } => {
            if let Some(backend) = ctx.recording_backend() {
                backend.cancel(&session_id, at);
            }
        }
        // Valid frames the app has nothing to do for: practice sessions, and the problem, edit and
        // submission frames. An `auth.response` after the handshake answers nothing.
        ExtToApp::SessionStart { .. }
        | ExtToApp::ProblemOpen { .. }
        | ExtToApp::EditsBatch { .. }
        | ExtToApp::Submission { .. }
        | ExtToApp::AuthResponse { .. } => {}
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use futures_util::SinkExt;
    use lare_core::protocol::RecordingSnapshot;
    use serde_json::json;
    use tokio_tungstenite::tungstenite;

    use super::super::hub::ServerEvent;
    use super::super::test_support::*;
    use super::*;

    fn assert_forbidden(err: tungstenite::Error) {
        match err {
            tungstenite::Error::Http(response) => assert_eq!(response.status().as_u16(), 403),
            other => panic!("expected an HTTP 403, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn handshake_without_origin_in_debug_returns_hello_ack() {
        let mut server = start(true).await;
        let (_client, ack) = handshake(server.addr).await;
        assert_eq!(ack["type"], "hello.ack");
        assert_eq!(ack["protocol"], PROTOCOL_VERSION);
        assert_eq!(ack["appVersion"], "0.0.0-test");
        assert_eq!(ack["userId"], TEST_USER);
        assert_eq!(ack["recordingCapable"], false);
        assert_eq!(ack["recording"], serde_json::Value::Null);
        assert_eq!(
            next_event(&mut server.events).await,
            ServerEvent::ExtConnected(true)
        );
        assert_eq!(server.ctx.hub.client_count(), 1);
    }

    #[tokio::test]
    async fn pinned_extension_origin_is_accepted_even_in_release_mode() {
        let server = start(false).await;
        let mut client = connect(server.addr, Some(&extension_origin()))
            .await
            .unwrap();
        assert_eq!(
            pair(&mut client, PROTOCOL_VERSION).await["type"],
            "hello.ack"
        );
    }

    #[tokio::test]
    async fn store_extension_origin_is_accepted_and_others_rejected_in_release_mode() {
        let server = start_with(false, &["storeextensionidstoreextensionid"]).await;
        let mut client = connect(
            server.addr,
            Some("chrome-extension://storeextensionidstoreextensionid"),
        )
        .await
        .unwrap();
        assert_eq!(
            pair(&mut client, PROTOCOL_VERSION).await["type"],
            "hello.ack"
        );

        let err = connect(
            server.addr,
            Some("chrome-extension://someotherextensionidxxxxxxxxxxx"),
        )
        .await
        .expect_err("upgrade should fail");
        assert_forbidden(err);
    }

    #[tokio::test]
    async fn evil_origin_is_rejected_with_403() {
        let server = start(true).await;
        let err = connect(server.addr, Some("https://evil.example"))
            .await
            .expect_err("upgrade should fail");
        assert_forbidden(err);
    }

    #[tokio::test]
    async fn missing_origin_is_rejected_in_release_mode() {
        let server = start(false).await;
        let err = connect(server.addr, None)
            .await
            .expect_err("upgrade should fail");
        assert_forbidden(err);
    }

    #[tokio::test]
    async fn ping_gets_pong() {
        let server = start(true).await;
        let (mut client, _ack) = handshake(server.addr).await;
        send_json(
            &mut client,
            json!({ "type": "ping", "at": 1700000000123u64 }),
        )
        .await;
        let pong = recv_json(&mut client).await;
        assert_eq!(pong, json!({ "type": "pong", "at": 1700000000123u64 }));
    }

    #[tokio::test]
    async fn interview_session_start_without_recorder_reports_recording_error() {
        let server = start(true).await;
        let (mut client, _ack) = handshake(server.addr).await;

        send_json(
            &mut client,
            json!({
                "type": "session.start",
                "sessionId": "s1",
                "kind": "interview",
                "scope": "problem",
                "startedAt": 1700000000000u64,
                "problem": {
                    "slug": "two-sum", "frontendId": "1", "title": "Two Sum",
                    "difficulty": "Easy", "url": "https://leetcode.com/problems/two-sum/", "language": "python3"
                },
                "facecam": true,
                "mic": true
            }),
        )
        .await;

        let state = recv_json(&mut client).await;
        assert_eq!(state["type"], "recording.state");
        assert_eq!(state["sessionId"], "s1");
        assert_eq!(state["state"], "error");
        assert_eq!(state["startedAt"], serde_json::Value::Null);
        assert_eq!(state["message"], RECORDING_UNAVAILABLE_MESSAGE);
    }

    #[tokio::test]
    async fn hello_ack_carries_the_recording_in_progress() {
        let server = start(true).await;
        let recorder = Arc::new(FakeRecorder::default());
        *recorder.snapshot.lock().unwrap() = Some(RecordingSnapshot {
            session_id: Some("s7".into()),
            state: RecordingState::Paused,
            started_at: Some(42),
        });
        server.ctx.set_recording_backend(Some(recorder.clone()));
        let (_client, ack) = handshake(server.addr).await;
        assert_eq!(
            ack["recording"],
            json!({ "sessionId": "s7", "state": "paused", "startedAt": 42u64 })
        );
    }

    #[tokio::test]
    async fn interview_session_start_and_end_reach_the_registered_recorder() {
        let server = start(true).await;
        let recorder = Arc::new(FakeRecorder::default());
        server.ctx.set_recording_backend(Some(recorder.clone()));
        let (mut client, ack) = handshake(server.addr).await;
        assert_eq!(ack["recordingCapable"], true);

        send_json(
            &mut client,
            json!({ "type": "session.start", "sessionId": "s9", "kind": "interview", "scope": "problem",
                    "startedAt": 42u64, "problem": null, "facecam": true, "mic": true }),
        )
        .await;
        send_json(
            &mut client,
            json!({ "type": "session.end", "sessionId": "s9", "at": 50u64 }),
        )
        .await;
        handled(&mut client).await;

        assert_eq!(
            *recorder.started.lock().unwrap(),
            vec![RecordingRequest {
                session_id: "s9".into(),
                started_at: 42,
                facecam: true,
                mic: true
            }]
        );
        assert_eq!(*recorder.stopped.lock().unwrap(), vec!["s9".to_string()]);
        assert!(recorder.cancelled.lock().unwrap().is_empty());

        send_json(
            &mut client,
            json!({ "type": "session.cancel", "sessionId": "s9", "at": 60u64 }),
        )
        .await;
        handled(&mut client).await;
        assert_eq!(*recorder.cancelled.lock().unwrap(), vec!["s9".to_string()]);
    }

    #[tokio::test]
    async fn practice_session_start_gets_no_reply_and_starts_no_recording() {
        let server = start(true).await;
        let recorder = Arc::new(FakeRecorder::default());
        server.ctx.set_recording_backend(Some(recorder.clone()));
        let (mut client, _ack) = handshake(server.addr).await;
        send_json(
            &mut client,
            json!({ "type": "session.start", "sessionId": "s2", "kind": "practice", "scope": "session",
                    "startedAt": 1u64, "problem": null }),
        )
        .await;
        // The next frame back is the pong: nothing was sent for the practice session start.
        handled(&mut client).await;
        assert!(recorder.started.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn unparseable_frames_get_bad_message_errors() {
        let server = start(true).await;
        let (mut client, _ack) = handshake(server.addr).await;
        client
            .send(tungstenite::Message::text("not json"))
            .await
            .unwrap();
        let err = recv_json(&mut client).await;
        assert_eq!(err["type"], "error");
        assert_eq!(err["code"], "bad_message");

        send_json(&mut client, json!({ "type": "nope" })).await;
        let err = recv_json(&mut client).await;
        assert_eq!(err["code"], "bad_message");

        // Connection is still alive afterwards.
        handled(&mut client).await;
    }

    #[tokio::test]
    async fn ack_carries_the_lower_protocol_version() {
        let server = start(true).await;
        for (sent, expected) in [
            (MIN_EXT_PROTOCOL_VERSION, MIN_EXT_PROTOCOL_VERSION),
            (PROTOCOL_VERSION, PROTOCOL_VERSION),
            (PROTOCOL_VERSION + 5, PROTOCOL_VERSION),
        ] {
            let mut client = connect(server.addr, None).await.unwrap();
            let ack = pair(&mut client, sent).await;
            assert_eq!(ack["type"], "hello.ack");
            assert_eq!(ack["protocol"], expected);
        }
    }

    #[tokio::test]
    async fn protocol_mismatch_is_rejected_and_closed() {
        let server = start(true).await;
        // What a v3 extension sends: no nonce, so it could never pair. It is told to update, in
        // the words it already reads as "the extension is the one out of date".
        let mut client = connect(server.addr, None).await.unwrap();
        send_json(
            &mut client,
            json!({ "type": "hello", "protocol": MIN_EXT_PROTOCOL_VERSION - 1, "extVersion": "0.0.1", "userId": TEST_USER }),
        )
        .await;
        let err = recv_json(&mut client).await;
        assert_eq!(err["type"], "error");
        assert_eq!(err["code"], "unsupported_protocol");
        assert!(
            err["message"]
                .as_str()
                .unwrap()
                .starts_with(&format!("desktop app speaks protocol v{PROTOCOL_VERSION}"))
        );
        assert_closed(&mut client).await;
        assert_eq!(server.ctx.hub.client_count(), 0);
    }

    #[tokio::test]
    async fn first_frame_must_be_hello() {
        let server = start(true).await;
        let mut client = connect(server.addr, None).await.unwrap();
        send_json(&mut client, json!({ "type": "ping", "at": 1 })).await;
        let err = recv_json(&mut client).await;
        assert_eq!(err["code"], "bad_message");
        assert_eq!(server.ctx.hub.client_count(), 0);
    }

    #[tokio::test]
    async fn broadcast_reaches_every_client() {
        let server = start(true).await;
        let (mut a, _) = handshake(server.addr).await;
        let (mut b, _) = handshake(server.addr).await;
        assert_eq!(server.ctx.hub.client_count(), 2);

        let sent = server.ctx.hub.broadcast(AppToExt::RecordingState {
            session_id: Some("s1".into()),
            state: RecordingState::Recording,
            started_at: Some(42),
            message: None,
        });
        assert_eq!(sent, 2);

        let frame = json!({ "type": "recording.state", "sessionId": "s1", "state": "recording", "startedAt": 42u64 });
        assert_eq!(recv_json(&mut a).await, frame);
        assert_eq!(recv_json(&mut b).await, frame);
    }
}
