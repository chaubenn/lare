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
 */
export const PROTOCOL_VERSION = 3;
/**
 * Oldest desktop protocol the extension can run a mock interview against. It discards a failed
 * start with `session.cancel`, which a v2 app may not know.
 */
export const MIN_DESKTOP_PROTOCOL_VERSION = 3;

/** Bunny Stream library used for all videos. */
export const BUNNY_LIBRARY_ID = 743884;
export const BUNNY_EMBED_BASE = "https://player.mediadelivery.net/embed";

/** Edit-event snapshot policy (see edits.ts). */
export const SNAPSHOT_EVERY_EVENTS = 50;
export const SNAPSHOT_EVERY_MS = 30_000;

/** LeetCode */
export const LEETCODE_ORIGIN = "https://leetcode.com";
export const LEETCODE_GRAPHQL = `${LEETCODE_ORIGIN}/graphql`;
