import type { Post } from "@lare/supabase-types";
import type { QueryData } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAiReview } from "@/lib/json";
import { queryKeys, refresh } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";

const POST_DETAIL_SELECT =
  "*, profiles!posts_user_id_fkey(handle, display_name, avatar_url), sessions(*, session_problems(*, submissions(*))), videos!posts_video_id_fkey(*), demo_videos:videos!posts_demo_video_id_fkey(*)" as const;

function postQuery(id: string) {
  return supabase.from("posts").select(POST_DETAIL_SELECT).eq("id", id).maybeSingle();
}

export type PostDetail = NonNullable<QueryData<ReturnType<typeof postQuery>>>;

export function usePost(id: string) {
  return useQuery({
    queryKey: queryKeys.post.of(id),
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
    queryKey: queryKeys.interviewReview(sessionId),
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

/** What the draft form and the post editor both edit. */
export interface PostEdit {
  id: string;
  title: string;
  body: string;
  visibility: Post["visibility"];
  /** Show the attached video as a slide on the post. */
  showVideo: boolean;
  /** Show the interview's summary video as a slide, ahead of the full recording. */
  showDemoVideo: boolean;
}

/** The columns the form owns, shared by "save draft", "publish" and editing a published post. */
export function postPatch(edit: PostEdit) {
  return {
    title: edit.title.trim() || null,
    body: edit.body.trim() || null,
    visibility: edit.visibility,
    show_video: edit.showVideo,
    show_demo_video: edit.showDemoVideo,
    // Posts have no cover image any more: the first image, if any, simply comes first.
    cover_media_id: null,
  };
}

/** Delete a post or a draft. The session it came from stays in the account. */
export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) throw error;
}

export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePost,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.post.of(id) });
      void refresh.publishedPostLists(queryClient);
    },
  });
}

/** Edit an already published post. RLS restricts the update to its owner. */
export function useUpdatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (edit: PostEdit) => {
      const { error } = await supabase.from("posts").update(postPatch(edit)).eq("id", edit.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.post.of(vars.id) });
      void refresh.postCards(queryClient);
    },
  });
}
