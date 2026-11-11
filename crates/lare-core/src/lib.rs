//! Shared, dependency-light types for Lare's Rust side.
//!
//! `protocol` is the Rust side of `packages/shared/src/session/protocol.ts` and `edits` of
//! `packages/shared/src/session/edits.ts`. `packages/shared/fixtures/bridge.json` is what keeps
//! the two sides in step: each is tested against it (`tests/bridge_fixtures.rs` here).

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
/// * 4: both sides prove they hold the install's pairing secret (`hello.nonce`, `auth.challenge`,
///   `auth.response`) before `hello.ack`.
pub const PROTOCOL_VERSION: u32 = 4;
/// Oldest extension protocol the app still serves. The app answers `hello` with the lower of the
/// two versions. Older than 4 cannot authenticate, so it is turned away: serving it would let any
/// local process in by claiming to be an old extension.
pub const MIN_EXT_PROTOCOL_VERSION: u32 = 4;
/// Domain-separation prefix of the pairing HMAC transcript (see `local_server::pairing` in the desktop app).
pub const PAIRING_DOMAIN: &str = "lare-bridge/1";
