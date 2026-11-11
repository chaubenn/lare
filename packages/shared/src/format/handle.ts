/**
 * A handle is 3–20 lowercase letters, numbers or underscores. The database enforces the same rule
 * on `profiles.handle` and finds mentions with it (`private.comment_mentions`).
 */
export const HANDLE_CHAR = "[a-z0-9_]";
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 20;
export const HANDLE_RE = new RegExp(`^${HANDLE_CHAR}{${HANDLE_MIN_LENGTH},${HANDLE_MAX_LENGTH}}$`);
