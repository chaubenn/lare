export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lare-client",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...headers },
  });
}

export function error(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return null;
}

// ---------------------------------------------------------------------------
// Configuration: Deno.env first, then Supabase Vault (public.get_app_secret, service role only).
// ---------------------------------------------------------------------------

/** Names resolved from Vault when they are not present in the function's environment. */
const APP_SECRETS = [
  "BUNNY_LIBRARY_ID",
  "BUNNY_STREAM_API_KEY",
  "BUNNY_STREAM_READONLY_KEY",
  "BUNNY_TOKEN_KEY",
  "BUNNY_CDN_HOST",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "SITE_URL",
] as const;

const vaultValues = new Map<string, string>();
let vaultLoaded: Promise<void> | null = null;

/** One RPC for all names; retried because the gateway occasionally answers a cold isolate with 401. */
async function fetchSecrets(names: string[]): Promise<Record<string, string> | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
    const res = await fetch(`${url}/rest/v1/rpc/get_app_secrets`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ secret_names: names }),
    });
    if (res.ok) {
      const value = (await res.json()) as Record<string, unknown> | null;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(value ?? {})) if (typeof v === "string" && v) out[k] = v;
      return out;
    }
    lastStatus = res.status;
  }
  console.warn(`get_app_secrets failed: ${lastStatus}`);
  return null;
}

/**
 * Load Vault-backed values for every name missing from Deno.env. Resolved values are cached for
 * the isolate's lifetime; if the lookup fails the next request retries.
 */
export function ensureSecrets(): Promise<void> {
  if (!vaultLoaded) {
    vaultLoaded = (async () => {
      const missing = APP_SECRETS.filter((n) => !Deno.env.get(n) && !vaultValues.has(n));
      if (missing.length === 0) return;
      const values = await fetchSecrets(missing);
      if (!values) {
        vaultLoaded = null;
        return;
      }
      for (const [k, v] of Object.entries(values)) vaultValues.set(k, v);
    })().catch((e) => {
      console.error("loading secrets from vault failed", e);
      vaultLoaded = null;
    });
  }
  return vaultLoaded;
}

/** Required configuration value; throws when neither the environment nor Vault has it. */
export function env(name: string): string {
  const v = Deno.env.get(name) ?? vaultValues.get(name);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Optional configuration value. */
export function envOptional(name: string): string | undefined {
  return Deno.env.get(name) ?? vaultValues.get(name);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError("Invalid JSON body", 400);
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Wrap a handler with CORS preflight, configuration loading and uniform error handling. */
export function handler(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    try {
      await ensureSecrets();
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return error(e.message, e.status);
      console.error(e);
      return error(e instanceof Error ? e.message : "Internal error", 500);
    }
  };
}
