import "server-only";

import type { Database } from "@lare/supabase-types";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export type ServerSupabase = SupabaseClient<Database>;

/**
 * Cookie-backed Supabase client for Server Components, Server Actions and Route Handlers.
 * Create a fresh one per request; never share across requests.
 */
export async function createClient(): Promise<ServerSupabase> {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where cookies are read-only.
          // proxy.ts refreshes the session for those requests instead.
        }
      },
    },
  });
}
