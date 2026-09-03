import type { Database } from "@lare/supabase-types";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export type BrowserSupabase = SupabaseClient<Database>;

/** Browser client. `createBrowserClient` is a singleton under the hood, so this is cheap. */
export function createClient(): BrowserSupabase {
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseKey);
}
