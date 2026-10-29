//! Compiles the production muxer and producer lifecycle without Cap/FFmpeg/GUI.
#![cfg(test)]
#[path = "../../src/fragmented.rs"]
mod fragmented;
#[path = "../../src/live.rs"]
mod live;

#[cfg(test)]
mod tests {
    use crate::{
        fragmented::tests::{fragment, init},
        live::{Fragment, LiveOutput},
    };
    use axum::{
        Router,
        body::Bytes,
        extract::State,
        http::{HeaderMap, StatusCode},
        response::IntoResponse,
        routing::post,
    };
    use std::{
        sync::{Arc, Mutex},
        time::Duration,
    };

    #[derive(Default)]
    struct Receipt {
        bytes: Vec<u8>,
        length: Option<u64>,
    }
    type Shared = Arc<Mutex<Receipt>>;

    async fn create(headers: HeaderMap) -> impl IntoResponse {
        assert_eq!(headers.get("Upload-Defer-Length").unwrap(), "1");
        (StatusCode::CREATED, [("Location", "/upload")])
    }
    async fn head(State(state): State<Shared>) -> impl IntoResponse {
        let receipt = state.lock().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            "Upload-Offset",
            receipt.bytes.len().to_string().parse().unwrap(),
        );
        if let Some(length) = receipt.length {
            headers.insert("Upload-Length", length.to_string().parse().unwrap());
        }
        (StatusCode::OK, headers)
    }
    async fn patch(
        State(state): State<Shared>,
        headers: HeaderMap,
        bytes: Bytes,
    ) -> impl IntoResponse {
        let mut receipt = state.lock().unwrap();
        assert_eq!(
            headers["Upload-Offset"]
                .to_str()
                .unwrap()
                .parse::<usize>()
                .unwrap(),
            receipt.bytes.len()
        );
        receipt.bytes.extend(bytes);
        if let Some(length) = headers.get("Upload-Length") {
            receipt.length = Some(length.to_str().unwrap().parse().unwrap());
        }
        (
            StatusCode::NO_CONTENT,
            [("Upload-Offset", receipt.bytes.len().to_string())],
        )
    }

    #[tokio::test]
    async fn uploads_combined_media_before_stop_and_declares_length_only_after_close() {
        let state = Shared::default();
        let router = Router::new()
            .route("/upload", post(create).head(head).patch(patch))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let creds = lare_bunny::TusCredentials {
            endpoint: format!("http://{addr}/upload"),
            headers: Default::default(),
            metadata: lare_bunny::TusMetadata {
                filetype: "video/mp4".into(),
                title: "capture".into(),
            },
        };
        let client = lare_bunny::http_client();
        let url = lare_bunny::create_deferred_upload(&client, &creds)
            .await
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("content")).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let live =
            LiveOutput::start(dir.path(), true, move |timeout| rx.recv_timeout(timeout)).unwrap();
        let completion = live.completion();
        let path = live.path.clone();
        let upload_path = path.clone();
        let upload = tokio::spawn(async move {
            lare_bunny::upload_growing_file(
                &client,
                &upload_path,
                &creds,
                &url,
                65536,
                completion,
                |_| {},
            )
            .await
        });
        for (name, track, index, is_init, data) in [
            ("vi", 0, 0, true, init(1, false)),
            // Video can arrive before the audio init. The producer queues paths, not sample buffers.
            ("v1", 0, 1, false, fragment(1, 0, b"video", 0x20000)),
            ("ai", 1, 0, true, init(1, true)),
            ("a1", 1, 1, false, fragment(1, 0, b"audio", 0x20000)),
        ] {
            let path = dir.path().join(name);
            std::fs::write(&path, data).unwrap();
            tx.send(Fragment {
                path,
                track,
                index,
                is_init,
            })
            .unwrap();
        }
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if state
                    .lock()
                    .unwrap()
                    .bytes
                    .windows(5)
                    .any(|v| v == b"audio")
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        let prefix = state.lock().unwrap().bytes.clone();
        assert_eq!(state.lock().unwrap().length, None);
        assert!(!upload.is_finished());
        let last = dir.path().join("v2");
        std::fs::write(&last, fragment(1, 3000, b"last-frame", 0x20000)).unwrap();
        tx.send(Fragment {
            path: last,
            track: 0,
            index: 2,
            is_init: false,
        })
        .unwrap();
        live.finish(true).await.unwrap(); // drains even while event sender is still alive
        tokio::time::timeout(Duration::from_secs(5), upload)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let output = std::fs::read(&path).unwrap();
        assert!(output.starts_with(&prefix));
        assert_eq!(state.lock().unwrap().bytes, output);
        assert_eq!(state.lock().unwrap().length, Some(output.len() as u64));
        assert!(path.with_extension("complete").exists());
        server.abort();
    }

    #[tokio::test]
    async fn failed_or_dropped_producers_never_signal_completion() {
        for abort in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            std::fs::create_dir(dir.path().join("content")).unwrap();
            let (tx, rx) = std::sync::mpsc::channel();
            let live =
                LiveOutput::start(dir.path(), false, move |timeout| rx.recv_timeout(timeout))
                    .unwrap();
            let mut completion = live.completion();
            if abort {
                drop(live);
            } else {
                drop(tx);
                assert!(live.finish(true).await.is_err());
            }
            assert!(completion.changed().await.is_err());
            assert!(!*completion.borrow());
            assert!(!dir.path().join("content/capture.complete").exists());
        }
    }
}
