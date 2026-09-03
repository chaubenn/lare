//! Shared, dependency-light types for Lare's Rust side.
//!
//! `protocol` mirrors `packages/shared/src/protocol.ts`; `edits` mirrors
//! `packages/shared/src/edits.ts`. Keep them in sync (see `PROTOCOL_VERSION`).

pub mod edits;
pub mod protocol;

/// Localhost port the desktop app listens on for the browser extension.
pub const WS_PORT: u16 = 47831;
/// Path on the same server that receives the OAuth loopback redirect.
pub const AUTH_CALLBACK_PATH: &str = "/auth/callback";
/// Protocol version exchanged in the `hello` handshake.
pub const PROTOCOL_VERSION: u32 = 1;
