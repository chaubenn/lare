import { useQuery } from "@tanstack/react-query";
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
