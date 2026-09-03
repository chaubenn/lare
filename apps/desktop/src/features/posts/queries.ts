import type { QueryData } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { parseAiReview } from "@/lib/json";
import { supabase } from "@/lib/supabase";

const POST_DETAIL_SELECT =
  "*, profiles!posts_user_id_fkey(handle, display_name, avatar_url), sessions(*, session_problems(*, submissions(*))), videos(*)" as const;

function postQuery(id: string) {
  return supabase.from("posts").select(POST_DETAIL_SELECT).eq("id", id).maybeSingle();
}

export type PostDetail = NonNullable<QueryData<ReturnType<typeof postQuery>>>;

export const postKey = (id: string) => ["post", id] as const;

export function usePost(id: string) {
  return useQuery({
    queryKey: postKey(id),
    queryFn: async () => {
      const { data, error } = await postQuery(id);
      if (error) throw error;
      return data;
    },
  });
}

/** AI review for a session; RLS returns nothing when the viewer may not see insights. */
export function useInterviewReview(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: ["interview-review", sessionId],
    enabled: !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interview_reviews")
        .select("*")
        .eq("session_id", sessionId ?? "")
        .maybeSingle();
      if (error) throw error;
      return data ? parseAiReview(data) : null;
    },
  });
}
