//! `GET /auth/callback`: the OAuth loopback redirect. Forwards the PKCE `code` to the webview,
//! once, and only while a sign-in the app started is under way.

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
};
use serde::Deserialize;
use tracing::{debug, warn};

use super::ServerContext;
use super::hub::ServerEvent;
use crate::sync::lock;

/// How long `/auth/callback` stays open after the app sends the user to a sign-in page.
const SIGN_IN_WINDOW: Duration = Duration::from_secs(10 * 60);

/// Whether the webview has just sent the user off to sign in (`expect_auth_callback`).
#[derive(Clone, Default)]
pub struct SignInGate {
    started: Arc<Mutex<Option<Instant>>>,
}

impl SignInGate {
    /// The webview is about to open a sign-in page: accept one `/auth/callback` for a while.
    pub fn expect_sign_in(&self) {
        *lock(&self.started) = Some(Instant::now());
    }

    /// Whether a callback may be delivered now. Consumes the sign-in, so a second callback (a
    /// stale tab, a replayed URL, a page that guessed the moment) is turned away.
    fn take_sign_in(&self) -> bool {
        lock(&self.started)
            .take()
            .is_some_and(|started| started.elapsed() <= SIGN_IN_WINDOW)
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct AuthCallbackQuery {
    code: Option<String>,
    next: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// The provider's redirect is a top-level navigation. Anything else (an `<img>`, an iframe, a
/// `fetch` from some page) is not a sign-in coming back, and is not allowed to use one up.
/// Browsers too old to send `Sec-Fetch-*` are let through to the one-shot check.
fn is_navigation(headers: &HeaderMap) -> bool {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    header("sec-fetch-dest").is_none_or(|dest| dest == "document")
        && header("sec-fetch-mode").is_none_or(|mode| mode == "navigate")
}

pub(super) async fn auth_callback(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    Query(q): Query<AuthCallbackQuery>,
) -> Response {
    if !is_navigation(&headers) {
        return (StatusCode::FORBIDDEN, "not a sign-in redirect").into_response();
    }
    if !ctx.sign_in.take_sign_in() {
        warn!("oauth callback arrived with no sign-in in progress; ignored");
        return (
            StatusCode::BAD_REQUEST,
            Html(callback_page(
                "No sign-in in progress",
                "Start signing in from the Lare app, then try again.",
            )),
        )
            .into_response();
    }
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
            ctx.hub
                .emit(ServerEvent::AuthCallback { code, next: q.next });
            Html(callback_page(
                "Signed in to Lare — you can close this tab.",
                "Switch back to the Lare app to continue.",
            ))
            .into_response()
        }
        _ => (
            StatusCode::BAD_REQUEST,
            Html(callback_page(
                "Sign-in failed",
                "The callback did not include a code.",
            )),
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

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;

    #[tokio::test]
    async fn auth_callback_emits_code_and_error_events() {
        let mut server = start(true).await;
        server.ctx.sign_in.expect_sign_in();
        let (status, body) =
            http_get(server.addr, "/auth/callback?code=abc123&next=%2Fdrafts").await;
        assert_eq!(status, 200);
        assert!(body.contains("Signed in to Lare"));
        assert_eq!(
            next_event(&mut server.events).await,
            ServerEvent::AuthCallback {
                code: "abc123".into(),
                next: Some("/drafts".into())
            }
        );

        server.ctx.sign_in.expect_sign_in();
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
    async fn auth_callback_needs_a_sign_in_in_progress_and_is_accepted_once() {
        let mut server = start(true).await;
        let (status, body) = http_get(server.addr, "/auth/callback?code=forged").await;
        assert_eq!(status, 400);
        assert!(body.contains("No sign-in in progress"));
        no_event(&mut server.events).await;

        server.ctx.sign_in.expect_sign_in();
        // A page embedding the URL as an image or frame neither delivers a code nor uses up the
        // sign-in it happened to land in.
        for dest in ["image", "iframe"] {
            let (status, _) = http_get_with(
                server.addr,
                "/auth/callback?code=forged",
                &[("Sec-Fetch-Dest", dest), ("Sec-Fetch-Mode", "no-cors")],
            )
            .await;
            assert_eq!(status, 403);
        }
        no_event(&mut server.events).await;

        let (status, _) = http_get_with(
            server.addr,
            "/auth/callback?code=real",
            &[
                ("Sec-Fetch-Dest", "document"),
                ("Sec-Fetch-Mode", "navigate"),
            ],
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(
            next_event(&mut server.events).await,
            ServerEvent::AuthCallback {
                code: "real".into(),
                next: None
            }
        );

        let (status, _) = http_get(server.addr, "/auth/callback?code=again").await;
        assert_eq!(status, 400);
        no_event(&mut server.events).await;
    }
}
