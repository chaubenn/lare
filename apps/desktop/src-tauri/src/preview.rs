//! Serving this device's own recordings to the webview, for the preview shown while the cloud
//! copy is still processing.
//!
//! The obvious way to do this is `convertFileSrc`, and it does not work for what we record.
//! `content/capture.mp4` is a fragmented MP4 with no index: `sidx` is stripped when the DASH
//! fragments are combined, there is no `mfra`, and the header durations are all zero because they
//! come from a DASH init segment. A player therefore has to walk every `moof` in the file to work
//! out the timeline — and WebKit does that by asking for **eight bytes at a time**. Over Tauri's
//! `asset://` scheme each of those is a separate scheme-handler round trip, so on a real recording
//! (~450 fragments in eight minutes) WebKit gives up long before it has a duration: the first frame
//! renders, `readyState` stays 0, and play does nothing.
//!
//! Measured on the same 483s/194MB file: `asset://` never reaches `loadedmetadata` (28s, then
//! stalled), `file://` and `http://127.0.0.1` both play immediately. So the preview goes over the
//! loopback server the app already runs, which streams a range instead of answering thousands of
//! tiny reads. Appending an `mfra` index was tried first and does not help — WebKit scans anyway.
//!
//! The port is reachable by any page in the user's browser, so a path is only served after the
//! webview has asked for it by a path under the recordings directory, and only under a random
//! token minted for that file. Tokens live in memory and die with the process.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use axum::{
    body::{Body, Bytes},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

/// How much of the file to hand over per chunk while streaming a range.
const CHUNK: usize = 256 * 1024;

/// Paths this process has agreed to serve, keyed by an unguessable token.
#[derive(Clone, Default)]
pub struct PreviewFiles {
    by_token: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl PreviewFiles {
    pub fn new() -> Self {
        Self::default()
    }

    /// Token for `path`, minting one if this is the first time it has been asked for. Stable per
    /// path so a re-render does not change the `<video>` src and restart playback.
    pub fn register(&self, path: &Path) -> String {
        let mut by_token = self.by_token.lock().expect("preview registry poisoned");
        if let Some((token, _)) = by_token.iter().find(|(_, known)| known.as_path() == path) {
            return token.clone();
        }
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        by_token.insert(token.clone(), path.to_path_buf());
        token
    }

    fn path(&self, token: &str) -> Option<PathBuf> {
        self.by_token
            .lock()
            .ok()
            .and_then(|by_token| by_token.get(token).cloned())
    }
}

/// `bytes=a-b` / `bytes=a-` / `bytes=-n` against a known length. `None` for anything else, which
/// the caller answers with the whole file rather than an error.
fn parse_range(header: &str, len: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = header.trim().strip_prefix("bytes=")?;
    // Multipart ranges are legal and no player asks for them; one range is enough.
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = match (start.trim(), end.trim()) {
        ("", "") => return Some(Err(())),
        // Suffix range: the last n bytes.
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            if n == 0 || len == 0 {
                return Some(Err(()));
            }
            (len.saturating_sub(n), len - 1)
        }
        (s, "") => (s.parse().ok()?, len.saturating_sub(1)),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(len - 1)),
    };
    if len == 0 || start > end || start >= len {
        return Some(Err(()));
    }
    Some(Ok((start, end)))
}

/// Stream `path`, honouring a `Range` header. Chunked rather than read whole: WebKit opens the
/// file with `bytes=0-` and reads as it plays, and a recording is hundreds of megabytes.
pub async fn serve_file(path: &Path, headers: &HeaderMap) -> Response {
    let Ok(file) = tokio::fs::File::open(path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(len) = file.metadata().await.map(|m| m.len()) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, len));
    let (start, end, status) = match range {
        Some(Ok((start, end))) => (start, end, StatusCode::PARTIAL_CONTENT),
        Some(Err(())) => {
            return (
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{len}"))],
            )
                .into_response();
        }
        None => (0, len.saturating_sub(1), StatusCode::OK),
    };

    let mut file = file;
    if start > 0 && file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let count = if len == 0 { 0 } else { end - start + 1 };
    let stream = futures_util::stream::try_unfold((file, count), |(mut file, left)| async move {
        if left == 0 {
            return Ok::<_, std::io::Error>(None);
        }
        let want = left.min(CHUNK as u64) as usize;
        let mut buf = vec![0u8; want];
        let read = file.read(&mut buf).await?;
        if read == 0 {
            // The file shrank under us (the copy is removed once the cloud video is ready).
            return Ok(None);
        }
        buf.truncate(read);
        Ok(Some((Bytes::from(buf), (file, left - read as u64))))
    });

    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, count.to_string())
        // Nothing here is cacheable: the file is deleted as soon as the cloud copy is ready.
        .header(header::CACHE_CONTROL, "no-store");
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    response
        .body(Body::from_stream(stream))
        .map(IntoResponse::into_response)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// `GET /preview/{token}`.
pub async fn handle(previews: &PreviewFiles, token: &str, headers: &HeaderMap) -> Response {
    match previews.path(token) {
        Some(path) => serve_file(&path, headers).await,
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_parse_the_forms_players_send() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some(Ok((0, 99))));
        assert_eq!(parse_range("bytes=500-", 1000), Some(Ok((500, 999))));
        assert_eq!(parse_range("bytes=-100", 1000), Some(Ok((900, 999))));
        // WebKit asks past the end while probing; clamping beats a 416 it would not retry.
        assert_eq!(parse_range("bytes=0-99999", 1000), Some(Ok((0, 999))));
        assert_eq!(parse_range("bytes=1000-", 1000), Some(Err(())));
        assert_eq!(parse_range("bytes=-", 1000), Some(Err(())));
        assert_eq!(parse_range("items=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-1,5-6", 1000), None);
    }

    #[test]
    fn a_token_is_stable_per_path_and_unique_per_file() {
        let previews = PreviewFiles::new();
        let one = previews.register(Path::new("/tmp/a.mp4"));
        let again = previews.register(Path::new("/tmp/a.mp4"));
        let other = previews.register(Path::new("/tmp/b.mp4"));
        assert_eq!(one, again, "a re-render must not change the video src");
        assert_ne!(one, other);
        assert_eq!(previews.path(&one).as_deref(), Some(Path::new("/tmp/a.mp4")));
        assert_eq!(previews.path("nope"), None);
    }

    #[tokio::test]
    async fn serves_whole_files_and_ranges() {
        let dir = std::env::temp_dir().join(format!("lare-preview-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("clip.mp4");
        std::fs::write(&path, b"0123456789").unwrap();

        let whole = serve_file(&path, &HeaderMap::new()).await;
        assert_eq!(whole.status(), StatusCode::OK);
        assert_eq!(whole.headers()[header::CONTENT_LENGTH], "10");

        let mut headers = HeaderMap::new();
        headers.insert(header::RANGE, "bytes=2-5".parse().unwrap());
        let part = serve_file(&path, &headers).await;
        assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(part.headers()[header::CONTENT_RANGE], "bytes 2-5/10");
        assert_eq!(part.headers()[header::CONTENT_LENGTH], "4");
        let body = axum::body::to_bytes(part.into_body(), 64).await.unwrap();
        assert_eq!(&body[..], b"2345");

        headers.insert(header::RANGE, "bytes=99-".parse().unwrap());
        let bad = serve_file(&path, &headers).await;
        assert_eq!(bad.status(), StatusCode::RANGE_NOT_SATISFIABLE);

        let missing = serve_file(&dir.join("gone.mp4"), &HeaderMap::new()).await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        std::fs::remove_dir_all(&dir).ok();
    }
}
