import "server-only";

import type { Profile } from "@lare/supabase-types";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface Viewer {
  id: string;
  email: string | null;
  profile: Profile | null;
}

/** The signed-in user (verified JWT claims) plus their profile row. Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  const id = data.claims.sub;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  return { id, email: data.claims.email ?? null, profile: profile ?? null };
});

/** Number of pending follow requests addressed to the viewer (for the nav badge). */
export const getPendingRequestCount = cache(async (userId: string): Promise<number> => {
  const supabase = await createClient();
  const { count } = await supabase
    .from("follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("followee_id", userId)
    .eq("status", "pending");
  return count ?? 0;
});

export type OnboardedViewer = Viewer & { profile: Profile & { handle: string } };

/**
 * For pages that need a signed-in, onboarded user. Redirects to /login (anonymous) or
 * /onboarding (no handle yet) and comes back to `nextPath` afterwards.
 */
export async function requireViewer(nextPath: string): Promise<OnboardedViewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const handle = viewer.profile?.handle;
  if (!viewer.profile || !handle) redirect(`/onboarding?next=${encodeURIComponent(nextPath)}`);
  return { ...viewer, profile: { ...viewer.profile, handle } };
}

/** Only allow same-origin relative paths for post-login redirects. */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
