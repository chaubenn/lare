import "server-only";

import type { Database } from "@lare/supabase-types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Anonymous (no cookies, no session) client for contexts that must not depend on the
 * viewer, e.g. Open Graph image generation. RLS still applies as the `anon` role.
 */
export function createAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
