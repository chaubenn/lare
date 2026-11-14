import { AUTH_CALLBACK_URL, enabledOAuthProviders, type OAuthProvider } from "@lare/shared";
import { env } from "@/lib/env";
import { openExternal } from "@/lib/open";
import { supabase } from "@/lib/supabase";
import { expectAuthCallback } from "@/lib/tauri";

/**
 * How long a sign-in sent to the browser is waited for. The local server stops taking the
 * callback after the same ten minutes (`SIGN_IN_WINDOW` in `local_server/oauth_callback.rs`).
 */
export const SIGN_IN_WAIT_MS = 10 * 60_000;

/** The providers this Supabase project has switched on; all of them when that cannot be read. */
export function fetchSignInProviders(): Promise<OAuthProvider[]> {
  return enabledOAuthProviders(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Start the PKCE flow in the system browser. Supabase redirects to the local Rust server's
 * `/auth/callback` (see `redirectTo` below), which forwards the code via the `auth:callback` event.
 * The server only takes that callback while a sign-in started here is pending, and only once.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Supabase did not return a sign-in URL");
  await expectAuthCallback();
  await openExternal(data.url);
}

export async function sendEmailOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifyEmailOtp(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}
