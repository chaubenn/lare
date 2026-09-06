import "server-only";

import { after } from "next/server";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Every published post that asked for a session card should carry a pre-generated one (the same
 * image crawlers get). When such a post is rendered without one — published before the
 * `og-snapshot` function existed, or the publish-time trigger failed — ask the function to
 * generate and store it after the response.
 * The viewer's access token is captured up front: request APIs are not available inside `after`
 * when it is scheduled from a Server Component.
 */
export async function ensureOgSnapshot(post: {
  id: string;
  status: string;
  og_url: string | null;
  include_og_card: boolean;
}): Promise<void> {
  if (post.status !== "published" || post.og_url || !post.include_og_card) return;
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;
  after(async () => {
    try {
      await fetch(`${env.supabaseUrl}/functions/v1/og-snapshot`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: env.supabaseKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ postId: post.id }),
      });
    } catch {
      // Best effort: the on-demand /api/og route still renders the card for this request path.
    }
  });
}
