import { parseSolvedActivity } from "@lare/shared";
import type { Profile } from "@lare/supabase-types";
import type { QueryData } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import type { FollowState } from "@/features/friends/queries";
import { decoratePosts, type PostDecoration } from "@/features/posts/media";
import { fetchTopComments, type PostComment } from "@/features/posts/social";
import { parseProfileStats } from "@/lib/json";
import { supabase } from "@/lib/supabase";

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
  "*, profiles!posts_user_id_fkey(handle, display_name, avatar_url, is_private), sessions!posts_session_id_fkey(id, kind, scope, status, active_ms, started_at, ended_at, session_problems(id, slug, title, difficulty, active_ms, opened_at, submissions(id, accepted, lang, runtime_ms, runtime_display, runtime_percentile, memory_mb, memory_display, memory_percentile, submitted_at))), videos!posts_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id), demo_videos:videos!posts_demo_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id), post_media!post_media_post_id_fkey(id, storage_path, kind, width, height, caption, position, created_at)" as const;

function userPostsQuery(userId: string) {
  return supabase
    .from("posts")
    .select(userPostsSelect)
    .eq("user_id", userId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);
}

export type UserPost = QueryData<ReturnType<typeof userPostsQuery>>[number] &
  PostDecoration & { top_comments: PostComment[] };

export function useUserPosts(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["user-posts", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await userPostsQuery(userId ?? "");
      if (error) throw error;
      const rows = data ?? [];
      const [decorated, comments] = await Promise.all([
        decoratePosts(rows),
        fetchTopComments(rows.map((r) => r.id)),
      ]);
      return decorated.map((row) => ({ ...row, top_comments: comments.get(row.id) ?? [] }));
    },
  });
}
