//! Resumable [TUS](https://tus.io) uploads to Bunny Stream.
//!
//! The desktop app never holds the Bunny API key: it asks the `bunny-create-upload`
//! Edge Function for [`TusCredentials`] (a pre-signed `AuthorizationSignature`) and then
//! streams the recording to `https://video.bunnycdn.com/tusupload` in chunks while it is still
//! being written. Interrupted uploads resume from the server-reported offset.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

pub const DEFAULT_CHUNK_SIZE: usize = 8 * 1024 * 1024;
const MAX_RETRIES: usize = 6;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TusCredentials {
    pub endpoint: String,
    /// `AuthorizationSignature`, `AuthorizationExpire`, `LibraryId`, `VideoId`.
    pub headers: BTreeMap<String, String>,
    pub metadata: TusMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TusMetadata {
    pub filetype: String,
    pub title: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadProgress {
    pub uploaded: u64,
    pub total: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum BunnyError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("tus create failed: HTTP {status} {body}")]
    Create { status: u16, body: String },
    #[error("tus server did not return a Location header")]
    MissingLocation,
    #[error("tus upload failed after {attempts} attempts: {last}")]
    Exhausted { attempts: usize, last: String },
    #[error("tus offset mismatch: server={server} local={local}")]
    OffsetMismatch { server: u64, local: u64 },
    #[error("upload expired or was removed on the server")]
    Gone,
    #[error("invalid TUS response: {0}")]
    Protocol(String),
    #[error("recording producer disconnected before flushing and closing the file")]
    ProducerDisconnected,
}

fn b64(s: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
}

fn apply_auth(mut req: reqwest::RequestBuilder, creds: &TusCredentials) -> reqwest::RequestBuilder {
    req = req.header("Tus-Resumable", "1.0.0");
    for (k, v) in &creds.headers {
        req = req.header(k.as_str(), v.as_str());
    }
    req
}

fn resolve_location(endpoint: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_string();
    }
    // Relative: resolve against the endpoint origin.
    match reqwest::Url::parse(endpoint).and_then(|base| base.join(location)) {
        Ok(u) => u.to_string(),
        Err(_) => location.to_string(),
    }
}

/// Create at record start; persist the returned URL for retry before producing bytes.
pub async fn create_deferred_upload(
    client: &reqwest::Client,
    creds: &TusCredentials,
) -> Result<String, BunnyError> {
    let metadata = format!(
        "filetype {},title {}",
        b64(&creds.metadata.filetype),
        b64(&creds.metadata.title)
    );
    // The length is declared by the final PATCH, once the recording has stopped growing.
    let res = apply_auth(client.post(&creds.endpoint), creds)
        .header("Upload-Metadata", metadata)
        .header("Content-Length", "0")
        .header("Upload-Defer-Length", "1")
        .send()
        .await?;
    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(BunnyError::Create {
            status: status.as_u16(),
            body: body.chars().take(500).collect(),
        });
    }
    let location = res
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .ok_or(BunnyError::MissingLocation)?
        .to_string();
    let url = resolve_location(&creds.endpoint, &location);
    let endpoint =
        reqwest::Url::parse(&creds.endpoint).map_err(|e| BunnyError::Protocol(e.to_string()))?;
    let resolved = reqwest::Url::parse(&url).map_err(|e| BunnyError::Protocol(e.to_string()))?;
    if endpoint.origin() != resolved.origin() {
        return Err(BunnyError::Protocol("cross-origin Location".into()));
    }
    Ok(url)
}

/// The upload no longer exists on the server, or these credentials may no longer write to it.
fn is_gone(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 401 | 403 | 404 | 410)
}

fn header_u64(headers: &reqwest::header::HeaderMap, name: &str) -> Option<u64> {
    headers.get(name)?.to_str().ok()?.parse().ok()
}

/// Delay before retry number `attempt` (counted from 1): 500ms, doubling each time.
fn backoff(attempt: usize) -> Duration {
    Duration::from_millis(500 * 2u64.pow(attempt as u32 - 1))
}

/// Tail an APPEND-ONLY file (e.g. fragmented MP4), never a muxer that rewrites headers.
/// The producer must flush/close the file before sending `true`. Dropping the sender
/// before that is an error. On failure keep the file and URL and call again to resume.
/// Progress.total is the currently available size, not the eventual recording size.
/// Successful return acknowledges the final length; this function never deletes files.
#[allow(clippy::too_many_arguments)]
pub async fn upload_growing_file<F>(
    client: &reqwest::Client,
    path: &Path,
    creds: &TusCredentials,
    upload_url: &str,
    chunk_size: usize,
    mut finished: tokio::sync::watch::Receiver<bool>,
    mut on_progress: F,
) -> Result<String, BunnyError>
where
    F: FnMut(UploadProgress),
{
    let mut file = tokio::fs::File::open(path).await?;
    let mut buffer = vec![0u8; chunk_size.clamp(64 * 1024, DEFAULT_CHUNK_SIZE)];
    let mut attempts = 0usize;
    let mut previous_size = 0;
    let mut acknowledged = 0;
    loop {
        let done = *finished.borrow_and_update();
        if !done && finished.has_changed().is_err() && !*finished.borrow() {
            return Err(BunnyError::ProducerDisconnected);
        }
        let total = file.metadata().await?.len();
        if total < previous_size {
            return Err(BunnyError::Protocol("growing file shrank".into()));
        }
        previous_size = total;
        let step: Result<bool, BunnyError> = async {
            // HEAD on every attempt resolves even a PATCH that landed but lost its response.
            let head = apply_auth(client.head(upload_url), creds).send().await?;
            if is_gone(head.status()) {
                return Err(BunnyError::Gone);
            }
            if !head.status().is_success() {
                return Err(BunnyError::Protocol(format!("HEAD {}", head.status())));
            }
            let offset = header_u64(head.headers(), "Upload-Offset")
                .ok_or_else(|| BunnyError::Protocol("missing Upload-Offset".into()))?;
            if offset > total || offset < acknowledged {
                return Err(BunnyError::OffsetMismatch {
                    server: offset,
                    local: total,
                });
            }
            acknowledged = offset;
            on_progress(UploadProgress {
                uploaded: offset,
                total,
            });
            if let Some(length) = header_u64(head.headers(), "Upload-Length") {
                if !done || length != total {
                    return Err(BunnyError::Protocol("unexpected declared length".into()));
                }
                if offset == total {
                    return Ok(true);
                }
            }
            if offset == total && !done {
                return Ok(false);
            }
            let count = (total - offset).min(buffer.len() as u64) as usize;
            file.seek(std::io::SeekFrom::Start(offset)).await?;
            file.read_exact(&mut buffer[..count]).await?;
            let mut request = apply_auth(client.patch(upload_url), creds)
                .header("Upload-Offset", offset.to_string())
                .header("Content-Type", "application/offset+octet-stream")
                .body(buffer[..count].to_vec());
            // An empty final PATCH also works when the last bytes arrived before stop.
            let final_patch = done && offset + count as u64 == total;
            if final_patch {
                request = request.header("Upload-Length", total.to_string());
            }
            let response = request.send().await?;
            if is_gone(response.status()) {
                return Err(BunnyError::Gone);
            }
            if !response.status().is_success() {
                return Err(BunnyError::Protocol(format!("PATCH {}", response.status())));
            }
            if header_u64(response.headers(), "Upload-Offset") != Some(offset + count as u64) {
                return Err(BunnyError::Protocol("invalid PATCH offset".into()));
            }
            acknowledged = offset + count as u64;
            on_progress(UploadProgress {
                uploaded: acknowledged,
                total,
            });
            Ok(final_patch)
        }
        .await;
        match step {
            Ok(true) => return Ok(upload_url.to_string()),
            Ok(false) => {
                attempts = 0;
                if acknowledged == total && !done {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_millis(200)) => {},
                        changed = finished.changed() => {
                            if changed.is_err() && !*finished.borrow() { return Err(BunnyError::ProducerDisconnected); }
                        }
                    }
                }
            }
            Err(
                error @ (BunnyError::Gone | BunnyError::OffsetMismatch { .. } | BunnyError::Io(_)),
            ) => return Err(error),
            Err(error) => {
                attempts += 1;
                if attempts >= MAX_RETRIES {
                    return Err(BunnyError::Exhausted {
                        attempts,
                        last: error.to_string(),
                    });
                }
                tokio::time::sleep(backoff(attempts)).await;
            }
        }
    }
}

/// Default HTTP client tuned for large uploads.
pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("lare-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
}
