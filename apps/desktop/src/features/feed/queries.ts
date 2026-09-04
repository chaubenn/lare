import type { QueryData } from "@supabase/supabase-js";
import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export const FEED_PAGE_SIZE = 20;

/**
 * `feed()` returns `setof posts`, so PostgREST lets us embed the author, the session summary and
 * the video exactly like a table select.
 */
const FEED_SELECT =
  "*, profiles!posts_user_id_fkey(handle, display_name, avatar_url), sessions(id, kind, active_ms, started_at, session_problems(id, slug, title, difficulty, submissions(accepted, runtime_ms, runtime_display, runtime_percentile, submitted_at))), videos(id, status)" as const;

/** "all" is every post the viewer may see; "following" narrows it to accepted followees. */
export type FeedScope = "all" | "following";

function feedQuery(scope: FeedScope, before?: string) {
  return supabase
    .rpc("feed", { ...(before ? { before } : {}), page_size: FEED_PAGE_SIZE, scope })
    .select(FEED_SELECT);
}

export type FeedPost = QueryData<ReturnType<typeof feedQuery>>[number];

export function useFeed(scope: FeedScope = "all") {
  return useInfiniteQuery({
    queryKey: ["feed", scope],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await feedQuery(scope, pageParam);
      if (error) throw error;
      return data;
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < FEED_PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.published_at ?? undefined;
    },
  });
}
