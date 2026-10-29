import { AUTH_CALLBACK_URL } from "@lare/shared";
import { openExternal } from "@/lib/open";
import { supabase } from "@/lib/supabase";

export type OAuthProvider = "github" | "google";

/**
 * Start the PKCE flow in the system browser. Supabase redirects to the local Rust server
 * (`http://127.0.0.1:47831/auth/callback`), which forwards the code via the `auth:callback` event.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Supabase did not return a sign-in URL");
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
