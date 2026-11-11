//! The connected extension clients, and the channel that tells the app layer what happened.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use lare_core::protocol::AppToExt;
use tokio::sync::mpsc;

use crate::sync::lock;

/// Something the frontend should hear about. Forwarded as Tauri events by `lib.rs`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerEvent {
    /// `GET /auth/callback?code=...` -> Tauri event `auth:callback`.
    AuthCallback { code: String, next: Option<String> },
    /// `GET /auth/callback?error=...` -> Tauri event `auth:error`.
    AuthError {
        error: String,
        description: Option<String>,
    },
    /// Connected-client state changed -> Tauri event `ext:connected`.
    ExtConnected(bool),
}

/// Registry of connected extension clients plus the event channel to the app layer.
#[derive(Clone)]
pub struct WsHub {
    inner: Arc<HubInner>,
}

struct HubInner {
    clients: Mutex<HashMap<u64, mpsc::UnboundedSender<AppToExt>>>,
    next_id: AtomicU64,
    events: mpsc::UnboundedSender<ServerEvent>,
}

impl WsHub {
    pub fn new() -> (Self, mpsc::UnboundedReceiver<ServerEvent>) {
        let (events, rx) = mpsc::unbounded_channel();
        let hub = Self {
            inner: Arc::new(HubInner {
                clients: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                events,
            }),
        };
        (hub, rx)
    }

    /// Number of extension clients that completed the pairing handshake.
    pub fn client_count(&self) -> usize {
        lock(&self.inner.clients).len()
    }

    pub fn connected(&self) -> bool {
        self.client_count() > 0
    }

    /// Send a frame to every connected client. Returns how many clients it was queued for.
    pub fn broadcast(&self, msg: AppToExt) -> usize {
        let mut clients = lock(&self.inner.clients);
        // Drop clients whose writer task is gone.
        clients.retain(|_, tx| tx.send(msg.clone()).is_ok());
        clients.len()
    }

    /// Raise an event for the app layer (ignored if nobody is listening).
    pub fn emit(&self, event: ServerEvent) {
        let _ = self.inner.events.send(event);
    }

    pub(super) fn register(&self, tx: mpsc::UnboundedSender<AppToExt>) -> u64 {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        lock(&self.inner.clients).insert(id, tx);
        self.emit(ServerEvent::ExtConnected(true));
        id
    }

    pub(super) fn unregister(&self, id: u64) {
        let still_connected = {
            let mut clients = lock(&self.inner.clients);
            clients.remove(&id);
            !clients.is_empty()
        };
        self.emit(ServerEvent::ExtConnected(still_connected));
    }
}
