import type { QueryData } from "@supabase/supabase-js";
import { useInfiniteQuery } from "@tanstack/react-query";
import { decoratePosts, type PostDecoration } from "@/features/posts/media";
import { fetchTopComments, type PostComment } from "@/features/posts/social";
import { supabase } from "@/lib/supabase";

export const FEED_PAGE_SIZE = 20;

/**
 * `feed()` returns `setof posts`, so PostgREST lets us embed the author, the session summary,
 * the video and the carousel media exactly like a table select. The select mirrors the web
 * feed's `POST_CARD_SELECT` so both apps decorate and render the identical card.
 */
const FEED_SELECT =
  "*, profiles!posts_user_id_fkey(handle, display_name, avatar_url, is_private), sessions!posts_session_id_fkey(id, kind, scope, status, active_ms, started_at, ended_at, session_problems(id, slug, title, difficulty, active_ms, opened_at, submissions(id, accepted, lang, runtime_ms, runtime_display, runtime_percentile, memory_mb, memory_display, memory_percentile, submitted_at))), videos!posts_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id), post_media!post_media_post_id_fkey(id, storage_path, kind, width, height, caption, position, created_at)" as const;

/** "all" is every post the viewer may see; "following" narrows it to accepted followees. */
export type FeedScope = "all" | "following";

function feedQuery(scope: FeedScope, before?: string) {
  return supabase
    .rpc("feed", { ...(before ? { before } : {}), page_size: FEED_PAGE_SIZE, scope })
    .select(FEED_SELECT);
}

export type FeedPost = QueryData<ReturnType<typeof feedQuery>>[number] &
  PostDecoration & { top_comments: PostComment[] };

export function useFeed(scope: FeedScope = "all") {
  return useInfiniteQuery({
    queryKey: ["feed", scope],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await feedQuery(scope, pageParam);
      if (error) throw error;
      const rows = data ?? [];
      const [decorated, comments] = await Promise.all([
        decoratePosts(rows),
        fetchTopComments(rows.map((r) => r.id)),
      ]);
      return decorated.map((row) => ({ ...row, top_comments: comments.get(row.id) ?? [] }));
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < FEED_PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.published_at ?? undefined;
    },
  });
}
