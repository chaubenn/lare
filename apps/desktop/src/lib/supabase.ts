import type { Database } from "@lare/supabase-types";
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

/** Best-effort message from a Supabase/PostgREST/unknown error. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}
