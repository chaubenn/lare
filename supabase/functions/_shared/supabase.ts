import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { env, HttpError } from "./http.ts";

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

/**
 * Service-role client (bypasses RLS). Use only after authorising the caller; load the caller's own
 * rows through `ownedRow`.
 */
export function adminClient(): AnyClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// deno-lint-ignore no-explicit-any
type OwnedRow = { user_id: string } & Record<string, any>;

/**
 * The caller's own row of `table`, read with the service role. `user_id` is part of the query and
 * checked again on the result, so a row someone else owns is never returned: it is a 404, like a
 * row that does not exist.
 */
export async function ownedRow<T extends { user_id: string } = OwnedRow>(
  admin: AnyClient,
  table: string,
  id: string,
  userId: string,
  columns: string,
  notFound: string,
): Promise<T> {
  const select = columns.split(",").some((c) => c.trim() === "user_id")
    ? columns
    : `${columns}, user_id`;
  const { data, error } = await admin
    .from(table)
    .select(select)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  // 22P02: the id is not a uuid, so there is no such row.
  if (error && error.code !== "22P02") throw new Error(`${table} select failed: ${error.message}`);
  const row = (error ? null : data) as unknown as T | null;
  if (!row || row.user_id !== userId) throw new HttpError(notFound, 404);
  return row;
}

export async function requireUser(req: Request): Promise<{ id: string; client: AnyClient }> {
  const jwt = bearerJwt(req);
  if (!jwt) throw new HttpError("Not signed in", 401);
  const client = userClient(req);
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError("Not signed in", 401);
  return { id: data.user.id, client };
}

export async function optionalUser(
  req: Request,
): Promise<{ id: string | null; client: AnyClient }> {
  const jwt = bearerJwt(req);
  const client = userClient(req);
  if (!jwt) return { id: null, client };
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) return { id: null, client: userClient(new Request(req.url)) };
  return { id: data.user.id, client };
}
