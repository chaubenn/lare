import type { Database } from "@lare/supabase-types";
import { allowAvatarOrigin } from "@lare/ui";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export const supabase = createClient<Database>(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      // The OAuth redirect lands on the local Rust server, not in this webview.
      detectSessionInUrl: false,
    },
  },
);

// Profile pictures uploaded in the app are public objects in this project's storage.
allowAvatarOrigin(env.VITE_SUPABASE_URL);

/**
 * Call an Edge Function and unwrap its JSON body. Surfaces the server's `error` message on
 * non-2xx responses instead of the generic FunctionsHttpError text.
 */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      let serverMessage: string | null = null;
      try {
        const payload = (await ctx.json()) as { error?: string; message?: string };
        serverMessage = payload.error ?? payload.message ?? null;
      } catch {
        // not JSON
      }
      if (serverMessage) throw new Error(serverMessage);
    }
    throw new Error(error.message);
  }
  if (data === null || data === undefined) throw new Error(`${name} returned no data`);
  return data;
}

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

/** Best-effort message from a Supabase/PostgREST/unknown error. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (!error) return fallback;
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}
