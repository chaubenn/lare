import { type SupabaseClient, createClient } from "npm:@supabase/supabase-js@2";
import { HttpError, env } from "./http.ts";

// deno-lint-ignore no-explicit-any
export type AnyClient = SupabaseClient<any, "public", any>;

/** Bearer token from the request if it looks like a user JWT (not a publishable/anon key). */
export function bearerJwt(req: Request): string | null {
  const raw = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!raw || raw === env("SUPABASE_ANON_KEY")) return null;
  // JWTs are three base64url segments; publishable keys look like sb_publishable_...
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
}

/** Client acting as the caller (RLS applies); anonymous when no user JWT is present. */
export function userClient(req: Request): AnyClient {
  const jwt = bearerJwt(req);
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client (bypasses RLS). Use only after authorising the caller. */
export function adminClient(): AnyClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request): Promise<{ id: string; client: AnyClient }> {
  const jwt = bearerJwt(req);
  if (!jwt) throw new HttpError("Not signed in", 401);
  const client = userClient(req);
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError("Not signed in", 401);
  return { id: data.user.id, client };
}

export async function optionalUser(req: Request): Promise<{ id: string | null; client: AnyClient }> {
  const jwt = bearerJwt(req);
  const client = userClient(req);
  if (!jwt) return { id: null, client };
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) return { id: null, client: userClient(new Request(req.url)) };
  return { id: data.user.id, client };
}
