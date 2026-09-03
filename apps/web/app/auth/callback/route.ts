import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/viewer";

/**
 * Post-login landing. OAuth and magic links arrive with `?code=` (PKCE) which we exchange for
 * a session; the email-OTP form navigates here after `verifyOtp` with no code. Either way we
 * send users without a handle to onboarding, otherwise back to `next`.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const loginUrl = `/login?next=${encodeURIComponent(next)}`;

  const providerError = params.get("error_description") ?? params.get("error");
  if (providerError) redirect(`${loginUrl}&error=${encodeURIComponent(providerError)}`);

  const supabase = await createClient();
  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) redirect(`${loginUrl}&error=${encodeURIComponent(error.message)}`);
  }

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect(loginUrl);

  const { data: profile } = await supabase
    .from("profiles")
    .select("handle")
    .eq("id", data.claims.sub)
    .maybeSingle();

  redirect(profile?.handle ? next : `/onboarding?next=${encodeURIComponent(next)}`);
}
