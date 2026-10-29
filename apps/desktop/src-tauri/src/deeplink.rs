//! `lare://` deep links -> in-app routes.
//!
//! * `lare://open`                -> `/`
//! * `lare://open/<path>`         -> `/<path>`
//! * `lare://drafts/<id>`         -> `/drafts/<id>`
//! * `lare://<anything>/<path>`   -> `/<anything>/<path>` (future routes)

use tauri::Url;

pub const SCHEME: &str = "lare";

/// Map a deep-link URL to a frontend route, or `None` when the URL is not a `lare://` link.
pub fn route_for(url: &Url) -> Option<String> {
    if url.scheme() != SCHEME {
        return None;
    }
    let host = url.host_str().unwrap_or("").trim_matches('/');
    let path = url.path().trim_end_matches('/');
    let mut route = match host {
        "" | "open" => path.to_string(),
        other => format!("/{other}{path}"),
    };
    if route.is_empty() {
        route.push('/');
    }
    if let Some(q) = url.query() {
        route.push('?');
        route.push_str(q);
    }
    Some(route)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(s: &str) -> Option<String> {
        route_for(&Url::parse(s).unwrap())
    }

    #[test]
    fn maps_open_to_root() {
        assert_eq!(r("lare://open").as_deref(), Some("/"));
        assert_eq!(r("lare://open/").as_deref(), Some("/"));
        assert_eq!(r("lare://open/sessions").as_deref(), Some("/sessions"));
    }

    #[test]
    fn maps_drafts() {
        assert_eq!(r("lare://drafts/abc-123").as_deref(), Some("/drafts/abc-123"));
        assert_eq!(r("lare://drafts").as_deref(), Some("/drafts"));
        assert_eq!(r("lare://drafts/abc/").as_deref(), Some("/drafts/abc"));
    }

    #[test]
    fn keeps_query_and_rejects_other_schemes() {
        assert_eq!(r("lare://posts/p1?ref=ext").as_deref(), Some("/posts/p1?ref=ext"));
        assert_eq!(r("https://example.com/drafts/1"), None);
    }
}
