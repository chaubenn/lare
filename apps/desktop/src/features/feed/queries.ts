import type { QueryData } from "@supabase/supabase-js";
import { useInfiniteQuery } from "@tanstack/react-query";
import { decoratePosts, type PostDecoration } from "@/features/publishing/posts/media";
import { fetchTopComments, type PostComment } from "@/features/publishing/posts/social";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";

const FEED_PAGE_SIZE = 20;

/**
 * `feed()` returns `setof posts`, so PostgREST lets us embed the author, the session summary,
 * the video and the carousel media exactly like a table select.
 */
const FEED_SELECT =
  "*, profiles!posts_user_id_fkey(handle, display_name, avatar_url, is_private), sessions!posts_session_id_fkey(id, kind, scope, status, active_ms, started_at, ended_at, session_problems(id, slug, title, difficulty)), videos!posts_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id, width, height), demo_videos:videos!posts_demo_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id, width, height), post_media!post_media_post_id_fkey(id, storage_path, kind, width, height, caption, position, created_at)" as const;

/** "all" is every post the viewer may see; "following" narrows it to accepted followees. */
export type FeedScope = "all" | "following";

/**
 * Where the next page starts. `feed()` orders by `published_at desc, id desc`, so the id breaks
 * ties between posts published in the same instant, which a timestamp alone would skip.
 */
interface FeedCursor {
  before: string;
  beforeId: string;
}

function feedQuery(scope: FeedScope, cursor?: FeedCursor) {
  return supabase
    .rpc("feed", {
      ...(cursor ? { before: cursor.before, before_id: cursor.beforeId } : {}),
      page_size: FEED_PAGE_SIZE,
      scope,
    })
    .select(FEED_SELECT);
}

export type FeedPost = QueryData<ReturnType<typeof feedQuery>>[number] &
  PostDecoration & { top_comments: PostComment[] };

export function useFeed(scope: FeedScope) {
  return useInfiniteQuery({
    queryKey: queryKeys.feed.of(scope),
    initialPageParam: undefined as FeedCursor | undefined,
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
    getNextPageParam: (lastPage): FeedCursor | undefined => {
      if (lastPage.length < FEED_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return last?.published_at ? { before: last.published_at, beforeId: last.id } : undefined;
    },
  });
}
