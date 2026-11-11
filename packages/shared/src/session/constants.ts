/** Localhost WebSocket port the desktop app listens on for the extension. */
export const WS_PORT = 47831;
export const WS_URL = `ws://127.0.0.1:${WS_PORT}`;
/** Path on the same local server that receives the desktop OAuth loopback redirect. */
export const AUTH_CALLBACK_PATH = "/auth/callback";
export const AUTH_CALLBACK_URL = `http://127.0.0.1:${WS_PORT}${AUTH_CALLBACK_PATH}`;
/** Custom URL scheme registered by the desktop app (packaged builds). */
export const DEEP_LINK_SCHEME = "lare";

/**
 * Protocol version exchanged in the `hello` handshake. Bump whenever either side starts relying on
 * something the other side's previous release does not do (see crates/lare-core/src/lib.rs).
 *
 * - 2: `session.cancel` (added late, without a bump: a v2 app may not understand it).
 * - 3: `session.cancel` is guaranteed; `session.*` frames only act on the session they name;
 *   `hello.ack.recording` carries the recorder's state.
 * - 4: both sides prove they hold the install's pairing secret (`hello.nonce`, `auth.challenge`,
 *   `auth.response`) before `hello.ack`.
 */
export const PROTOCOL_VERSION = 4;
/**
 * Oldest desktop protocol the extension talks to. An app older than 4 cannot prove it is Lare, so
 * whatever answers like one is treated as "update the desktop app".
 */
export const MIN_DESKTOP_PROTOCOL_VERSION = 4;
/** Domain-separation prefix of the pairing HMAC transcript (`pairingTranscript`). */
export const PAIRING_DOMAIN = "lare-bridge/1";

/**
 * Id of the extension built with the pinned `key` in apps/extension/wxt.config.ts (every build but
 * the Chrome Web Store package). The desktop app accepts its origin (`EXTENSION_ID` in the Rust
 * bridge).
 */
export const EXTENSION_ID = "koplffaeeahehnfikinmldhhmmldghhl";

/** Bunny Stream library used for all videos. */
export const BUNNY_LIBRARY_ID = 743884;
export const BUNNY_EMBED_BASE = "https://player.mediadelivery.net/embed";

/** LeetCode */
export const LEETCODE_ORIGIN = "https://leetcode.com";
