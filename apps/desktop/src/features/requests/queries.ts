import type { QueryData } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

function requestsQuery(userId: string) {
  return supabase
    .from("follows")
    .select(
      "follower_id, created_at, status, profiles!follows_follower_id_fkey(handle, display_name, avatar_url)",
    )
    .eq("followee_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
}

export type FollowRequest = QueryData<ReturnType<typeof requestsQuery>>[number];

export const requestsKey = (userId: string) => ["follow-requests", userId] as const;

export function useFollowRequests() {
  const { userId } = useUser();
  return useQuery({
    queryKey: requestsKey(userId),
    queryFn: async () => {
      const { data, error } = await requestsQuery(userId);
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });
}

export function useRespondToRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ follower, accept }: { follower: string; accept: boolean }) => {
      const { error } = accept
        ? await supabase.rpc("accept_follow", { follower })
        : await supabase.rpc("decline_follow", { follower });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["follow-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["profile-stats"] });
    },
  });
}
