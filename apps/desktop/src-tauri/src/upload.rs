//! What the two upload paths share: the upload that tails a recording while it is captured
//! (`recorder`) and the one a retry starts from the Recordings page (`commands`).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tracing::warn;

use crate::events;

/// Bunny Stream's TUS endpoint (`BUNNY_TUS_ENDPOINT` in the Edge Functions), the only server a
/// recording is uploaded to. The credentials reach Rust through the webview, so the endpoint and
/// every upload URL are held to it rather than trusted: otherwise a webview that ran someone
/// else's script could send a recording anywhere.
const BUNNY_TUS_ENDPOINT: &str = "https://video.bunnycdn.com/tusupload";

pub fn pinned_tus(tus: &lare_bunny::TusCredentials) -> Result<(), String> {
    if tus.endpoint != BUNNY_TUS_ENDPOINT {
        return Err("upload endpoint is not Bunny Stream".to_string());
    }
    Ok(())
}

pub fn pinned_upload_url(url: &str) -> Result<(), String> {
    let bunny = reqwest::Url::parse(BUNNY_TUS_ENDPOINT).map_err(|e| e.to_string())?;
    let url = reqwest::Url::parse(url).map_err(|_| "invalid upload URL".to_string())?;
    if url.origin() != bunny.origin() {
        return Err("upload URL is not on Bunny Stream".to_string());
    }
    Ok(())
}

/// The upload a file is going to, remembered next to it (`<file>.upload.json`) so a restart
/// resumes that upload instead of creating another.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadMarker {
    /// The TUS headers the upload was created with. Kept as raw JSON: a marker written without
    /// them still reads, and simply matches no credentials.
    #[serde(default)]
    headers: serde_json::Value,
    pub upload_url: String,
}

impl UploadMarker {
    pub fn new(upload_url: &str, tus: &lare_bunny::TusCredentials) -> Self {
        Self {
            headers: serde_json::to_value(&tus.headers).unwrap_or_default(),
            upload_url: upload_url.to_string(),
        }
    }

    fn path(file: &Path) -> PathBuf {
        file.with_extension("upload.json")
    }

    pub async fn write(&self, file: &Path) -> std::io::Result<()> {
        let json = serde_json::to_string(self).map_err(std::io::Error::other)?;
        tokio::fs::write(Self::path(file), json).await
    }

    /// The marker beside `file`. One that is missing or unreadable means no upload yet; so does
    /// one that does not parse, which is logged.
    pub fn read(file: &Path) -> Option<Self> {
        let path = Self::path(file);
        let text = std::fs::read_to_string(&path).ok()?;
        match serde_json::from_str(&text) {
            Ok(marker) => Some(marker),
            Err(error) => {
                warn!(path = %path.display(), %error, "ignoring an upload marker that does not parse");
                None
            }
        }
    }

    /// Whether the upload was created with these credentials. An upload made for other ones (a
    /// different video) must not be resumed with them.
    pub fn created_with(&self, tus: &lare_bunny::TusCredentials) -> bool {
        self.headers == serde_json::to_value(&tus.headers).unwrap_or_default()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadProgress {
    job_id: String,
    uploaded: u64,
    total: u64,
}

/// Reports an upload's progress to the webview as `upload:progress` events for `job_id`.
pub fn progress_reporter(app: AppHandle, job_id: String) -> impl FnMut(lare_bunny::UploadProgress) {
    move |progress| {
        events::emit(
            &app,
            events::UPLOAD_PROGRESS,
            UploadProgress {
                job_id: job_id.clone(),
                uploaded: progress.uploaded,
                total: progress.total,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tus(endpoint: &str, signature: &str) -> lare_bunny::TusCredentials {
        lare_bunny::TusCredentials {
            endpoint: endpoint.to_string(),
            headers: [("AuthorizationSignature".to_string(), signature.to_string())].into(),
            metadata: lare_bunny::TusMetadata {
                filetype: "video/mp4".into(),
                title: "t".into(),
            },
        }
    }

    #[test]
    fn uploads_only_go_to_bunny_stream() {
        assert!(pinned_tus(&tus(BUNNY_TUS_ENDPOINT, "s")).is_ok());
        assert!(pinned_tus(&tus("https://video.bunnycdn.com.evil.test/tusupload", "s")).is_err());
        assert!(pinned_tus(&tus("http://video.bunnycdn.com/tusupload", "s")).is_err());
        assert!(pinned_upload_url("https://video.bunnycdn.com/tusupload/abc").is_ok());
        assert!(pinned_upload_url("https://evil.test/tusupload/abc").is_err());
        assert!(pinned_upload_url("https://video.bunnycdn.com:8443/tusupload/abc").is_err());
        assert!(pinned_upload_url("not a url").is_err());
    }

    #[tokio::test]
    async fn a_marker_is_read_back_and_only_matches_the_credentials_it_was_made_with() {
        let dir = std::env::temp_dir().join(format!("lare-upload-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("capture.mp4");
        assert!(UploadMarker::read(&file).is_none());

        let url = "https://video.bunnycdn.com/tusupload/abc";
        let made_with = tus(BUNNY_TUS_ENDPOINT, "first");
        UploadMarker::new(url, &made_with)
            .write(&file)
            .await
            .unwrap();
        let marker = UploadMarker::read(&file).expect("marker written beside the file");
        assert_eq!(marker.upload_url, url);
        assert!(marker.created_with(&made_with));
        assert!(!marker.created_with(&tus(BUNNY_TUS_ENDPOINT, "second")));

        // The shapes that are already on disk: with headers, and with the URL alone.
        let on_disk = std::fs::read_to_string(dir.join("capture.upload.json")).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&on_disk).unwrap(),
            serde_json::json!({ "uploadUrl": url, "headers": { "AuthorizationSignature": "first" } })
        );
        std::fs::write(dir.join("capture.upload.json"), r#"{"uploadUrl":"u"}"#).unwrap();
        let bare = UploadMarker::read(&file).expect("a marker without headers still reads");
        assert_eq!(bare.upload_url, "u");
        assert!(!bare.created_with(&made_with));

        std::fs::write(dir.join("capture.upload.json"), "not json").unwrap();
        assert!(UploadMarker::read(&file).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
