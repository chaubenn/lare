//! Local HTTP + WebSocket server on `127.0.0.1:47831`.
//!
//! * `GET /`               WebSocket used by the Chrome extension (protocol in `lare_core::protocol`),
//!   see [`bridge`].
//! * `GET /health`         JSON status probe (`{"app":"lare", ...}`). Readable by any page in the
//!   user's browser (CORS `*`), so it says whether the app runs and nothing about who is signed in.
//! * `GET /auth/callback`  OAuth loopback redirect; forwards the PKCE `code` to the webview, once,
//!   and only while a sign-in the app started is under way ([`SignInGate::expect_sign_in`]).
//! * `GET /preview/{token}` This device's copy of a recording, for the local preview (`preview`).
//!
//! The `Origin` check on the WebSocket only keeps web pages out: any local process can send any
//! header. What actually admits the extension is the pairing handshake. The webview generates a
//! random secret per install, publishes it to the signed-in user's `bridge_secrets` row (migration
//! 0032) and hands it to [`PairingStore`]. The extension, signed in as the same user, reads that
//! row. On connect each side proves it holds the secret with an HMAC over a nonce the other side
//! just chose, so neither the secret nor a replayable proof ever crosses the socket:
//!
//! ```text
//! ext -> app  hello           { protocol, userId, nonce: Ne }
//! app -> ext  auth.challenge  { installId, nonce: Na, proof: HMAC(K, "app", user, Ne, Na) }
//! ext -> app  auth.response   { proof: HMAC(K, "ext", user, Ne, Na) }
//! app -> ext  hello.ack       (only now is the client registered)
//! ```
//!
//! The server knows nothing about Tauri: it reports what happened through [`ServerEvent`]s on a
//! channel, and `lib.rs` turns those into Tauri events. That keeps the whole thing testable with
//! a plain tokio runtime (see the tests).

mod bridge;
mod hub;
mod oauth_callback;
mod pairing;
#[cfg(test)]
mod test_support;

use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Router,
    extract::State,
    http::{HeaderMap, HeaderValue, header},
    response::{IntoResponse, Response},
    routing::get,
};
use lare_core::{
    AUTH_CALLBACK_PATH, PROTOCOL_VERSION, WS_PORT,
    protocol::{AppToExt, RecordingSnapshot},
};
use serde_json::json;
use tokio::net::TcpListener;
use tracing::{error, info};

pub use bridge::{EXTENSION_ID, STORE_EXTENSION_ID};
pub use hub::{ServerEvent, WsHub};
pub use oauth_callback::SignInGate;
pub use pairing::{BridgeKeyInput, PairingStore};

use crate::preview::{self, PreviewFiles};
use crate::recording::{RecordingBackend, SharedRecordingBackend};
use crate::sync::{lock, read, write};

/// Everything the HTTP/WS handlers need. Cheap to clone (all `Arc`s).
#[derive(Clone)]
pub struct ServerContext {
    pub hub: WsHub,
    /// Supabase user id of the signed-in desktop user (set by the frontend via `set_current_user`).
    pub current_user: Arc<Mutex<Option<String>>>,
    /// Recorder for interview sessions; `None` until the app registers one (see `recording.rs`).
    pub recording: SharedRecordingBackend,
    pub app_version: String,
    /// Debug builds accept any `chrome-extension://*` origin and requests without an `Origin`
    /// header (local test clients). Release builds only accept [`Self::extension_ids`].
    pub allow_any_extension_origin: bool,
    /// Extension ids whose `chrome-extension://<id>` origin may open the WebSocket: the pinned id
    /// and, when known, the Chrome Web Store one.
    pub extension_ids: Vec<String>,
    /// Recordings this process has agreed to serve over `/preview/{token}`.
    pub previews: PreviewFiles,
    /// The secret that admits the extension, set from the webview.
    pub pairing: PairingStore,
    /// The sign-in in progress, set from the webview.
    pub sign_in: SignInGate,
}

impl ServerContext {
    pub fn new(
        hub: WsHub,
        current_user: Arc<Mutex<Option<String>>>,
        app_version: impl Into<String>,
        previews: PreviewFiles,
    ) -> Self {
        Self {
            hub,
            current_user,
            recording: Arc::new(std::sync::RwLock::new(None)),
            app_version: app_version.into(),
            allow_any_extension_origin: cfg!(debug_assertions),
            extension_ids: bridge::default_extension_ids(),
            previews,
            pairing: PairingStore::default(),
            sign_in: SignInGate::default(),
        }
    }

    pub fn current_user(&self) -> Option<String> {
        lock(&self.current_user).clone()
    }

    pub fn recording_backend(&self) -> Option<Arc<dyn RecordingBackend>> {
        read(&self.recording).clone()
    }

    /// Install (or remove, with `None`) the recorder used for interview sessions.
    pub fn set_recording_backend(&self, backend: Option<Arc<dyn RecordingBackend>>) {
        *write(&self.recording) = backend;
    }

    /// The pairing secret, if it belongs to the user the app is signed in as right now. The two are
    /// set by separate calls, so for a moment around a sign-in or sign-out they can disagree.
    fn pairing_key(&self) -> Option<pairing::PairingKey> {
        let current = self.current_user()?;
        self.pairing.key().filter(|key| key.user_id == current)
    }

    fn recording_capable(&self) -> bool {
        self.recording_backend().is_some_and(|b| b.capable())
    }

    fn recording_snapshot(&self) -> Option<RecordingSnapshot> {
        self.recording_backend().and_then(|b| b.snapshot())
    }

    /// The `hello.ack` for an extension that said it speaks `ext_protocol`.
    fn hello_ack(&self, ext_protocol: u32) -> AppToExt {
        AppToExt::HelloAck {
            // The lower of the two: an extension from before negotiation (v2) rejects any number
            // but its own, and a newer one decides for itself whether this app is new enough.
            protocol: ext_protocol.min(PROTOCOL_VERSION),
            app_version: self.app_version.clone(),
            user_id: self.current_user(),
            recording_capable: self.recording_capable(),
            recording: self.recording_snapshot(),
        }
    }
}

const PREVIEW_PREFIX: &str = "/preview/";

/// The loopback URL that serves the recording registered under `token` (see `preview.rs`).
pub fn preview_url(token: &str) -> String {
    format!("http://127.0.0.1:{WS_PORT}{PREVIEW_PREFIX}{token}")
}

pub fn router(ctx: ServerContext) -> Router {
    Router::new()
        .route("/", get(bridge::ws_upgrade))
        .route("/health", get(health))
        .route(AUTH_CALLBACK_PATH, get(oauth_callback::auth_callback))
        .route(&format!("{PREVIEW_PREFIX}{{token}}"), get(preview_file))
        .with_state(ctx)
}

/// Bind to `addr` (use port 0 for an ephemeral port) and return the listener + actual address.
pub async fn bind(addr: SocketAddr) -> std::io::Result<(TcpListener, SocketAddr)> {
    let listener = TcpListener::bind(addr).await?;
    let local = listener.local_addr()?;
    Ok((listener, local))
}

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

/// This device's copy of a recording, for the preview shown while the cloud copy processes. The
/// token is minted by the `preview_url` command, so only files the webview has asked for are
/// reachable — the port itself is open to any page in the user's browser.
async fn preview_file(
    State(ctx): State<ServerContext>,
    axum::extract::Path(token): axum::extract::Path<String>,
    headers: HeaderMap,
) -> Response {
    preview::handle(&ctx.previews, &token, &headers).await
}

async fn health(State(ctx): State<ServerContext>) -> Response {
    let body = json!({
        "app": "lare",
        "version": ctx.app_version,
        "connected": ctx.hub.connected(),
    });
    let mut res = axum::Json(body).into_response();
    // Lets the web app / extension popup probe whether the desktop app is running. Anything
    // that identifies the signed-in user stays out of this body: the header below hands it to
    // every origin, and the extension gets the user id through `hello.ack` instead.
    res.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    res
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

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
        assert!(
            json.get("userId").is_none(),
            "/health is readable by any origin and must not name the user"
        );

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
    async fn a_preview_url_reaches_the_file_registered_for_its_token() {
        let server = start(true).await;
        let dir = std::env::temp_dir().join(format!("lare-server-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.mp4");
        std::fs::write(&file, b"0123456789").unwrap();

        let token = server.ctx.previews.register(&file);
        let url = preview_url(&token);
        let path = url
            .strip_prefix(&format!("http://127.0.0.1:{WS_PORT}"))
            .expect("a loopback URL on the app's port");
        let (status, body) = http_get(server.addr, path).await;
        assert_eq!((status, body.as_str()), (200, "0123456789"));

        let (status, _) = http_get(server.addr, &format!("{PREVIEW_PREFIX}unknown")).await;
        assert_eq!(status, 404);
        std::fs::remove_dir_all(&dir).ok();
    }
}
