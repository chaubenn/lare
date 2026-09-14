//! Import only signed Bunny MP4 copies into a fresh, private local studio project.
use std::sync::Arc;
use futures_util::StreamExt;
use tauri::State;
use tokio::io::AsyncWriteExt;
use crate::recorder::{CompletedPayload, Purpose, Recorder};

#[tauri::command]
pub async fn import_cloud_source(
    rec: State<'_, Arc<Recorder>>,
    url: String,
) -> Result<CompletedPayload, String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "Invalid source URL")?;
    let host = url.host_str().unwrap_or("");
    let parts: Vec<_> = url.path().split('/').collect();
    if url.scheme() != "https" || !host.ends_with(".b-cdn.net")
        || host.trim_end_matches(".b-cdn.net").contains('.')
        || url.port().is_some() || !url.username().is_empty() || url.password().is_some()
        || parts.len() != 3 || uuid::Uuid::parse_str(parts[1]).is_err()
        || !["play_240p.mp4", "play_360p.mp4", "play_480p.mp4", "play_720p.mp4", "play_1080p.mp4"].contains(&parts[2])
        || !url.query_pairs().any(|(k,v)| k == "token" && v.starts_with("HS256-"))
    {
        return Err("Only signed Bunny MP4 sources are supported".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let project = rec.recordings_dir().join(&id);
    let segment = project.join("content/segments/segment-0");
    tokio::fs::create_dir_all(&segment).await.map_err(|e| e.to_string())?;
    let result = async {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(3600))
            .build().map_err(|_| "Could not initialize download")?;
        let response = client.get(url).send().await.map_err(|_| "Source download failed; retry to renew the link")?;
        if response.status() != reqwest::StatusCode::OK { return Err("Source unavailable; retry to renew the link".to_string()); }
        const MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;
        if response.content_length().is_some_and(|n| n > MAX_BYTES) { return Err("Source exceeds the 4 GiB import limit".into()); }
        let path = segment.join("display.mp4");
        let mut file = tokio::fs::File::create(&path).await.map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut received = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Source download interrupted")?;
            received += chunk.len() as u64;
            if received > MAX_BYTES { return Err("Source exceeds the 4 GiB import limit".into()); }
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        }
        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);
        let project = project.clone();
        tokio::task::spawn_blocking(move || -> Result<CompletedPayload, String> {
            let info = lare_recording::thumbnail::probe(&path).map_err(|_| "Downloaded source is not supported video")?;
            let duration = info.duration_ms.filter(|d| *d > 0).ok_or("Source has no duration")?;
            if info.width.unwrap_or(0) == 0 || info.height.unwrap_or(0) == 0 { return Err("Source has no video track".into()); }
            let audio = info.has_audio.then(|| serde_json::json!({"path": "content/segments/segment-0/audio-input.m4a"}));
            if info.has_audio { std::fs::hard_link(&path, segment.join("audio-input.m4a")).map_err(|e| e.to_string())?; }
            let mut meta: lare_recording::RecordingMeta = serde_json::from_value(serde_json::json!({
                "pretty_name": "Imported encoded MP4",
                "segments": [{"display": {"path": "content/segments/segment-0/display.mp4"}, "audio": audio}],
                "cursors": {}, "status": {"status": "Complete"}
            })).map_err(|e| e.to_string())?;
            meta.project_path = project.clone();
            meta.save_for_project().map_err(|e| e.to_string())?;
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64;
            let recording = CompletedPayload { recording_id: id, session_id: None, purpose: Purpose::Demo,
                mode: lare_recording::RecordingMode::Studio, project_path: project.clone(), output_mp4: Some(path),
                mic_track: None, started_at: now, ended_at: now + duration, post_id: None, facecam: false, recorded_ms: duration };
            std::fs::write(project.join("lare-recording.json"), serde_json::to_vec(&recording).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            Ok(recording)
        }).await.map_err(|e| e.to_string())?
    }.await;
    if result.is_err() { let _ = tokio::fs::remove_dir_all(&project).await; }
    result
}
