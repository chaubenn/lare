import type { AuthInfo } from "./messages";
import { getSupabase } from "./supabase";

/**
 * OAuth via Supabase PKCE + chrome.identity.launchWebAuthFlow.
 * The redirect URL https://<extension-id>.chromiumapp.org/auth/callback must be
 * listed under Supabase Auth -> URL Configuration -> Redirect URLs.
 */
export async function signInWithProvider(provider: "github" | "google"): Promise<void> {
  const supabase = getSupabase();
  const redirectTo = chrome.identity.getRedirectURL("auth/callback");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new Error(error?.message ?? "Could not start sign-in");

  const responseUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true }, (url) => {
      if (chrome.runtime.lastError || !url) {
        reject(new Error(chrome.runtime.lastError?.message ?? "Sign-in was cancelled"));
      } else {
        resolve(url);
      }
    });
  });

  const parsed = new URL(responseUrl);
  const code = parsed.searchParams.get("code");
  const oauthError =
    parsed.searchParams.get("error_description") ?? parsed.searchParams.get("error");
  if (oauthError) throw new Error(oauthError);
  if (!code) throw new Error("Sign-in did not return a code");

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw new Error(exchangeError.message);
}

export async function signInWithOtp(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw new Error(error.message);
}

export async function verifyOtp(email: string, token: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({ email, token, type: "email" });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

export async function getAuthInfo(): Promise<AuthInfo> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("handle, display_name, avatar_url")
    .eq("id", session.user.id)
    .maybeSingle();
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    handle: profile?.handle ?? null,
    displayName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
}
