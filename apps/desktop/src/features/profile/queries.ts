import { parseSolvedActivity, parseSolvedSkills } from "@lare/shared";
import type { Profile } from "@lare/supabase-types";
import type { QueryData } from "@supabase/supabase-js";
import { type QueryClient, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import type { FollowState } from "@/features/friends/queries";
import { decoratePosts, type PostDecoration } from "@/features/publishing/posts/media";
import { fetchTopComments, type PostComment } from "@/features/publishing/posts/social";
import { parseFollowList, parseProfileStats } from "@/lib/json";
import { type KeysetCursor, keysetFilter, nextCursor } from "@/lib/keyset";
import { supabase } from "@/lib/supabase";

/**
 * After the signed-in user changes their name, handle, avatar or privacy. Posts, comments, people
 * lists, notifications and the boards all embed the author's profile columns, so each goes stale.
 */
export function invalidateAuthorViews(queryClient: QueryClient) {
  for (const key of [
    "feed",
    "user-posts",
    "post",
    "post-comments",
    "public-profile",
    "profile-stats",
    "follow-list",
    "following",
    "followers",
    "follow-requests",
    "notifications",
    "weekly-leaderboard",
    "global-leaderboard",
    "profile-search",
    "mention-suggestions",
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useProfileStats(handle: string | null | undefined) {
  return useQuery({
    queryKey: ["profile-stats", handle],
    enabled: !!handle,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("profile_stats", { target_handle: handle ?? "" });
      if (error) throw error;
      return parseProfileStats(data);
    },
  });
}

/**
 * Solved-problem activity for the contribution grid. The RPC counts accepted submissions
 * directly, so problems solved in sessions that were never posted still show up; it returns
 * `visible: false` for a private account the viewer doesn't follow.
 */
export function useSolvedActivity(handle: string | null | undefined) {
  return useQuery({
    queryKey: ["solved-activity", handle],
    enabled: !!handle,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("solved_activity", {
        target_handle: handle ?? "",
      });
      if (error) throw error;
      return parseSolvedActivity(data);
    },
  });
}

/**
 * Every distinct solved problem with its difficulty and topics, for the skills panel. Returns
 * `visible: false` for a private account the viewer doesn't follow, like solved activity.
 */
export function useSolvedSkills(handle: string | null | undefined) {
  return useQuery({
    queryKey: ["solved-skills", handle],
    enabled: !!handle,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("solved_skills", { target_handle: handle ?? "" });
      if (error) throw error;
      return parseSolvedSkills(data);
    },
  });
}

export type FollowListKind = "followers" | "following";

/**
 * The people behind a profile's follower / following count, for the list modal.
 *
 * Goes through the `follow_list` RPC rather than the table: `follows` RLS only exposes edges the
 * viewer is one of the two parties to, so a direct query returns nothing for anyone else's
 * profile. The RPC applies the same visibility rule as the stats — a private account the viewer
 * does not follow answers `visible: false` with no names.
 */
export function useFollowList(
  handle: string | null | undefined,
  kind: FollowListKind,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["follow-list", handle, kind],
    enabled: !!handle && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("follow_list", {
        target_handle: handle ?? "",
        list_kind: kind,
      });
      if (error) throw error;
      return parseFollowList(data);
    },
  });
}

/** Someone else's profile row. `profiles` is a public directory, so this always resolves. */
export function usePublicProfile(handle: string | undefined) {
  return useQuery({
    queryKey: ["public-profile", handle],
    enabled: !!handle,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("handle", handle ?? "")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * The viewer's edge towards one profile, for the follow button on their page. Deliberately a
 * different key prefix from `useFollowStates`, whose entries hold a record rather than a state.
 */
export function useFollowState(targetId: string | null | undefined) {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["follow-state", userId, targetId ?? ""],
    enabled: !!targetId && targetId !== userId,
    queryFn: async (): Promise<FollowState> => {
      const { data, error } = await supabase
        .from("follows")
        .select("status")
        .eq("follower_id", userId)
        .eq("followee_id", targetId ?? "")
        .maybeSingle();
      if (error) throw error;
      return data?.status ?? "none";
    },
  });
}

/**
 * Published posts by one user. RLS hides whatever the viewer may not see, so a private
 * account they don't follow simply returns nothing. The select mirrors the feed's so the
 * shared PostCard renders identically in both places.
 */
const userPostsSelect =
  "*, profiles!posts_user_id_fkey(handle, display_name, avatar_url, is_private), sessions!posts_session_id_fkey(id, kind, scope, status, active_ms, started_at, ended_at, session_problems(id, slug, title, difficulty)), videos!posts_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id, width, height), demo_videos:videos!posts_demo_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id, width, height), post_media!post_media_post_id_fkey(id, storage_path, kind, width, height, caption, position, created_at)" as const;

export const USER_POSTS_PAGE_SIZE = 24;

function userPostsQuery(userId: string, cursor?: KeysetCursor) {
  let query = supabase
    .from("posts")
    .select(userPostsSelect)
    .eq("user_id", userId)
    .eq("status", "published");
  if (cursor) query = query.or(keysetFilter("published_at", cursor));
  return query
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(USER_POSTS_PAGE_SIZE);
}

export type UserPost = QueryData<ReturnType<typeof userPostsQuery>>[number] &
  PostDecoration & { top_comments: PostComment[] };

/** Newest first, a page at a time; `data` is every page loaded so far, flattened. */
export function useUserPosts(userId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: ["user-posts", userId],
    enabled: !!userId,
    initialPageParam: undefined as KeysetCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await userPostsQuery(userId ?? "", pageParam);
      if (error) throw error;
      const rows = data ?? [];
      const [decorated, comments] = await Promise.all([
        decoratePosts(rows),
        fetchTopComments(rows.map((r) => r.id)),
      ]);
      return {
        items: decorated.map((row) => ({ ...row, top_comments: comments.get(row.id) ?? [] })),
        next: nextCursor(rows, USER_POSTS_PAGE_SIZE, (row) => row.published_at),
      };
    },
    getNextPageParam: (lastPage) => lastPage.next,
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}
