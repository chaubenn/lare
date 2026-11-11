import { parseGlobalLeaderboard, parseLeaderboard } from "@lare/shared";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";

export type WeekOffset = 0 | -1;

/** The viewer and the people they follow, ranked by distinct problems solved in the week. */
export function useWeeklyLeaderboard(weekOffset: WeekOffset) {
  const { userId } = useUser();
  return useQuery({
    queryKey: queryKeys.weeklyLeaderboard.of(userId, weekOffset),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("weekly_leaderboard", { week_offset: weekOffset });
      if (error) throw error;
      return parseLeaderboard(data);
    },
  });
}

/**
 * Everyone who solved something in the week, ranked by distinct problems solved. Private accounts
 * are listed too, with `is_private` set (migration 0022); the viewer's own row comes back even
 * when it is past the cut-off.
 */
export function useGlobalLeaderboard(weekOffset: WeekOffset) {
  const { userId } = useUser();
  return useQuery({
    queryKey: queryKeys.globalLeaderboard.of(userId, weekOffset),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("global_leaderboard", { week_offset: weekOffset });
      if (error) throw error;
      return parseGlobalLeaderboard(data);
    },
  });
}
