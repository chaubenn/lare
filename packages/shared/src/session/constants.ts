/** Localhost WebSocket port the desktop app listens on for the extension. */
export const WS_PORT = 47831;
export const WS_URL = `ws://127.0.0.1:${WS_PORT}`;
/** Path on the same local server that receives the desktop OAuth loopback redirect. */
export const AUTH_CALLBACK_PATH = "/auth/callback";
export const AUTH_CALLBACK_URL = `http://127.0.0.1:${WS_PORT}${AUTH_CALLBACK_PATH}`;
/** Custom URL scheme registered by the desktop app (packaged builds). */
export const DEEP_LINK_SCHEME = "lare";

/** Protocol version exchanged in the `hello` handshake. Bump on breaking changes. */
export const PROTOCOL_VERSION = 1;

/** Bunny Stream library used for all videos. */
export const BUNNY_LIBRARY_ID = 743884;
export const BUNNY_EMBED_BASE = "https://player.mediadelivery.net/embed";

/** Edit-event snapshot policy (see edits.ts). */
export const SNAPSHOT_EVERY_EVENTS = 50;
export const SNAPSHOT_EVERY_MS = 30_000;

/** LeetCode */
export const LEETCODE_ORIGIN = "https://leetcode.com";
export const LEETCODE_GRAPHQL = `${LEETCODE_ORIGIN}/graphql`;
