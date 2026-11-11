/**
 * Whether a request failed before reaching the server: no network, DNS, a dropped connection.
 * supabase-js wraps the browser's fetch TypeError into its own error shapes, so match on the text
 * each engine uses (Chromium/WebView2, WebKit, Firefox) and on the auth/functions wrappers.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  if (name === "AuthRetryableFetchError" || name === "FunctionsFetchError") return true;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /failed to fetch|load failed|networkerror|network request failed|failed to send a request/i.test(
      message,
    )
  );
}

export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach Lare. Check your internet connection and try again.";

/** The text a thrown value carries: a string itself, or a non-empty `message`. Null when neither. */
export function thrownText(error: unknown): string | null {
  if (typeof error === "string") return error.length > 0 ? error : null;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return null;
}

/** Best-effort message from a Supabase/PostgREST/unknown error. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  return thrownText(error) ?? fallback;
}
