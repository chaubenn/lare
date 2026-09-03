import type { Database } from "@lare/supabase-types";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { chromeStorageAdapter } from "./storage";

export const SUPABASE_URL: string = import.meta.env.WXT_SUPABASE_URL;
export const SUPABASE_KEY: string = import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY;
export const SITE_URL: string = import.meta.env.WXT_SITE_URL ?? "https://lare.vercel.app";

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
        headers: { "x-lare-client": `extension/${__EXT_VERSION__}` },
      },
    });
  }
  return client;
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.id ?? null;
}
