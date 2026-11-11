import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";

/**
 * A draft for an ended session that has no post (the extension never made one, or it was
 * deleted). Resolves with the post id; an existing post's id when there already is one.
 */
export function useCreateSessionDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc("create_session_draft", {
        p_session_id: sessionId,
      });
      if (error) throw error;
      if (!data) throw new Error("No draft was created");
      return data;
    },
    onSuccess: (_postId, sessionId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.post(sessionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.drafts.all });
    },
  });
}
