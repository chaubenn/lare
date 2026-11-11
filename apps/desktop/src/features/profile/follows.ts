/** The viewer's own follow edges: reading their state towards other people, and changing them. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { queryKeys, refresh } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";

export type FollowState = "none" | "pending" | "accepted";

export interface PersonSummary {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_private: boolean;
}

/** The viewer's edge towards one profile, for the follow button on their page. */
export function useFollowState(targetId: string | null | undefined) {
  const { userId } = useUser();
  return useQuery({
    queryKey: queryKeys.followState.of(userId, targetId ?? ""),
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

/** The viewer's own outgoing edges towards `ids`, so lists show Follow / Requested / Following. */
export function useFollowStates(ids: string[]) {
  const { userId } = useUser();
  const key = [...ids].sort();
  return useQuery({
    queryKey: queryKeys.followStates.of(userId, key),
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

export function useFollow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (handle: string): Promise<FollowState> => {
      const { data, error } = await supabase.rpc("request_follow", { target_handle: handle });
      if (error) throw error;
      return data === "accepted" ? "accepted" : "pending";
    },
    onSuccess: () => void refresh.followGraph(queryClient),
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
    onSuccess: () => void refresh.followGraph(queryClient),
  });
}

/** Stop someone following you: how a private account takes back access it granted. */
export function useRemoveFollower() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (followerId: string) => {
      const { error } = await supabase.rpc("remove_follower", { p_follower_id: followerId });
      if (error) throw error;
    },
    onSuccess: () => void refresh.followGraph(queryClient),
  });
}
