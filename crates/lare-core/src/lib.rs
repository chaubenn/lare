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
/// Protocol version exchanged in the `hello` handshake. Bump whenever either side starts relying on
/// something the other side's previous release does not do.
///
/// * 2: `session.cancel` (added late, without a bump: a v2 app may not understand it).
/// * 3: `session.cancel` is guaranteed; `session.*` frames only act on the session they name;
///   `hello.ack.recording` carries the recorder's state.
pub const PROTOCOL_VERSION: u32 = 3;
/// Oldest extension protocol the app still serves. The app answers `hello` with the lower of the
/// two versions, so an older extension that insists on its own number keeps working.
pub const MIN_EXT_PROTOCOL_VERSION: u32 = 2;
