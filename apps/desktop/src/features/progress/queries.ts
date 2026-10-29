import { type Goal, parseGoalProgress } from "@lare/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

/** The viewer's goal measured against the current and recent periods. */
export function useGoalProgress() {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["goal-progress", userId],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("goal_progress");
      if (error) throw error;
      return parseGoalProgress(data);
    },
  });
}

export function useSaveGoal() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (goal: Goal) => {
      const { error } = await supabase.from("practice_goals").upsert({ user_id: userId, ...goal });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goal-progress"] }),
  });
}

export function useClearGoal() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("practice_goals").delete().eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goal-progress"] }),
  });
}
