//! End-to-end test of the TUS client against an in-process mock server that
//! implements creation, HEAD offset lookup, PATCH with offset validation, and
//! injects a transient failure to exercise the retry path.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{head, patch, post};
use axum::Router;
use lare_bunny::{TusCredentials, TusMetadata, upload_file};

#[derive(Default)]
struct MockState {
    uploads: Mutex<HashMap<String, (u64, Vec<u8>)>>, // id -> (declared length, bytes)
    fail_next_patch: AtomicUsize,
    seen_auth: Mutex<Vec<(String, String)>>,
}

async fn create(State(st): State<Arc<MockState>>, headers: HeaderMap) -> Response {
    let len: u64 = headers
        .get("Upload-Length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let sig = headers
        .get("AuthorizationSignature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let video = headers
        .get("VideoId")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    st.seen_auth.lock().unwrap().push((sig, video));
    assert!(
        headers
            .get("Upload-Metadata")
            .and_then(|v| v.to_str().ok())
            .map(|m| m.starts_with("filetype ") && m.contains(",title "))
            .unwrap_or(false),
        "metadata header must carry filetype and title"
    );
    let id = format!("upl{}", st.uploads.lock().unwrap().len() + 1);
    st.uploads
        .lock()
        .unwrap()
        .insert(id.clone(), (len, Vec::new()));
    (
        StatusCode::CREATED,
        [("Location", format!("/tusupload/{id}")), ("Tus-Resumable", "1.0.0".into())],
    )
        .into_response()
}

async fn head_offset(State(st): State<Arc<MockState>>, Path(id): Path<String>) -> Response {
    let uploads = st.uploads.lock().unwrap();
    match uploads.get(&id) {
        Some((len, bytes)) => (
            StatusCode::OK,
            [
                ("Upload-Offset", bytes.len().to_string()),
                ("Upload-Length", len.to_string()),
                ("Tus-Resumable", "1.0.0".into()),
            ],
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn patch_chunk(
    State(st): State<Arc<MockState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if st.fail_next_patch.load(Ordering::SeqCst) > 0 {
        st.fail_next_patch.fetch_sub(1, Ordering::SeqCst);
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let offset: u64 = headers
        .get("Upload-Offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(u64::MAX);
    assert_eq!(
        headers.get("Content-Type").and_then(|v| v.to_str().ok()),
        Some("application/offset+octet-stream")
    );
    let mut uploads = st.uploads.lock().unwrap();
    let Some((_, bytes)) = uploads.get_mut(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if offset != bytes.len() as u64 {
        return StatusCode::CONFLICT.into_response();
    }
    bytes.extend_from_slice(&body);
    (
        StatusCode::NO_CONTENT,
        [("Upload-Offset", bytes.len().to_string()), ("Tus-Resumable", "1.0.0".into())],
    )
        .into_response()
}

async fn spawn_server(state: Arc<MockState>) -> String {
    let app = Router::new()
        .route("/tusupload", post(create))
        .route("/tusupload/{id}", head(head_offset))
        .route("/tusupload/{id}", patch(patch_chunk))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}/tusupload")
}

fn creds(endpoint: String) -> TusCredentials {
    let mut headers = BTreeMap::new();
    headers.insert("AuthorizationSignature".into(), "sig123".into());
    headers.insert("AuthorizationExpire".into(), "9999999999".into());
    headers.insert("LibraryId".into(), "743884".into());
    headers.insert("VideoId".into(), "11111111-2222-3333-4444-555555555555".into());
    TusCredentials {
        endpoint,
        headers,
        metadata: TusMetadata {
            filetype: "video/mp4".into(),
            title: "Two Sum demo".into(),
        },
    }
}

#[tokio::test]
async fn uploads_in_chunks_and_recovers_from_a_transient_failure() {
    let state = Arc::new(MockState::default());
    state.fail_next_patch.store(1, Ordering::SeqCst);
    let endpoint = spawn_server(state.clone()).await;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("demo.mp4");
    let payload: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(&path, &payload).unwrap();

    let client = reqwest::Client::new();
    let mut progress = Vec::new();
    let url = upload_file(&client, &path, &creds(endpoint), None, 64 * 1024, |p| {
        progress.push(p.uploaded)
    })
    .await
    .expect("upload succeeds");

    assert!(url.ends_with("/tusupload/upl1"), "absolute upload url: {url}");
    let uploads = state.uploads.lock().unwrap();
    let (declared, bytes) = uploads.get("upl1").unwrap();
    assert_eq!(*declared, payload.len() as u64);
    assert_eq!(bytes, &payload, "server must hold the exact file bytes");
    assert_eq!(progress.last().copied(), Some(payload.len() as u64));
    assert!(progress.windows(2).all(|w| w[0] <= w[1]), "progress is monotonic");
    let auth = state.seen_auth.lock().unwrap();
    assert_eq!(auth[0], ("sig123".to_string(), "11111111-2222-3333-4444-555555555555".to_string()));
}

#[tokio::test]
async fn resumes_from_server_offset() {
    let state = Arc::new(MockState::default());
    let endpoint = spawn_server(state.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("demo.mp4");
    let payload: Vec<u8> = (0..150_000u32).map(|i| (i % 199) as u8).collect();
    std::fs::write(&path, &payload).unwrap();

    // Pretend a previous attempt uploaded the first 100k bytes.
    state.uploads.lock().unwrap().insert(
        "upl9".into(),
        (payload.len() as u64, payload[..100_000].to_vec()),
    );
    let resume = format!("{}/upl9", endpoint);
    let client = reqwest::Client::new();
    let mut first_progress = None;
    let url = upload_file(&client, &path, &creds(endpoint), Some(&resume), 32 * 1024, |p| {
        first_progress.get_or_insert(p.uploaded);
    })
    .await
    .unwrap();
    assert_eq!(url, resume);
    assert_eq!(first_progress, Some(100_000));
    let uploads = state.uploads.lock().unwrap();
    assert_eq!(uploads.get("upl9").unwrap().1, payload);
}

#[tokio::test]
async fn recreates_when_resume_target_is_gone() {
    let state = Arc::new(MockState::default());
    let endpoint = spawn_server(state.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("demo.mp4");
    std::fs::write(&path, vec![7u8; 10_000]).unwrap();
    let client = reqwest::Client::new();
    let url = upload_file(
        &client,
        &path,
        &creds(endpoint.clone()),
        Some(&format!("{endpoint}/missing")),
        4096,
        |_| {},
    )
    .await
    .unwrap();
    assert!(url.ends_with("/upl1"));
    assert_eq!(state.uploads.lock().unwrap().get("upl1").unwrap().1.len(), 10_000);
}
