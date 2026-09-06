import type { QueryData } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { postKey } from "./queries";

const COMMENT_SELECT =
  "id, post_id, user_id, body, edited_at, created_at, profiles!post_comments_user_id_fkey(handle, display_name, avatar_url)" as const;

function commentsQuery(postId: string) {
  return supabase
    .from("post_comments")
    .select(COMMENT_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
}

export type PostComment = QueryData<ReturnType<typeof commentsQuery>>[number];

export const commentsKey = (postId: string) => ["post-comments", postId] as const;
export const likeKey = (postId: string) => ["post-like", postId] as const;

/** Whether the signed-in user has liked this post. The count lives on `posts.like_count`. */
export function useViewerLike(postId: string, userId: string) {
  return useQuery({
    queryKey: likeKey(postId),
    enabled: postId.length > 0 && userId.length > 0,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("post_likes")
        .select("post_id", { count: "exact", head: true })
        .eq("post_id", postId)
        .eq("user_id", userId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
}

export function useToggleLike(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("toggle_post_like", { post: postId });
      if (error) throw error;
      return (data ?? {}) as { liked?: boolean; like_count?: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: likeKey(postId) });
      void queryClient.invalidateQueries({ queryKey: postKey(postId) });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}

export function useComments(postId: string) {
  return useQuery({
    queryKey: commentsKey(postId),
    enabled: postId.length > 0,
    queryFn: async () => {
      const { data, error } = await commentsQuery(postId);
      if (error) throw error;
      return data;
    },
  });
}

function useCommentMutation<TVars>(postId: string, run: (vars: TVars) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commentsKey(postId) });
      void queryClient.invalidateQueries({ queryKey: postKey(postId) });
    },
  });
}

export function useAddComment(postId: string, userId: string) {
  return useCommentMutation<string>(postId, async (body) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) throw new Error("Write something first.");
    const { error } = await supabase
      .from("post_comments")
      .insert({ post_id: postId, user_id: userId, body: trimmed });
    if (error) throw error;
  });
}

export function useUpdateComment(postId: string) {
  return useCommentMutation<{ id: string; body: string }>(postId, async ({ id, body }) => {
    const trimmed = body.trim();
    if (trimmed.length === 0) throw new Error("Write something first.");
    const { error } = await supabase
      .from("post_comments")
      .update({ body: trimmed, edited_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  });
}

/** RLS lets the comment's author or the post's owner delete it. */
export function useDeleteComment(postId: string) {
  return useCommentMutation<string>(postId, async (id) => {
    const { error } = await supabase.from("post_comments").delete().eq("id", id);
    if (error) throw error;
  });
}
