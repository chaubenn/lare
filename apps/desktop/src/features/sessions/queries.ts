import type { QueryData } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

function sessionsQuery(userId: string) {
  return supabase
    .from("sessions")
    .select("*, session_problems(id, slug, title, difficulty), posts(id, status)")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(100);
}

export type SessionRow = QueryData<ReturnType<typeof sessionsQuery>>[number];

export function useSessions() {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["sessions", userId],
    queryFn: async () => {
      const { data, error } = await sessionsQuery(userId);
      if (error) throw error;
      return data;
    },
  });
}
