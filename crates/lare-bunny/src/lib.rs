//! Resumable [TUS](https://tus.io) uploads to Bunny Stream.
//!
//! The desktop app never holds the Bunny API key: it asks the `bunny-create-upload`
//! Edge Function for [`TusCredentials`] (a pre-signed `AuthorizationSignature`) and then
//! streams the file to `https://video.bunnycdn.com/tusupload` in chunks. Interrupted
//! uploads resume from the server-reported offset.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

pub const DEFAULT_CHUNK_SIZE: usize = 8 * 1024 * 1024;
const MAX_RETRIES: usize = 6;

/// Returned by the `bunny-create-upload` Edge Function.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUploadResponse {
    pub video_id: String,
    pub bunny_video_id: String,
    pub library_id: u64,
    pub tus: TusCredentials,
}

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

/// Create a new TUS upload and return its URL.
pub async fn create_upload(
    client: &reqwest::Client,
    creds: &TusCredentials,
    total_len: u64,
) -> Result<String, BunnyError> {
    let metadata = format!(
        "filetype {},title {}",
        b64(&creds.metadata.filetype),
        b64(&creds.metadata.title)
    );
    let req = apply_auth(client.post(&creds.endpoint), creds)
        .header("Upload-Length", total_len.to_string())
        .header("Upload-Metadata", metadata)
        .header("Content-Length", "0");
    let res = req.send().await?;
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
    Ok(resolve_location(&creds.endpoint, &location))
}

/// Ask the server how many bytes it already has.
pub async fn current_offset(
    client: &reqwest::Client,
    creds: &TusCredentials,
    upload_url: &str,
) -> Result<u64, BunnyError> {
    let res = apply_auth(client.head(upload_url), creds).send().await?;
    match res.status().as_u16() {
        404 | 410 | 403 => return Err(BunnyError::Gone),
        s if s >= 400 => {
            return Err(BunnyError::Exhausted {
                attempts: 1,
                last: format!("HEAD returned {s}"),
            })
        }
        _ => {}
    }
    let offset = res
        .headers()
        .get("Upload-Offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    Ok(offset)
}

/// Upload `path` to Bunny via TUS. Pass `resume_url` (from a previous attempt) to
/// continue an interrupted upload. Returns the upload URL (persist it for resume).
pub async fn upload_file<F>(
    client: &reqwest::Client,
    path: &Path,
    creds: &TusCredentials,
    resume_url: Option<&str>,
    chunk_size: usize,
    mut on_progress: F,
) -> Result<String, BunnyError>
where
    F: FnMut(UploadProgress),
{
    let mut file = tokio::fs::File::open(path).await?;
    let total = file.metadata().await?.len();

    // Resume if possible, otherwise create.
    let (upload_url, mut offset) = match resume_url {
        Some(url) => match current_offset(client, creds, url).await {
            Ok(off) => (url.to_string(), off.min(total)),
            Err(BunnyError::Gone) => (create_upload(client, creds, total).await?, 0),
            Err(e) => return Err(e),
        },
        None => (create_upload(client, creds, total).await?, 0),
    };
    on_progress(UploadProgress {
        uploaded: offset,
        total,
    });

    let mut buf = vec![0u8; chunk_size.max(64 * 1024)];
    let mut attempts = 0usize;
    let mut last_err = String::new();

    while offset < total {
        file.seek(std::io::SeekFrom::Start(offset)).await?;
        let want = ((total - offset) as usize).min(buf.len());
        let mut read = 0usize;
        while read < want {
            let n = file.read(&mut buf[read..want]).await?;
            if n == 0 {
                break;
            }
            read += n;
        }
        let chunk = buf[..read].to_vec();

        let res = apply_auth(client.patch(&upload_url), creds)
            .header("Upload-Offset", offset.to_string())
            .header("Content-Type", "application/offset+octet-stream")
            .header("Content-Length", chunk.len().to_string())
            .body(chunk)
            .send()
            .await;

        match res {
            Ok(res) if res.status().is_success() => {
                let new_offset = res
                    .headers()
                    .get("Upload-Offset")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(offset + read as u64);
                offset = new_offset;
                attempts = 0;
                on_progress(UploadProgress {
                    uploaded: offset,
                    total,
                });
            }
            Ok(res) => {
                let status = res.status();
                if matches!(status.as_u16(), 404 | 410) {
                    return Err(BunnyError::Gone);
                }
                last_err = format!("PATCH returned {status}");
                attempts += 1;
                if status.as_u16() == 409 {
                    // Offset conflict: re-sync with the server.
                    let server = current_offset(client, creds, &upload_url).await?;
                    if server > total {
                        return Err(BunnyError::OffsetMismatch {
                            server,
                            local: offset,
                        });
                    }
                    offset = server;
                }
            }
            Err(e) => {
                last_err = e.to_string();
                attempts += 1;
                // Network hiccup: find out what actually landed.
                if let Ok(server) = current_offset(client, creds, &upload_url).await {
                    offset = server.min(total);
                }
            }
        }

        if attempts > 0 {
            if attempts >= MAX_RETRIES {
                return Err(BunnyError::Exhausted {
                    attempts,
                    last: last_err,
                });
            }
            let backoff = Duration::from_millis(500 * 2u64.pow(attempts as u32 - 1));
            tracing::warn!(attempt = attempts, ?backoff, error = %last_err, "tus chunk failed, retrying");
            tokio::time::sleep(backoff).await;
        }
    }

    Ok(upload_url)
}

/// Default HTTP client tuned for large uploads.
pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("lare-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
}
