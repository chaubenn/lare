"use server";

import { fetchFeedPage, type PostCardData } from "@/lib/posts";
import { createClient } from "@/lib/supabase/server";

export interface FeedPage {
  items: PostCardData[];
  nextCursor: string | null;
}

/** Next page of the viewer's feed; `before` is the previous page's cursor. */
export async function loadFeedPage(before: string | null): Promise<FeedPage> {
  const supabase = await createClient();
  return fetchFeedPage(supabase, before);
}
