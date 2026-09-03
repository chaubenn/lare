"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/post-utils";
import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  error: string | null;
}

/** RLS restricts updates/deletes to the owner; a non-owner simply affects zero rows. */
async function ownedPost(postId: string) {
  if (!isUuid(postId)) throw new Error("Invalid post id");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) redirect(`/login?next=${encodeURIComponent(`/p/${postId}`)}`);
  return supabase;
}

function revalidatePost(postId: string) {
  revalidatePath(`/p/${postId}`);
  revalidatePath("/");
}

export async function setPostStatus(
  postId: string,
  status: "draft" | "published",
): Promise<ActionResult> {
  const supabase = await ownedPost(postId);
  const patch =
    status === "published" ? { status, published_at: new Date().toISOString() } : { status };
  const { error } = await supabase.from("posts").update(patch).eq("id", postId);
  if (error) return { error: error.message };
  revalidatePost(postId);
  return { error: null };
}

export async function setPostVisibility(
  postId: string,
  visibility: "public" | "private",
): Promise<ActionResult> {
  const supabase = await ownedPost(postId);
  const { error } = await supabase.from("posts").update({ visibility }).eq("id", postId);
  if (error) return { error: error.message };
  revalidatePost(postId);
  return { error: null };
}

export async function deletePost(postId: string): Promise<ActionResult> {
  const supabase = await ownedPost(postId);
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) return { error: error.message };
  revalidatePath("/");
  redirect("/");
}
