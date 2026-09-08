import "server-only";

import type { Database } from "@lare/supabase-types";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { env } from "@/lib/env";

export type ServerSupabase = SupabaseClient<Database>;

/**
 * Cookie-backed Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Memoised with React `cache`, which is per-request: callers share one client within a
 * request but never across requests. A single render touches this from the page, the
 * header and the data layer, and each extra instance would redo its own JWT verification
 * (and JWKS fetch) instead of reusing the first one's.
 */
export const createClient = cache(async (): Promise<ServerSupabase> => {
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
});
