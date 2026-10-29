import { parseGlobalLeaderboard, parseLeaderboard } from "@lare/shared";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

export type WeekOffset = 0 | -1;

/** The viewer and the people they follow, ranked by distinct problems solved in the week. */
export function useWeeklyLeaderboard(weekOffset: WeekOffset) {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["weekly-leaderboard", userId, weekOffset],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("weekly_leaderboard", { week_offset: weekOffset });
      if (error) throw error;
      return parseLeaderboard(data);
    },
  });
}

/**
 * Everyone with a public account, ranked by distinct problems solved in the week. A private
 * viewer gets their own standing back too, but is never listed for anyone else.
 */
export function useGlobalLeaderboard(weekOffset: WeekOffset) {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["global-leaderboard", userId, weekOffset],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("global_leaderboard", { week_offset: weekOffset });
      if (error) throw error;
      return parseGlobalLeaderboard(data);
    },
  });
}
