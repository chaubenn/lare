//! A server on an ephemeral port and a client that pairs the way the extension does, shared by
//! the tests of every route.

use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use lare_core::{PROTOCOL_VERSION, protocol::RecordingSnapshot};
use ring::hmac;
use serde_json::json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::mpsc::UnboundedReceiver,
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{self, client::IntoClientRequest, http::HeaderValue},
};

use super::bridge::{EXTENSION_ID, EXTENSION_SCHEME};
use super::hub::{ServerEvent, WsHub};
use super::pairing::{BridgeKeyInput, pairing_transcript, to_hex};
use super::{ServerContext, bind, serve};
use crate::preview::PreviewFiles;
use crate::recording::{RecordingBackend, RecordingRequest};

pub type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub struct TestServer {
    pub addr: SocketAddr,
    pub ctx: ServerContext,
    pub events: UnboundedReceiver<ServerEvent>,
}

pub const TEST_USER: &str = "user-123";
pub const TEST_INSTALL: &str = "6f1c1d2e-5a4b-4c3d-8e2f-1a0b9c8d7e6f";
pub const TEST_SECRET: [u8; 32] = [7; 32];

/// `Origin` of the pinned-id extension, which a release build accepts.
pub fn extension_origin() -> String {
    format!("{EXTENSION_SCHEME}{EXTENSION_ID}")
}

pub async fn start(allow_any_origin: bool) -> TestServer {
    start_with(allow_any_origin, &[]).await
}

/// A server signed in as [`TEST_USER`] and paired with [`TEST_SECRET`].
pub async fn start_with(allow_any_origin: bool, extra_extension_ids: &[&str]) -> TestServer {
    let (hub, events) = WsHub::new();
    let mut ctx = ServerContext::new(
        hub,
        Arc::new(Mutex::new(Some(TEST_USER.to_string()))),
        "0.0.0-test",
        PreviewFiles::new(),
    );
    ctx.allow_any_extension_origin = allow_any_origin;
    ctx.extension_ids
        .extend(extra_extension_ids.iter().map(|id| id.to_string()));
    ctx.pairing
        .set_bridge_key(Some(BridgeKeyInput {
            user_id: TEST_USER.into(),
            install_id: TEST_INSTALL.into(),
            secret: to_hex(&TEST_SECRET),
        }))
        .unwrap();
    let (listener, addr) = bind("127.0.0.1:0".parse().unwrap()).await.unwrap();
    tokio::spawn(serve(listener, ctx.clone()));
    TestServer { addr, ctx, events }
}

pub async fn connect(addr: SocketAddr, origin: Option<&str>) -> tungstenite::Result<Client> {
    let mut request = format!("ws://{addr}/").into_client_request()?;
    if let Some(origin) = origin {
        request
            .headers_mut()
            .insert("Origin", HeaderValue::from_str(origin).unwrap());
    }
    let (client, _response) = connect_async(request).await?;
    Ok(client)
}

pub async fn send_json(client: &mut Client, value: serde_json::Value) {
    client
        .send(tungstenite::Message::text(value.to_string()))
        .await
        .unwrap();
}

pub async fn recv_json(client: &mut Client) -> serde_json::Value {
    let frame = tokio::time::timeout(Duration::from_secs(5), client.next())
        .await
        .expect("timed out waiting for a frame")
        .expect("stream ended")
        .expect("read error");
    let text = frame.to_text().expect("text frame");
    serde_json::from_str(text).expect("valid json")
}

/// The server hangs up: the next item is a Close frame or the end of the stream.
pub async fn assert_closed(client: &mut Client) {
    let next = tokio::time::timeout(Duration::from_secs(5), client.next())
        .await
        .unwrap();
    assert!(matches!(
        next,
        None | Some(Ok(tungstenite::Message::Close(_))) | Some(Err(_))
    ));
}

/// Wait until the server has handled every frame sent so far, and check it answered none of
/// them: frames are handled in order, so the next thing back must be the pong to this ping.
pub async fn handled(client: &mut Client) {
    send_json(client, json!({ "type": "ping", "at": 7 })).await;
    assert_eq!(recv_json(client).await, json!({ "type": "pong", "at": 7 }));
}

fn proof(role: &str, secret: &[u8], ext_nonce: &str, app_nonce: &str) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret);
    let transcript = pairing_transcript(role, TEST_USER, ext_nonce, app_nonce);
    to_hex(hmac::sign(&key, transcript.as_bytes()).as_ref())
}

/// Say hello as [`TEST_USER`]; returns our nonce and the server's reply.
pub async fn hello(client: &mut Client, protocol: u32) -> (String, serde_json::Value) {
    let nonce = to_hex(&[0x5a; 32]);
    send_json(
        client,
        json!({ "type": "hello", "protocol": protocol, "extVersion": "0.1.0", "userId": TEST_USER, "nonce": nonce }),
    )
    .await;
    let reply = recv_json(client).await;
    (nonce, reply)
}

/// Answer `challenge` with a proof made from `secret`; returns the server's reply.
pub async fn answer(
    client: &mut Client,
    ext_nonce: &str,
    challenge: &serde_json::Value,
    secret: &[u8],
) -> serde_json::Value {
    let app_nonce = challenge["nonce"].as_str().expect("challenge nonce");
    send_json(
        client,
        json!({ "type": "auth.response", "proof": proof("ext", secret, ext_nonce, app_nonce) }),
    )
    .await;
    recv_json(client).await
}

/// Pair over an open socket the way the extension does; returns the `hello.ack`.
pub async fn pair(client: &mut Client, protocol: u32) -> serde_json::Value {
    let (nonce, challenge) = hello(client, protocol).await;
    assert_eq!(challenge["type"], "auth.challenge", "{challenge}");
    let app_nonce = challenge["nonce"].as_str().unwrap();
    assert_eq!(
        challenge["proof"],
        proof("app", &TEST_SECRET, &nonce, app_nonce),
        "the app proves it holds the secret before the extension says anything"
    );
    answer(client, &nonce, &challenge, &TEST_SECRET).await
}

/// Connect (no Origin) and complete the handshake; returns the client + the ack.
pub async fn handshake(addr: SocketAddr) -> (Client, serde_json::Value) {
    let mut client = connect(addr, None).await.unwrap();
    let ack = pair(&mut client, PROTOCOL_VERSION).await;
    (client, ack)
}

pub async fn http_get(addr: SocketAddr, path: &str) -> (u16, String) {
    http_get_with(addr, path, &[]).await
}

pub async fn http_get_with(
    addr: SocketAddr,
    path: &str,
    headers: &[(&str, &str)],
) -> (u16, String) {
    let mut stream = TcpStream::connect(addr).await.unwrap();
    let extra: String = headers
        .iter()
        .map(|(k, v)| format!("{k}: {v}\r\n"))
        .collect();
    stream
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\n{extra}Connection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .unwrap();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    let text = String::from_utf8_lossy(&buf).into_owned();
    let status = text
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .expect("status line");
    let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
    (status, body)
}

pub async fn next_event(events: &mut UnboundedReceiver<ServerEvent>) -> ServerEvent {
    tokio::time::timeout(Duration::from_secs(5), events.recv())
        .await
        .expect("timed out waiting for a server event")
        .expect("event channel closed")
}

pub async fn no_event(events: &mut UnboundedReceiver<ServerEvent>) {
    let got = tokio::time::timeout(Duration::from_millis(200), events.recv()).await;
    assert!(got.is_err(), "unexpected server event {got:?}");
}

/// A recorder that only notes what it was asked to do.
#[derive(Default)]
pub struct FakeRecorder {
    pub started: Mutex<Vec<RecordingRequest>>,
    pub stopped: Mutex<Vec<String>>,
    pub cancelled: Mutex<Vec<String>>,
    pub snapshot: Mutex<Option<RecordingSnapshot>>,
}

impl RecordingBackend for FakeRecorder {
    fn start(&self, req: RecordingRequest) {
        self.started.lock().unwrap().push(req);
    }
    fn pause(&self, _session_id: &str, _at: u64) {}
    fn resume(&self, _session_id: &str, _at: u64) {}
    fn stop(&self, session_id: &str, _at: u64) {
        self.stopped.lock().unwrap().push(session_id.to_string());
    }
    fn cancel(&self, session_id: &str, _at: u64) {
        self.cancelled.lock().unwrap().push(session_id.to_string());
    }
    fn snapshot(&self) -> Option<RecordingSnapshot> {
        self.snapshot.lock().unwrap().clone()
    }
}
