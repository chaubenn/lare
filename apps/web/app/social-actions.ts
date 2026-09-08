"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/post-utils";
import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  error: string | null;
}

export interface LikeResult extends ActionResult {
  liked: boolean;
  count: number;
}

/** Signed-in client, or null when the caller has no session. RLS is still the real gate. */
async function authedClient() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  return userId ? { supabase, userId } : null;
}

function revalidatePost() {
  // Route pattern, not a literal path: the public URL is the post's slug, so a
  // `/p/<uuid>` string would no longer match the page anyone is actually viewing.
  revalidatePath("/p/[id]", "page");
  revalidatePath("/");
}

/**
 * Like or unlike in one round-trip. `toggle_post_like` does the insert/delete and reports the
 * new count from the counter column, so the button never has to count rows itself.
 */
export async function togglePostLike(postId: string, current: boolean): Promise<LikeResult> {
  if (!isUuid(postId)) return { liked: current, count: 0, error: "Invalid post id" };
  const auth = await authedClient();
  if (!auth) return { liked: current, count: 0, error: "Sign in to like posts." };

  const { data, error } = await auth.supabase.rpc("toggle_post_like", { post: postId });
  if (error) return { liked: current, count: 0, error: error.message };

  const result = (data ?? {}) as { liked?: boolean; like_count?: number };
  revalidatePost();
  return {
    liked: result.liked ?? !current,
    count: result.like_count ?? 0,
    error: null,
  };
}

export async function addComment(postId: string, body: string): Promise<ActionResult> {
  if (!isUuid(postId)) return { error: "Invalid post id" };
  const trimmed = body.trim();
  if (trimmed.length === 0) return { error: "Write something first." };
  if (trimmed.length > 2000) return { error: "Comments are limited to 2000 characters." };

  const auth = await authedClient();
  if (!auth) return { error: "Sign in to comment." };

  const { error } = await auth.supabase
    .from("post_comments")
    .insert({ post_id: postId, user_id: auth.userId, body: trimmed });
  if (error) return { error: error.message };
  revalidatePost();
  return { error: null };
}

export async function updateComment(commentId: string, body: string): Promise<ActionResult> {
  if (!isUuid(commentId)) return { error: "Invalid comment id" };
  const trimmed = body.trim();
  if (trimmed.length === 0) return { error: "Write something first." };
  if (trimmed.length > 2000) return { error: "Comments are limited to 2000 characters." };

  const auth = await authedClient();
  if (!auth) return { error: "Sign in to edit your comment." };

  const { error } = await auth.supabase
    .from("post_comments")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) return { error: error.message };
  revalidatePost();
  return { error: null };
}

/** RLS lets the comment's author or the post's owner delete it. */
export async function deleteComment(commentId: string): Promise<ActionResult> {
  if (!isUuid(commentId)) return { error: "Invalid comment id" };
  const auth = await authedClient();
  if (!auth) return { error: "Sign in to delete your comment." };

  const { error } = await auth.supabase.from("post_comments").delete().eq("id", commentId);
  if (error) return { error: error.message };
  revalidatePost();
  return { error: null };
}
