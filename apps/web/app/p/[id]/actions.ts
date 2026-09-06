"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isUuid } from "@/lib/post-utils";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";

export interface ActionResult {
  error: string | null;
}

/**
 * Ask the og-snapshot function to (re)generate the stored session card after the response —
 * on publish, and after edits that change what the card shows.
 */
function regenerateCard(supabase: ServerSupabase, postId: string, force: boolean) {
  after(async () => {
    try {
      await supabase.functions.invoke("og-snapshot", {
        body: force ? { postId, force: true } : { postId },
      });
    } catch {
      // Best effort; the post page lazily ensures a card too.
    }
  });
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
  if (status === "published") regenerateCard(supabase, postId, false);
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

export interface PostEdit {
  title: string;
  body: string;
  visibility: "public" | "private";
  show_video: boolean;
  show_demo_video: boolean;
  include_ai_insights: boolean;
  include_og_card: boolean;
  og_show_ai_scores: boolean;
  cover_media_id: string | null;
}

/** Save the whole "edit post" form. Empty strings become NULL, matching how drafts publish. */
export async function updatePost(postId: string, edit: PostEdit): Promise<ActionResult> {
  const supabase = await ownedPost(postId);
  const title = edit.title.trim();
  const body = edit.body.trim();
  if (title.length > 140) return { error: "Keep the title under 140 characters." };
  if (body.length > 5000) return { error: "Keep the body under 5000 characters." };

  const { error } = await supabase
    .from("posts")
    .update({
      title: title.length > 0 ? title : null,
      body: body.length > 0 ? body : null,
      visibility: edit.visibility,
      show_video: edit.show_video,
      show_demo_video: edit.show_demo_video,
      include_ai_insights: edit.include_ai_insights,
      include_og_card: edit.include_og_card,
      og_show_ai_scores: edit.og_show_ai_scores,
      cover_media_id: edit.cover_media_id,
    })
    .eq("id", postId);
  if (error) return { error: error.message };
  regenerateCard(supabase, postId, true);
  revalidatePost(postId);
  return { error: null };
}

export async function setPostCover(postId: string, mediaId: string | null): Promise<ActionResult> {
  const supabase = await ownedPost(postId);
  const { error } = await supabase
    .from("posts")
    .update({ cover_media_id: mediaId })
    .eq("id", postId);
  if (error) return { error: error.message };
  revalidatePost(postId);
  return { error: null };
}

/** Drop a photo: the row first (so nothing renders a dead link), then the stored object. */
export async function removePostImage(postId: string, mediaId: string): Promise<ActionResult> {
  if (!isUuid(mediaId)) return { error: "Invalid image id" };
  const supabase = await ownedPost(postId);
  const { data: media, error: readError } = await supabase
    .from("post_media")
    .select("id, storage_path")
    .eq("id", mediaId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!media) return { error: "Image not found" };

  const { error } = await supabase.from("post_media").delete().eq("id", mediaId);
  if (error) return { error: error.message };
  await supabase.storage.from("post-media").remove([media.storage_path]);
  revalidatePost(postId);
  return { error: null };
}

/** Persist drag-to-reorder: `ids` is the new order, front to back. */
export async function reorderPostImages(postId: string, ids: string[]): Promise<ActionResult> {
  const supabase = await ownedPost(postId);
  for (const [index, id] of ids.entries()) {
    if (!isUuid(id)) return { error: "Invalid image id" };
    const { error } = await supabase
      .from("post_media")
      .update({ position: index })
      .eq("id", id)
      .eq("post_id", postId);
    if (error) return { error: error.message };
  }
  revalidatePost(postId);
  return { error: null };
}

export async function setImageCaption(
  postId: string,
  mediaId: string,
  caption: string,
): Promise<ActionResult> {
  if (!isUuid(mediaId)) return { error: "Invalid image id" };
  const trimmed = caption.trim();
  if (trimmed.length > 280) return { error: "Captions are limited to 280 characters." };
  const supabase = await ownedPost(postId);
  const { error } = await supabase
    .from("post_media")
    .update({ caption: trimmed.length > 0 ? trimmed : null })
    .eq("id", mediaId)
    .eq("post_id", postId);
  if (error) return { error: error.message };
  revalidatePost(postId);
  return { error: null };
}

/** Row inserted by the browser after it uploads the file straight to storage. */
export async function registerPostImage(
  postId: string,
  storagePath: string,
  width: number | null,
  height: number | null,
): Promise<ActionResult> {
  const supabase = await ownedPost(postId);
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) return { error: "Sign in to add photos." };
  if (!storagePath.startsWith(`${userId}/${postId}/`)) {
    return { error: "Unexpected upload path." };
  }

  const { data: last } = await supabase
    .from("post_media")
    .select("position")
    .eq("post_id", postId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("post_media").insert({
    post_id: postId,
    user_id: userId,
    storage_path: storagePath,
    width,
    height,
    position: (last?.position ?? -1) + 1,
  });
  if (error) return { error: error.message };
  revalidatePost(postId);
  return { error: null };
}
