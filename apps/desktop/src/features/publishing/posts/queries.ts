import type { Post } from "@lare/supabase-types";
import type { QueryData } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAiReview } from "@/lib/json";
import { supabase } from "@/lib/supabase";

const POST_DETAIL_SELECT =
  "*, profiles!posts_user_id_fkey(handle, display_name, avatar_url), sessions(*, session_problems(*, submissions(*))), videos!posts_video_id_fkey(*), demo_videos:videos!posts_demo_video_id_fkey(*)" as const;

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
        .select("*, sessions!inner(graded)")
        .eq("session_id", sessionId ?? "")
        .maybeSingle();
      if (error) throw error;
      return data?.sessions.graded ? parseAiReview(data) : null;
    },
  });
}

export interface PostEdit {
  id: string;
  title: string;
  body: string;
  visibility: Post["visibility"];
  showVideo: boolean;
  /** Show the interview's summary video as a slide, ahead of the full recording. */
  showDemoVideo: boolean;
}

/** Edit an already published post. RLS restricts the update to its owner. */
/** Removes the post only; the session it came from stays in the account. */
export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: postKey(id) });
      for (const key of ["feed", "user-posts", "profile-stats", "sessions", "drafts"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title, body, visibility, showVideo, showDemoVideo }: PostEdit) => {
      const { error } = await supabase
        .from("posts")
        .update({
          title: title.trim() || null,
          body: body.trim() || null,
          visibility,
          show_video: showVideo,
          show_demo_video: showDemoVideo,
          // The session card always leads a post, so nothing here picks a cover.
          cover_media_id: null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: postKey(vars.id) });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}
