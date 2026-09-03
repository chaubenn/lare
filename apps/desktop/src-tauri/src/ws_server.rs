//! Local HTTP + WebSocket server on `127.0.0.1:47831`.
//!
//! * `GET /`               WebSocket used by the Chrome extension (protocol in `lare_core::protocol`).
//! * `GET /health`         JSON status probe (`{"app":"lare", ...}`).
//! * `GET /auth/callback`  OAuth loopback redirect; forwards the PKCE `code` to the webview.
//!
//! The server knows nothing about Tauri: it reports what happened through [`ServerEvent`]s on a
//! channel, and `lib.rs` turns those into Tauri events. That keeps the whole thing testable with a
//! plain tokio runtime (see the tests at the bottom).

use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    Router,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use lare_core::{
    AUTH_CALLBACK_PATH, PROTOCOL_VERSION, WS_PORT,
    protocol::{AppToExt, ErrorCode, ExtToApp, RecordingState, SessionKind},
};
use serde::Deserialize;
use serde_json::json;
use tokio::{net::TcpListener, sync::mpsc};
use tracing::{debug, error, info, warn};

use crate::recording::{
    RECORDING_UNAVAILABLE_MESSAGE, RecordingBackend, RecordingRequest, SharedRecordingBackend,
};

/// Chrome extension id (pinned by the `key` in `apps/extension/wxt.config.ts`).
pub const EXTENSION_ID: &str = "koplffaeeahehnfikinmldhhmmldghhl";
/// The only `Origin` accepted for WebSocket upgrades in release builds.
pub const EXTENSION_ORIGIN: &str = "chrome-extension://koplffaeeahehnfikinmldhhmmldghhl";

/// Something the frontend should hear about. Forwarded as Tauri events by `lib.rs`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerEvent {
    /// `GET /auth/callback?code=...` -> Tauri event `auth:callback`.
    AuthCallback { code: String, next: Option<String> },
    /// `GET /auth/callback?error=...` -> Tauri event `auth:error`.
    AuthError { error: String, description: Option<String> },
    /// A parsed frame from the extension -> Tauri event `ext:message` (raw JSON).
    ExtMessage(serde_json::Value),
    /// Connected-client state changed -> Tauri event `ext:connected`.
    ExtConnected(bool),
}

/// Registry of connected extension clients plus the event channel to the app layer.
#[derive(Clone)]
pub struct WsHub {
    inner: Arc<HubInner>,
}

struct HubInner {
    clients: Mutex<HashMap<u64, mpsc::UnboundedSender<AppToExt>>>,
    next_id: AtomicU64,
    events: mpsc::UnboundedSender<ServerEvent>,
}

impl WsHub {
    /// Create a hub and the receiving end of its event channel.
    pub fn new() -> (Self, mpsc::UnboundedReceiver<ServerEvent>) {
        let (events, rx) = mpsc::unbounded_channel();
        let hub = Self {
            inner: Arc::new(HubInner {
                clients: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                events,
            }),
        };
        (hub, rx)
    }

    /// Number of extension clients that completed the `hello` handshake.
    pub fn client_count(&self) -> usize {
        self.inner.clients.lock().map(|c| c.len()).unwrap_or(0)
    }

    pub fn connected(&self) -> bool {
        self.client_count() > 0
    }

    /// Send a frame to every connected client. Returns how many clients it was queued for.
    pub fn broadcast(&self, msg: AppToExt) -> usize {
        let Ok(mut clients) = self.inner.clients.lock() else {
            return 0;
        };
        // Drop clients whose writer task is gone.
        clients.retain(|_, tx| tx.send(msg.clone()).is_ok());
        clients.len()
    }

    /// Raise an event for the app layer (ignored if nobody is listening).
    pub fn emit(&self, event: ServerEvent) {
        let _ = self.inner.events.send(event);
    }

    fn register(&self, tx: mpsc::UnboundedSender<AppToExt>) -> u64 {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut clients) = self.inner.clients.lock() {
            clients.insert(id, tx);
        }
        self.emit(ServerEvent::ExtConnected(true));
        id
    }

    fn unregister(&self, id: u64) {
        let still_connected = match self.inner.clients.lock() {
            Ok(mut clients) => {
                clients.remove(&id);
                !clients.is_empty()
            }
            Err(_) => false,
        };
        self.emit(ServerEvent::ExtConnected(still_connected));
    }
}

/// Everything the HTTP/WS handlers need. Cheap to clone (all `Arc`s).
#[derive(Clone)]
pub struct ServerContext {
    pub hub: WsHub,
    /// Supabase user id of the signed-in desktop user (set by the frontend via `set_current_user`).
    pub current_user: Arc<Mutex<Option<String>>>,
    /// Optional recorder; `None` until the recording phase ships (see `recording.rs`).
    pub recording: SharedRecordingBackend,
    pub app_version: String,
    /// Debug builds accept any `chrome-extension://*` origin and requests without an `Origin`
    /// header (local test clients). Release builds only accept [`EXTENSION_ORIGIN`].
    pub allow_any_extension_origin: bool,
}

impl ServerContext {
    pub fn new(hub: WsHub, current_user: Arc<Mutex<Option<String>>>, app_version: impl Into<String>) -> Self {
        Self {
            hub,
            current_user,
            recording: Arc::new(std::sync::RwLock::new(None)),
            app_version: app_version.into(),
            allow_any_extension_origin: cfg!(debug_assertions),
        }
    }

    pub fn current_user(&self) -> Option<String> {
        self.current_user.lock().ok().and_then(|u| u.clone())
    }

    pub fn recording_backend(&self) -> Option<Arc<dyn RecordingBackend>> {
        self.recording.read().ok().and_then(|b| b.clone())
    }

    /// Install (or remove, with `None`) the recorder used for interview sessions.
    pub fn set_recording_backend(&self, backend: Option<Arc<dyn RecordingBackend>>) {
        if let Ok(mut slot) = self.recording.write() {
            *slot = backend;
        }
    }

    fn recording_capable(&self) -> bool {
        self.recording_backend().is_some_and(|b| b.capable())
    }

    fn origin_allowed(&self, headers: &HeaderMap) -> bool {
        match headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
            None => self.allow_any_extension_origin,
            Some(origin) => {
                origin == EXTENSION_ORIGIN
                    || (self.allow_any_extension_origin && origin.starts_with("chrome-extension://"))
            }
        }
    }
}

/// Build the axum router.
pub fn router(ctx: ServerContext) -> Router {
    Router::new()
        .route("/", get(ws_upgrade))
        .route("/health", get(health))
        .route(AUTH_CALLBACK_PATH, get(auth_callback))
        .with_state(ctx)
}

/// Bind to `addr` (use port 0 for an ephemeral port) and return the listener + actual address.
pub async fn bind(addr: SocketAddr) -> std::io::Result<(TcpListener, SocketAddr)> {
    let listener = TcpListener::bind(addr).await?;
    let local = listener.local_addr()?;
    Ok((listener, local))
}

/// Serve until the listener fails.
pub async fn serve(listener: TcpListener, ctx: ServerContext) -> std::io::Result<()> {
    axum::serve(listener, router(ctx)).await
}

/// Production entry point: bind `127.0.0.1:47831`, retrying every 5s while the port is busy.
pub async fn run_forever(ctx: ServerContext) {
    let addr = SocketAddr::from(([127, 0, 0, 1], WS_PORT));
    loop {
        match bind(addr).await {
            Ok((listener, local)) => {
                info!(%local, "local server listening");
                if let Err(err) = serve(listener, ctx.clone()).await {
                    error!(%err, "local server stopped; restarting in 5s");
                }
            }
            Err(err) => {
                error!(%err, %addr, "cannot bind local server (port busy?); retrying in 5s");
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

async fn health(State(ctx): State<ServerContext>) -> Response {
    let body = json!({
        "app": "lare",
        "version": ctx.app_version,
        "userId": ctx.current_user(),
        "connected": ctx.hub.connected(),
    });
    let mut res = axum::Json(body).into_response();
    // Lets the web app / extension popup probe whether the desktop app is running.
    res.headers_mut()
        .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    res
}

#[derive(Debug, Deserialize)]
struct AuthCallbackQuery {
    code: Option<String>,
    next: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

async fn auth_callback(
    State(ctx): State<ServerContext>,
    Query(q): Query<AuthCallbackQuery>,
) -> Response {
    if let Some(error) = q.error {
        let description = q.error_description;
        warn!(%error, ?description, "oauth callback returned an error");
        let detail = description.clone().unwrap_or_else(|| error.clone());
        ctx.hub.emit(ServerEvent::AuthError { error, description });
        return (
            StatusCode::BAD_REQUEST,
            Html(callback_page("Sign-in failed", &detail)),
        )
            .into_response();
    }
    match q.code {
        Some(code) if !code.is_empty() => {
            debug!("oauth callback received a code");
            ctx.hub.emit(ServerEvent::AuthCallback { code, next: q.next });
            Html(callback_page(
                "Signed in to Lare — you can close this tab.",
                "Switch back to the Lare app to continue.",
            ))
            .into_response()
        }
        _ => (
            StatusCode::BAD_REQUEST,
            Html(callback_page("Sign-in failed", "The callback did not include a code.")),
        )
            .into_response(),
    }
}

fn callback_page(title: &str, detail: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Lare</title>\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#f4f4f5;\
font:16px/1.5 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif}}main{{text-align:center;padding:2rem}}\
h1{{font-size:1.25rem;font-weight:600;margin:0 0 .5rem}}p{{color:#a1a1aa;margin:0}}</style></head>\
<body><main><h1>{}</h1><p>{}</p></main></body></html>",
        html_escape(title),
        html_escape(detail)
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

async fn ws_upgrade(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !ctx.origin_allowed(&headers) {
        let origin = headers
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("<none>");
        warn!(origin, "rejected websocket upgrade from disallowed origin");
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, ctx))
}

fn error_frame(code: ErrorCode, message: impl Into<String>) -> AppToExt {
    AppToExt::Error {
        code,
        message: message.into(),
    }
}

async fn send_frame(socket: &mut WebSocket, msg: &AppToExt) -> Result<(), axum::Error> {
    let text = serde_json::to_string(msg).map_err(axum::Error::new)?;
    socket.send(Message::Text(text.into())).await
}

/// Handshake, then pump frames until the client goes away.
async fn handle_socket(mut socket: WebSocket, ctx: ServerContext) {
    // 1. First frame must be `hello`.
    let first = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => break text,
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            Some(Ok(Message::Binary(_))) => {
                let _ = send_frame(
                    &mut socket,
                    &error_frame(ErrorCode::BadMessage, "expected a text hello frame"),
                )
                .await;
                return;
            }
            Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
        }
    };

    let hello = serde_json::from_str::<ExtToApp>(first.as_str());
    let (protocol, ext_version, ext_user) = match hello {
        Ok(ExtToApp::Hello {
            protocol,
            ext_version,
            user_id,
        }) => (protocol, ext_version, user_id),
        Ok(_) => {
            let _ = send_frame(
                &mut socket,
                &error_frame(ErrorCode::BadMessage, "first message must be hello"),
            )
            .await;
            return;
        }
        Err(err) => {
            let _ = send_frame(
                &mut socket,
                &error_frame(ErrorCode::BadMessage, format!("invalid hello: {err}")),
            )
            .await;
            return;
        }
    };

    if protocol != PROTOCOL_VERSION {
        warn!(protocol, "extension uses an unsupported protocol version");
        let _ = send_frame(
            &mut socket,
            &error_frame(
                ErrorCode::UnsupportedProtocol,
                format!("desktop app speaks protocol v{PROTOCOL_VERSION}, extension sent v{protocol}"),
            ),
        )
        .await;
        return;
    }

    let current_user = ctx.current_user();
    if let (Some(ext), Some(app)) = (&ext_user, &current_user) {
        if ext != app {
            warn!("extension user differs from desktop user");
        }
    }
    let ack = AppToExt::HelloAck {
        protocol: PROTOCOL_VERSION,
        app_version: ctx.app_version.clone(),
        user_id: current_user,
        recording_capable: ctx.recording_capable(),
    };
    if send_frame(&mut socket, &ack).await.is_err() {
        return;
    }
    info!(ext_version, "extension connected");

    // 2. Register with the hub and split the socket: a writer task drains the per-client
    //    channel, the loop below reads frames.
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
    let value: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(err) => {
            let _ = tx.send(error_frame(ErrorCode::BadMessage, format!("invalid JSON: {err}")));
            return;
        }
    };
    let msg: ExtToApp = match serde_json::from_value(value.clone()) {
        Ok(m) => m,
        Err(err) => {
            let _ = tx.send(error_frame(
                ErrorCode::BadMessage,
                format!("unknown or malformed message: {err}"),
            ));
            return;
        }
    };

    ctx.hub.emit(ServerEvent::ExtMessage(value));

    match msg {
        ExtToApp::Ping { at } => {
            let _ = tx.send(AppToExt::Pong { at });
        }
        ExtToApp::Hello { .. } => {
            // A repeated hello is harmless: answer it again so the client can re-sync.
            let _ = tx.send(AppToExt::HelloAck {
                protocol: PROTOCOL_VERSION,
                app_version: ctx.app_version.clone(),
                user_id: ctx.current_user(),
                recording_capable: ctx.recording_capable(),
            });
        }
        ExtToApp::SessionStart {
            session_id,
            kind: SessionKind::Interview,
            started_at,
            facecam,
            mic,
            ..
        } => match ctx.recording_backend() {
            Some(backend) => backend.start(
                &ctx.hub,
                RecordingRequest {
                    session_id,
                    started_at,
                    facecam,
                    mic,
                },
            ),
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
                backend.pause(&ctx.hub, &session_id, at);
            }
        }
        ExtToApp::SessionResume { session_id, at } => {
            if let Some(backend) = ctx.recording_backend() {
                backend.resume(&ctx.hub, &session_id, at);
            }
        }
        ExtToApp::SessionEnd { session_id, at } => {
            if let Some(backend) = ctx.recording_backend() {
                backend.stop(&ctx.hub, &session_id, at);
            }
        }
        // Practice sessions, problem/edit/submission frames only need to reach the frontend.
        ExtToApp::SessionStart { .. }
        | ExtToApp::ProblemOpen { .. }
        | ExtToApp::EditsBatch { .. }
        | ExtToApp::Submission { .. } => {}
    }
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        sync::mpsc::UnboundedReceiver,
    };
    use tokio_tungstenite::{
        MaybeTlsStream, WebSocketStream, connect_async,
        tungstenite::{self, client::IntoClientRequest, http::HeaderValue},
    };

    type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

    struct TestServer {
        addr: SocketAddr,
        ctx: ServerContext,
        events: UnboundedReceiver<ServerEvent>,
    }

    async fn start(allow_any_origin: bool) -> TestServer {
        let (hub, events) = WsHub::new();
        let mut ctx = ServerContext::new(hub, Arc::new(Mutex::new(None)), "0.0.0-test");
        ctx.allow_any_extension_origin = allow_any_origin;
        let (listener, addr) = bind("127.0.0.1:0".parse().unwrap()).await.unwrap();
        tokio::spawn(serve(listener, ctx.clone()));
        TestServer { addr, ctx, events }
    }

    fn ws_url(addr: SocketAddr) -> String {
        format!("ws://{addr}/")
    }

    async fn connect(addr: SocketAddr, origin: Option<&str>) -> tungstenite::Result<Client> {
        let mut request = ws_url(addr).into_client_request()?;
        if let Some(origin) = origin {
            request
                .headers_mut()
                .insert("Origin", HeaderValue::from_str(origin).unwrap());
        }
        let (client, _response) = connect_async(request).await?;
        Ok(client)
    }

    async fn send_json(client: &mut Client, value: serde_json::Value) {
        client
            .send(tungstenite::Message::text(value.to_string()))
            .await
            .unwrap();
    }

    async fn recv_json(client: &mut Client) -> serde_json::Value {
        let frame = tokio::time::timeout(Duration::from_secs(5), client.next())
            .await
            .expect("timed out waiting for a frame")
            .expect("stream ended")
            .expect("read error");
        let text = frame.to_text().expect("text frame");
        serde_json::from_str(text).expect("valid json")
    }

    /// Connect (no Origin) and complete the hello handshake; returns the client + the ack.
    async fn handshake(addr: SocketAddr) -> (Client, serde_json::Value) {
        let mut client = connect(addr, None).await.unwrap();
        send_json(
            &mut client,
            json!({ "type": "hello", "protocol": PROTOCOL_VERSION, "extVersion": "0.1.0", "userId": null }),
        )
        .await;
        let ack = recv_json(&mut client).await;
        (client, ack)
    }

    async fn http_get(addr: SocketAddr, path: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(addr).await.unwrap();
        stream
            .write_all(
                format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n").as_bytes(),
            )
            .await
            .unwrap();
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.unwrap();
        let text = String::from_utf8_lossy(&buf).into_owned();
        let status = text
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .expect("status line");
        let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, body)
    }

    async fn next_event(events: &mut UnboundedReceiver<ServerEvent>) -> ServerEvent {
        tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .expect("timed out waiting for a server event")
            .expect("event channel closed")
    }

    #[tokio::test]
    async fn handshake_without_origin_in_debug_returns_hello_ack() {
        let mut server = start(true).await;
        let (_client, ack) = handshake(server.addr).await;
        assert_eq!(ack["type"], "hello.ack");
        assert_eq!(ack["protocol"], PROTOCOL_VERSION);
        assert_eq!(ack["appVersion"], "0.0.0-test");
        assert_eq!(ack["userId"], serde_json::Value::Null);
        assert_eq!(ack["recordingCapable"], false);
        assert_eq!(next_event(&mut server.events).await, ServerEvent::ExtConnected(true));
        assert_eq!(server.ctx.hub.client_count(), 1);
    }

    #[tokio::test]
    async fn hello_ack_carries_current_user() {
        let server = start(true).await;
        *server.ctx.current_user.lock().unwrap() = Some("user-123".into());
        let (_client, ack) = handshake(server.addr).await;
        assert_eq!(ack["userId"], "user-123");
    }

    #[tokio::test]
    async fn pinned_extension_origin_is_accepted_even_in_release_mode() {
        let server = start(false).await;
        let mut client = connect(server.addr, Some(EXTENSION_ORIGIN)).await.unwrap();
        send_json(
            &mut client,
            json!({ "type": "hello", "protocol": 1, "extVersion": "0.1.0", "userId": null }),
        )
        .await;
        assert_eq!(recv_json(&mut client).await["type"], "hello.ack");
    }

    #[tokio::test]
    async fn evil_origin_is_rejected_with_403() {
        let server = start(true).await;
        let err = connect(server.addr, Some("https://evil.example"))
            .await
            .err()
            .expect("upgrade should fail");
        match err {
            tungstenite::Error::Http(response) => assert_eq!(response.status().as_u16(), 403),
            other => panic!("expected an HTTP 403, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn missing_origin_is_rejected_in_release_mode() {
        let server = start(false).await;
        let err = connect(server.addr, None).await.err().expect("upgrade should fail");
        match err {
            tungstenite::Error::Http(response) => assert_eq!(response.status().as_u16(), 403),
            other => panic!("expected an HTTP 403, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ping_gets_pong() {
        let server = start(true).await;
        let (mut client, _ack) = handshake(server.addr).await;
        send_json(&mut client, json!({ "type": "ping", "at": 1700000000123u64 })).await;
        let pong = recv_json(&mut client).await;
        assert_eq!(pong, json!({ "type": "pong", "at": 1700000000123u64 }));
    }

    #[tokio::test]
    async fn interview_session_start_without_recorder_reports_recording_error() {
        let mut server = start(true).await;
        let (mut client, _ack) = handshake(server.addr).await;
        assert_eq!(next_event(&mut server.events).await, ServerEvent::ExtConnected(true));

        let start = json!({
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
        });
        send_json(&mut client, start.clone()).await;

        let state = recv_json(&mut client).await;
        assert_eq!(state["type"], "recording.state");
        assert_eq!(state["sessionId"], "s1");
        assert_eq!(state["state"], "error");
        assert_eq!(state["startedAt"], serde_json::Value::Null);
        assert_eq!(state["message"], RECORDING_UNAVAILABLE_MESSAGE);

        // The frame is also forwarded to the app layer verbatim.
        assert_eq!(next_event(&mut server.events).await, ServerEvent::ExtMessage(start));
    }

    #[tokio::test]
    async fn practice_session_start_is_forwarded_without_a_reply() {
        let mut server = start(true).await;
        let (mut client, _ack) = handshake(server.addr).await;
        let _ = next_event(&mut server.events).await; // connected
        send_json(
            &mut client,
            json!({ "type": "session.start", "sessionId": "s2", "kind": "practice", "scope": "session",
                    "startedAt": 1u64, "problem": null }),
        )
        .await;
        match next_event(&mut server.events).await {
            ServerEvent::ExtMessage(v) => assert_eq!(v["sessionId"], "s2"),
            other => panic!("unexpected {other:?}"),
        }
        // Follow up with a ping: the *next* frame must be the pong, i.e. nothing was sent for the
        // practice session start.
        send_json(&mut client, json!({ "type": "ping", "at": 7 })).await;
        assert_eq!(recv_json(&mut client).await["type"], "pong");
    }

    #[tokio::test]
    async fn health_reports_connected_clients() {
        let server = start(true).await;
        let (status, body) = http_get(server.addr, "/health").await;
        assert_eq!(status, 200);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["app"], "lare");
        assert_eq!(json["version"], "0.0.0-test");
        assert_eq!(json["connected"], false);

        let (mut client, _ack) = handshake(server.addr).await;
        let (_, body) = http_get(server.addr, "/health").await;
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["connected"], true);
        assert_eq!(json["userId"], serde_json::Value::Null);

        client.close(None).await.unwrap();
        // Give the server a moment to notice the close frame.
        for _ in 0..50 {
            if !server.ctx.hub.connected() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let (_, body) = http_get(server.addr, "/health").await;
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["connected"], false);
    }

    #[tokio::test]
    async fn auth_callback_emits_code_and_error_events() {
        let mut server = start(true).await;
        let (status, body) = http_get(server.addr, "/auth/callback?code=abc123&next=%2Fdrafts").await;
        assert_eq!(status, 200);
        assert!(body.contains("Signed in to Lare"));
        assert_eq!(
            next_event(&mut server.events).await,
            ServerEvent::AuthCallback { code: "abc123".into(), next: Some("/drafts".into()) }
        );

        let (status, body) = http_get(
            server.addr,
            "/auth/callback?error=access_denied&error_description=User%20said%20no",
        )
        .await;
        assert_eq!(status, 400);
        assert!(body.contains("User said no"));
        assert_eq!(
            next_event(&mut server.events).await,
            ServerEvent::AuthError {
                error: "access_denied".into(),
                description: Some("User said no".into()),
            }
        );
    }

    #[tokio::test]
    async fn unparseable_frames_get_bad_message_errors() {
        let server = start(true).await;
        let (mut client, _ack) = handshake(server.addr).await;
        client.send(tungstenite::Message::text("not json")).await.unwrap();
        let err = recv_json(&mut client).await;
        assert_eq!(err["type"], "error");
        assert_eq!(err["code"], "bad_message");

        send_json(&mut client, json!({ "type": "nope" })).await;
        let err = recv_json(&mut client).await;
        assert_eq!(err["code"], "bad_message");

        // Connection is still alive afterwards.
        send_json(&mut client, json!({ "type": "ping", "at": 1 })).await;
        assert_eq!(recv_json(&mut client).await["type"], "pong");
    }

    #[tokio::test]
    async fn protocol_mismatch_is_rejected_and_closed() {
        let server = start(true).await;
        let mut client = connect(server.addr, None).await.unwrap();
        send_json(
            &mut client,
            json!({ "type": "hello", "protocol": 99, "extVersion": "9.9.9", "userId": null }),
        )
        .await;
        let err = recv_json(&mut client).await;
        assert_eq!(err["type"], "error");
        assert_eq!(err["code"], "unsupported_protocol");
        // Server closes: the next item is a Close frame or the end of the stream.
        let next = tokio::time::timeout(Duration::from_secs(5), client.next()).await.unwrap();
        assert!(matches!(next, None | Some(Ok(tungstenite::Message::Close(_))) | Some(Err(_))));
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
    async fn broadcast_reaches_every_client_and_ws_send_shape_roundtrips() {
        let server = start(true).await;
        let (mut a, _) = handshake(server.addr).await;
        let (mut b, _) = handshake(server.addr).await;
        assert_eq!(server.ctx.hub.client_count(), 2);

        // Same path `ws_send` takes: JSON from the frontend -> AppToExt -> broadcast.
        let raw = json!({ "type": "recording.state", "sessionId": "s1", "state": "recording", "startedAt": 42u64 });
        let msg: AppToExt = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(server.ctx.hub.broadcast(msg), 2);

        assert_eq!(recv_json(&mut a).await, raw);
        assert_eq!(recv_json(&mut b).await, raw);
    }
}
