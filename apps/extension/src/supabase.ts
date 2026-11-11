import type { Database } from "@lare/supabase-types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromeStorageAdapter } from "./storage";

const SUPABASE_URL: string = import.meta.env.WXT_SUPABASE_URL;
const SUPABASE_KEY: string = import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY;
/** How this client names itself: the `x-lare-client` header and `sessions.client`. */
export const CLIENT_TAG = `extension/${__EXT_VERSION__}`;

let client: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (!client) {
    client = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: chromeStorageAdapter,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
      global: {
        headers: { "x-lare-client": CLIENT_TAG },
      },
    });
  }
  return client;
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.id ?? null;
}
