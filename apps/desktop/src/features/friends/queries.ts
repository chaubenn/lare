import type { QueryData } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

export type FollowState = "none" | "pending" | "accepted";

export interface PersonSummary {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_private: boolean;
}

const PERSON_COLUMNS = "id, handle, display_name, avatar_url, is_private";

// ---------------------------------------------------------------------------
// Following / followers
// ---------------------------------------------------------------------------
function followingQuery(userId: string) {
  return supabase
    .from("follows")
    .select(`created_at, status, profiles!follows_followee_id_fkey(${PERSON_COLUMNS})`)
    .eq("follower_id", userId)
    .order("created_at", { ascending: false });
}

function followersQuery(userId: string) {
  return supabase
    .from("follows")
    .select(`created_at, profiles!follows_follower_id_fkey(${PERSON_COLUMNS})`)
    .eq("followee_id", userId)
    .eq("status", "accepted")
    .order("created_at", { ascending: false });
}

export type FollowingEdge = QueryData<ReturnType<typeof followingQuery>>[number];
export type FollowerEdge = QueryData<ReturnType<typeof followersQuery>>[number];

/** Everyone the viewer follows, including the requests still waiting for approval. */
export function useFollowing() {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["following", userId],
    queryFn: async () => {
      const { data, error } = await followingQuery(userId);
      if (error) throw error;
      return data;
    },
  });
}

export function useFollowers() {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["followers", userId],
    queryFn: async () => {
      const { data, error } = await followersQuery(userId);
      if (error) throw error;
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
/** Handles are `[a-z0-9_]`; keep the term to characters PostgREST's `or` filter parses. */
export function sanitiseSearch(raw: string): string {
  return raw
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_ -]/g, " ")
    .trim()
    .slice(0, 40);
}

/** `profiles` is a public directory under RLS, so the search runs straight against the table. */
export function useProfileSearch(term: string) {
  const { userId } = useUser();
  const query = sanitiseSearch(term);
  return useQuery({
    queryKey: ["profile-search", query],
    enabled: query.length > 0,
    queryFn: async (): Promise<PersonSummary[]> => {
      const like = `%${query}%`;
      const { data, error } = await supabase
        .from("profiles")
        .select(PERSON_COLUMNS)
        .not("handle", "is", null)
        .neq("id", userId)
        .or(`handle.ilike.${like},display_name.ilike.${like}`)
        .order("handle")
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The viewer's own outgoing edges towards `ids`, so lists show Follow / Requested / Following. */
export function useFollowStates(ids: string[]) {
  const { userId } = useUser();
  const key = [...ids].sort();
  return useQuery({
    queryKey: ["follow-states", userId, key.join(",")],
    enabled: key.length > 0,
    queryFn: async (): Promise<Record<string, FollowState>> => {
      const { data, error } = await supabase
        .from("follows")
        .select("followee_id, status")
        .eq("follower_id", userId)
        .in("followee_id", key);
      if (error) throw error;
      const states: Record<string, FollowState> = {};
      for (const row of data ?? []) states[row.followee_id] = row.status;
      return states;
    },
  });
}

// ---------------------------------------------------------------------------
// Follow / unfollow
// ---------------------------------------------------------------------------
/** Invalidate every list that shows an edge or a count after the graph changes. */
function invalidateGraph(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of [
    "following",
    "followers",
    "follow-state",
    "follow-states",
    "follow-requests",
    "profile-stats",
    "solved-activity",
    "public-profile",
    "user-posts",
    "feed",
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useFollow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (handle: string): Promise<FollowState> => {
      const { data, error } = await supabase.rpc("request_follow", { target_handle: handle });
      if (error) throw error;
      return data === "accepted" ? "accepted" : "pending";
    },
    onSuccess: () => invalidateGraph(queryClient),
  });
}

/** Also cancels a request the viewer sent: pending and accepted are the same edge. */
export function useUnfollow() {
  const queryClient = useQueryClient();
  const { userId } = useUser();
  return useMutation({
    mutationFn: async (targetId: string) => {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", userId)
        .eq("followee_id", targetId);
      if (error) throw error;
    },
    onSuccess: () => invalidateGraph(queryClient),
  });
}
