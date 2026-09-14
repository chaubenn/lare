//! Local-only rolling Whisper service. Cloud requests contain text, never audio.
use anyhow::{Context, anyhow};
use lare_transcribe::{RollingTranscriber, Segment};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAuth {
    pub user_id: String,
    pub token: String,
    pub url: String,
    pub key: String,
}

pub struct Session {
    user: String,
    engine: Option<Arc<Mutex<RollingTranscriber>>>,
    completed_samples: u64,
    touched: Instant,
    ended: bool,
    complete: bool,
    persisted: usize,
}

#[derive(Default)]
pub struct PcmService {
    pub auth: Mutex<Option<CloudAuth>>,
    pub model: Mutex<Option<PathBuf>>,
    sessions: tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<Session>>>>,
}

impl PcmService {
    pub fn capable(&self) -> bool {
        self.auth.lock().is_ok_and(|a| a.is_some())
            && self
                .model
                .lock()
                .is_ok_and(|p| p.as_ref().is_some_and(|p| p.is_file()))
    }

    fn credentials(&self, user: &str) -> anyhow::Result<CloudAuth> {
        self.auth
            .lock()
            .map_err(|_| anyhow!("auth lock"))?
            .clone()
            .filter(|a| a.user_id == user)
            .ok_or_else(|| anyhow!("Sign in to the same desktop account to enable grading"))
    }

    pub async fn start(&self, v: &Value, user: &str) -> anyhow::Result<String> {
        let auth = self.credentials(user)?;
        anyhow::ensure!(
            v["userId"] == user
                && v["sampleRate"] == 16000
                && v["channels"] == 1
                && v["format"] == "f32le",
            "Expected authenticated 16kHz mono f32le PCM"
        );
        let id = v["sessionId"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 100)
            .context("Missing sessionId")?
            .to_string();
        let client = reqwest::Client::new();
        let rows: Vec<Value> = client
            .get(format!("{}/rest/v1/sessions", auth.url))
            .query(&[
                ("id", format!("eq.{id}")),
                ("user_id", format!("eq.{user}")),
                ("select", "id,kind,graded".into()),
            ])
            .header("apikey", &auth.key)
            .bearer_auth(&auth.token)
            .timeout(Duration::from_secs(20))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        anyhow::ensure!(
            rows.first()
                .is_some_and(|r| r["kind"] == "interview" && r["graded"] == true),
            "Graded interview does not belong to the desktop user"
        );
        let mut sessions = self.sessions.lock().await;
        if let Some(s) = sessions.get(&id) {
            anyhow::ensure!(s.lock().await.user == user, "Session account mismatch");
            return Ok(id);
        }
        sessions.retain(|_, s| {
            s.try_lock()
                .map(|s| s.touched.elapsed() < Duration::from_secs(6 * 3600))
                .unwrap_or(true)
        });
        anyhow::ensure!(
            sessions
                .values()
                .filter(|s| s.try_lock().map(|s| !s.complete).unwrap_or(true))
                .count()
                < 4,
            "Too many retained transcription sessions; restart desktop to release them"
        );
        let model = self
            .model
            .lock()
            .map_err(|_| anyhow!("model lock"))?
            .clone()
            .context("Download a speech model in desktop settings first")?;
        let engine = tokio::task::spawn_blocking(move || RollingTranscriber::new(&model)).await??;
        sessions.insert(
            id.clone(),
            Arc::new(tokio::sync::Mutex::new(Session {
                user: user.into(),
                engine: Some(Arc::new(Mutex::new(engine))),
                completed_samples: 0,
                touched: Instant::now(),
                ended: false,
                complete: false,
                persisted: 0,
            })),
        );
        Ok(id)
    }

    pub async fn next_sample(&self, id: &str) -> anyhow::Result<u64> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(id)
            .context("Unknown PCM session")?
            .lock()
            .await;
        let next = match &session.engine {
            Some(engine) => {
                engine
                    .lock()
                    .map_err(|_| anyhow!("transcription lock"))?
                    .next_sample
            }
            None => session.completed_samples,
        };
        Ok(next)
    }

    pub async fn push(
        &self,
        id: &str,
        user: &str,
        bytes: &[u8],
        total: Option<u64>,
        hub: &crate::ws_server::WsHub,
    ) -> anyhow::Result<Vec<Value>> {
        let auth = self.credentials(user)?;
        anyhow::ensure!(
            bytes.len() % 4 == 0 && bytes.len() <= 16000 * 4 * 30,
            "Invalid PCM frame size"
        );
        let samples: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        anyhow::ensure!(samples.iter().all(|s| s.is_finite()), "Invalid PCM samples");
        let session = self
            .sessions
            .lock()
            .await
            .get(id)
            .cloned()
            .context("Send pcm.start first")?;
        let mut session = session.lock().await;
        anyhow::ensure!(session.user == user, "Session account mismatch");
        session.touched = Instant::now();
        if session.complete {
            anyhow::ensure!(
                bytes.is_empty() && total == Some(session.completed_samples),
                "PCM session already completed"
            );
            return Ok(vec![json!({"type":"pcm.complete", "sessionId":id})]);
        }
        let engine = session
            .engine
            .as_ref()
            .context("Missing transcription engine")?
            .clone();
        if let Some(total) = total {
            anyhow::ensure!(
                engine
                    .lock()
                    .map_err(|_| anyhow!("transcription lock"))?
                    .next_sample
                    == total,
                "PCM sample count mismatch; replay missing audio before ending"
            );
        }
        if !session.ended {
            let engine = engine.clone();
            tokio::task::spawn_blocking(move || {
                engine
                    .lock()
                    .map_err(|_| anyhow!("transcription lock"))?
                    .push(&samples, total.is_some())
            })
            .await??;
            session.ended = total.is_some();
        } else {
            anyhow::ensure!(bytes.is_empty(), "PCM session already ended");
        }
        let (next, segments): (u64, Vec<Segment>) = {
            let engine = engine.lock().map_err(|_| anyhow!("transcription lock"))?;
            (engine.next_sample, engine.segments.clone())
        };
        let mut out = Vec::new();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()?;
        if segments.len() != session.persisted || total.is_some() {
            client.post(format!("{}/rest/v1/rpc/upsert_transcript_segments", auth.url))
                .header("apikey", &auth.key).bearer_auth(&auth.token)
                .json(&json!({"p_session_id":id,"p_model":"whisper.cpp local rolling","p_language":"en","p_segments":&segments[session.persisted..]}))
                .send().await?.error_for_status()?;
            session.persisted = segments.len();
            out.push(json!({"type":"transcript.partial","sessionId":id,"text":segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" "),"segments":segments}));
        }
        if total.is_some() {
            anyhow::ensure!(
                !segments.is_empty(),
                "No speech was transcribed; this interview cannot be graded"
            );
            // Completion acknowledges the persisted transcript and scheduled review, not an LLM
            // response that can exceed the extension's 45-second stop deadline.
            let request = client
                .post(format!("{}/functions/v1/ai-review", auth.url))
                .header("apikey", &auth.key)
                .bearer_auth(&auth.token)
                .json(&json!({"sessionId":id}))
                .build()?;
            let hub = hub.clone();
            let review_id = id.to_string();
            tokio::spawn(async move {
                let result = client
                    .execute(request)
                    .await
                    .and_then(|response| response.error_for_status());
                let event = match result {
                    Ok(_) => json!({"type":"review.complete", "sessionId":review_id}),
                    Err(error) => {
                        json!({"type":"review.error", "sessionId":review_id, "message":format!("AI review failed: {error}. Retry from the session page.")})
                    }
                };
                hub.emit(crate::ws_server::ServerEvent::ExtMessage(event));
            });
            session.complete = true;
            session.completed_samples = next;
            session.engine = None;
            out.push(json!({"type":"pcm.complete","sessionId":id}));
        } else {
            out.push(json!({"type":"pcm.ack","sessionId":id,"nextSample":next}));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authenticated() -> PcmService {
        let service = PcmService::default();
        *service.auth.lock().unwrap() = Some(CloudAuth {
            user_id: "owner".into(),
            token: "test".into(),
            url: "http://127.0.0.1:1".into(),
            key: "test".into(),
        });
        service
    }

    #[tokio::test]
    async fn rejects_invalid_samples_and_account_changes_before_accepting_audio() {
        let service = authenticated();
        let (hub, _) = crate::ws_server::WsHub::new();
        for bytes in [
            vec![0; 3],
            f32::NAN.to_le_bytes().to_vec(),
            vec![0; 16000 * 4 * 30 + 4],
        ] {
            assert!(
                service
                    .push("s1", "owner", &bytes, None, &hub)
                    .await
                    .unwrap_err()
                    .to_string()
                    .contains("Invalid PCM")
            );
        }
        assert!(
            service
                .push("s1", "other", &[], None, &hub)
                .await
                .unwrap_err()
                .to_string()
                .contains("same desktop account")
        );
        assert!(!service.capable());
    }

    #[tokio::test]
    async fn completed_session_replays_receipt_without_retaining_a_model() {
        let service = authenticated();
        let (hub, _) = crate::ws_server::WsHub::new();
        service.sessions.lock().await.insert(
            "s1".into(),
            Arc::new(tokio::sync::Mutex::new(Session {
                user: "owner".into(),
                engine: None,
                completed_samples: 32000,
                touched: Instant::now(),
                ended: true,
                complete: true,
                persisted: 1,
            })),
        );
        assert_eq!(service.next_sample("s1").await.unwrap(), 32000);
        assert_eq!(
            service
                .push("s1", "owner", &[], Some(32000), &hub)
                .await
                .unwrap()[0]["type"],
            "pcm.complete"
        );
        assert!(
            service
                .push("s1", "owner", &[], Some(16000), &hub)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn ungraded_cloud_session_is_rejected_before_loading_whisper() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                axum::Router::new().route(
                    "/rest/v1/sessions",
                    axum::routing::get(|| async {
                        axum::Json(json!([{"id":"s1", "kind":"interview", "graded":false}]))
                    }),
                ),
            )
            .await
            .unwrap();
        });
        let service = authenticated();
        service.auth.lock().unwrap().as_mut().unwrap().url = format!("http://{address}");
        let error = service.start(&json!({"sessionId":"s1", "userId":"owner", "sampleRate":16000, "channels":1, "format":"f32le"}), "owner").await.unwrap_err();
        assert!(error.to_string().contains("Graded interview"));
        server.abort();
    }
}
