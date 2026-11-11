//! The pairing handshake that admits the extension (see the [module docs](super)): the secret the
//! webview hands over, the HMAC transcript both sides sign, and the challenge/response itself.

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::extract::ws::WebSocket;
use lare_core::{
    PAIRING_DOMAIN,
    protocol::{AppToExt, ErrorCode, ExtToApp},
};
use ring::{
    hmac,
    rand::{SecureRandom, SystemRandom},
};
use serde::Deserialize;
use tracing::{error, warn};

use super::ServerContext;
use super::bridge::{recv_text, refuse, send_frame};
use crate::sync::lock;

/// How long the extension gets to answer `auth.challenge`. Longer than its own timeout for
/// fetching the pairing secret from Supabase, which it may have to do first.
const AUTH_RESPONSE_TIMEOUT: Duration = Duration::from_secs(20);

/// The pairing secret of the signed-in user, set from the webview (`set_bridge_key`).
#[derive(Clone, Default)]
pub struct PairingStore {
    key: Arc<Mutex<Option<PairingKey>>>,
}

#[derive(Clone)]
pub(super) struct PairingKey {
    pub(super) user_id: String,
    install_id: String,
    key: hmac::Key,
}

/// The pairing secret as the webview hands it over (`set_bridge_key`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeKeyInput {
    pub user_id: String,
    pub install_id: String,
    /// 32 bytes, hex: the `bridge_secrets.secret` the webview published for this install.
    pub secret: String,
}

impl PairingStore {
    /// Install the pairing secret for the signed-in user, or forget it (signed out) with `None`.
    pub fn set_bridge_key(&self, input: Option<BridgeKeyInput>) -> Result<(), String> {
        let pairing = match input {
            None => None,
            Some(input) => {
                let secret = from_hex(&input.secret)
                    .filter(|bytes| bytes.len() == 32)
                    .ok_or("the pairing secret must be 32 bytes of lowercase hex")?;
                let install_id = uuid::Uuid::parse_str(&input.install_id)
                    .map_err(|_| "the install id must be a UUID")?;
                if input.user_id.trim().is_empty() {
                    return Err("the pairing secret needs a user id".into());
                }
                Some(PairingKey {
                    user_id: input.user_id,
                    install_id: install_id.to_string(),
                    key: hmac::Key::new(hmac::HMAC_SHA256, &secret),
                })
            }
        };
        *lock(&self.key) = pairing;
        Ok(())
    }

    pub(super) fn key(&self) -> Option<PairingKey> {
        lock(&self.key).clone()
    }
}

/// Lowercase hex only, so a value has exactly one spelling inside the HMAC transcript.
fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 || !s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

pub(super) fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn is_nonce(s: &str) -> bool {
    from_hex(s).is_some_and(|bytes| bytes.len() == 32)
}

/// What each side's proof covers. `role` keeps one side's proof from ever passing as the other's.
pub(super) fn pairing_transcript(
    role: &str,
    user_id: &str,
    ext_nonce: &str,
    app_nonce: &str,
) -> String {
    format!("{PAIRING_DOMAIN}\n{role}\n{user_id}\n{ext_nonce}\n{app_nonce}")
}

/// The pairing handshake. Returns once the client has proved it holds this install's secret for
/// the signed-in user; anything else has been told why and should be dropped.
pub(super) async fn authenticate(
    socket: &mut WebSocket,
    ctx: &ServerContext,
    ext_user: Option<String>,
    ext_nonce: Option<String>,
) -> Option<()> {
    let Some(ext_nonce) = ext_nonce.filter(|n| is_nonce(n)) else {
        refuse(
            socket,
            ErrorCode::BadMessage,
            "hello needs a 32-byte hex nonce",
        )
        .await;
        return None;
    };
    let Some(pairing) = ctx.pairing_key() else {
        refuse(
            socket,
            ErrorCode::NotSignedIn,
            "the Lare desktop app is not signed in",
        )
        .await;
        return None;
    };
    // Turned away before the challenge, so a wrong account gets a precise answer. A forged client
    // can claim the right user id; it still has to answer the challenge.
    match ext_user {
        Some(user) if user == pairing.user_id => {}
        Some(_) => {
            warn!("extension user differs from desktop user");
            refuse(
                socket,
                ErrorCode::UserMismatch,
                "the desktop app is signed in to another account",
            )
            .await;
            return None;
        }
        None => {
            refuse(
                socket,
                ErrorCode::NotSignedIn,
                "the extension is not signed in",
            )
            .await;
            return None;
        }
    }

    let mut nonce = [0u8; 32];
    if SystemRandom::new().fill(&mut nonce).is_err() {
        error!("no randomness for the pairing challenge");
        return None;
    }
    let app_nonce = to_hex(&nonce);
    let app_proof = hmac::sign(
        &pairing.key,
        pairing_transcript("app", &pairing.user_id, &ext_nonce, &app_nonce).as_bytes(),
    );
    let challenge = AppToExt::AuthChallenge {
        install_id: pairing.install_id.clone(),
        nonce: app_nonce.clone(),
        proof: to_hex(app_proof.as_ref()),
    };
    if send_frame(socket, &challenge).await.is_err() {
        return None;
    }

    let raw = recv_text(socket, AUTH_RESPONSE_TIMEOUT).await?;
    let Ok(ExtToApp::AuthResponse { proof }) = serde_json::from_str::<ExtToApp>(&raw) else {
        refuse(socket, ErrorCode::BadMessage, "expected auth.response").await;
        return None;
    };
    let expected = pairing_transcript("ext", &pairing.user_id, &ext_nonce, &app_nonce);
    let valid = from_hex(&proof)
        .is_some_and(|tag| hmac::verify(&pairing.key, expected.as_bytes(), &tag).is_ok());
    if !valid {
        warn!("client failed the pairing challenge");
        refuse(
            socket,
            ErrorCode::AuthFailed,
            "the extension could not prove it is paired with this app",
        )
        .await;
        return None;
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use lare_core::PROTOCOL_VERSION;
    use serde_json::json;

    use super::super::bridge::EXTENSION_ID;
    use super::super::test_support::*;
    use super::*;

    #[tokio::test]
    async fn a_client_without_the_secret_is_refused_and_never_reaches_the_recorder() {
        let mut server = start(false).await;
        let recorder = Arc::new(FakeRecorder::default());
        server.ctx.set_recording_backend(Some(recorder.clone()));

        // The extension's Origin is easy to forge outside a browser; it is not enough.
        let mut client = connect(server.addr, Some(&extension_origin()))
            .await
            .unwrap();
        let (nonce, challenge) = hello(&mut client, PROTOCOL_VERSION).await;
        assert_eq!(challenge["type"], "auth.challenge");
        assert_eq!(challenge["installId"], TEST_INSTALL);
        let err = answer(&mut client, &nonce, &challenge, &[8; 32]).await;
        assert_eq!(err["code"], "auth_failed");
        assert_closed(&mut client).await;

        // Skipping the answer and going straight for the recorder does not work either.
        let mut client = connect(server.addr, Some(&extension_origin()))
            .await
            .unwrap();
        let _ = hello(&mut client, PROTOCOL_VERSION).await;
        send_json(
            &mut client,
            json!({ "type": "session.start", "sessionId": "s1", "kind": "interview", "scope": "problem",
                    "startedAt": 1u64, "problem": null, "facecam": false, "mic": true }),
        )
        .await;
        assert_eq!(recv_json(&mut client).await["code"], "bad_message");
        assert_closed(&mut client).await;

        // Reflecting the app's own proof back fails too: each side's proof names its role.
        let mut client = connect(server.addr, Some(&extension_origin()))
            .await
            .unwrap();
        let (_, challenge) = hello(&mut client, PROTOCOL_VERSION).await;
        send_json(
            &mut client,
            json!({ "type": "auth.response", "proof": challenge["proof"] }),
        )
        .await;
        assert_eq!(recv_json(&mut client).await["code"], "auth_failed");

        assert!(recorder.started.lock().unwrap().is_empty());
        assert_eq!(server.ctx.hub.client_count(), 0);
        no_event(&mut server.events).await;
    }

    #[tokio::test]
    async fn another_account_is_refused_before_any_challenge() {
        let server = start(true).await;
        let mut client = connect(server.addr, None).await.unwrap();
        send_json(
            &mut client,
            json!({ "type": "hello", "protocol": PROTOCOL_VERSION, "extVersion": "0.1.0",
                    "userId": "someone-else", "nonce": to_hex(&[1; 32]) }),
        )
        .await;
        assert_eq!(recv_json(&mut client).await["code"], "user_mismatch");
        assert_closed(&mut client).await;
    }

    #[tokio::test]
    async fn a_signed_out_app_or_extension_is_refused() {
        let server = start(true).await;
        let mut client = connect(server.addr, None).await.unwrap();
        send_json(
            &mut client,
            json!({ "type": "hello", "protocol": PROTOCOL_VERSION, "extVersion": "0.1.0",
                    "userId": null, "nonce": to_hex(&[1; 32]) }),
        )
        .await;
        assert_eq!(recv_json(&mut client).await["code"], "not_signed_in");

        // The app signed out: nothing can pair.
        *server.ctx.current_user.lock().unwrap() = None;
        let mut client = connect(server.addr, None).await.unwrap();
        let (_, reply) = hello(&mut client, PROTOCOL_VERSION).await;
        assert_eq!(reply["code"], "not_signed_in");

        // A secret left over from the previous account is not used for the next one.
        *server.ctx.current_user.lock().unwrap() = Some("next-user".into());
        let mut client = connect(server.addr, None).await.unwrap();
        let (_, reply) = hello(&mut client, PROTOCOL_VERSION).await;
        assert_eq!(reply["code"], "not_signed_in");
    }

    #[tokio::test]
    async fn hello_without_a_nonce_is_refused() {
        let server = start(true).await;
        let mut client = connect(server.addr, None).await.unwrap();
        send_json(
            &mut client,
            json!({ "type": "hello", "protocol": PROTOCOL_VERSION, "extVersion": "0.1.0", "userId": TEST_USER }),
        )
        .await;
        assert_eq!(recv_json(&mut client).await["code"], "bad_message");
    }

    /// The extension is tested against the same file (`packages/shared/src/session/protocol.test.ts`).
    #[test]
    fn pairing_matches_the_shared_bridge_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../packages/shared/fixtures/bridge.json"
        ))
        .unwrap();
        assert_eq!(fixture["constants"]["extensionId"], EXTENSION_ID);
        let case = &fixture["pairingTranscript"];
        let field = |name: &str| case[name].as_str().expect(name);
        assert_eq!(
            pairing_transcript(
                field("role"),
                field("userId"),
                field("extNonce"),
                field("appNonce")
            ),
            field("expected")
        );
    }

    #[test]
    fn pairing_secrets_must_be_32_bytes_of_lowercase_hex() {
        let store = PairingStore::default();
        let key = |secret: String| BridgeKeyInput {
            user_id: TEST_USER.into(),
            install_id: TEST_INSTALL.into(),
            secret,
        };
        let good = to_hex(&[0xab; 32]);
        assert!(store.set_bridge_key(Some(key(good.clone()))).is_ok());
        assert!(store.set_bridge_key(Some(key(to_hex(&[7; 16])))).is_err());
        assert!(
            store
                .set_bridge_key(Some(key(good.to_uppercase())))
                .is_err()
        );
        assert!(
            store
                .set_bridge_key(Some(key(format!("+{}", &good[1..]))))
                .is_err()
        );
        assert!(
            store.key().is_some(),
            "a rejected key leaves the previous one in place"
        );
        assert!(store.set_bridge_key(None).is_ok());
        assert!(store.key().is_none());
    }
}
