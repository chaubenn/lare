import { parseSolvedActivity, parseSolvedSkills } from "@lare/shared";
import type { Profile } from "@lare/supabase-types";
import type { QueryData } from "@supabase/supabase-js";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { parseFollowList, parseProfileStats } from "@/lib/json";
import { type KeysetCursor, keysetFilter, nextCursor } from "@/lib/keyset";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";

export function useProfileStats(handle: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.profileStats.of(handle),
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
    queryKey: queryKeys.solvedActivity.of(handle),
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
    queryKey: queryKeys.solvedSkills.of(handle),
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
    queryKey: queryKeys.followList.of(handle, kind),
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
    queryKey: queryKeys.publicProfile.of(handle),
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
 * Published posts by one user, with what the profile's compact rows show: the session's kind and
 * problems, and each video's status for the pending/failed badge. RLS hides whatever the viewer
 * may not see, so a private account they don't follow simply returns nothing.
 */
const userPostsSelect =
  "*, sessions!posts_session_id_fkey(id, kind, session_problems(id, title, difficulty)), videos!posts_video_id_fkey(id, status), demo_videos:videos!posts_demo_video_id_fkey(id, status)" as const;

const USER_POSTS_PAGE_SIZE = 24;

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

export type UserPost = QueryData<ReturnType<typeof userPostsQuery>>[number];

/** Newest first, a page at a time; `data` is every page loaded so far, flattened. */
export function useUserPosts(userId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.userPosts.of(userId),
    enabled: !!userId,
    initialPageParam: undefined as KeysetCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await userPostsQuery(userId ?? "", pageParam);
      if (error) throw error;
      const rows = data ?? [];
      return {
        items: rows,
        next: nextCursor(rows, USER_POSTS_PAGE_SIZE, (row) => row.published_at),
      };
    },
    getNextPageParam: (lastPage) => lastPage.next,
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}
