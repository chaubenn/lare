"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { DraftEditSchema, validateDraftStep } from "@/lib/drafts";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";

export async function createDraft(form: FormData) {
  const viewer = await requireViewer("/drafts");
  const supabase = await createClient();
  const ids = z.array(z.uuid()).max(100).parse(form.getAll("problem"));
  if (form.get("source") === "tracked" && ids.length === 0)
    throw new Error("Select at least one tracked problem.");
  let id: string;
  if (ids.length) {
    const { data, error } = await supabase.rpc("publish_practice_problems", {
      problem_ids: ids,
      post_title: null,
    });
    if (error || !data) throw new Error(error?.message ?? "Could not create draft.");
    id = data;
  } else {
    const { data, error } = await supabase
      .from("posts")
      .insert({
        user_id: viewer.id,
        status: "draft",
        visibility: "private",
        include_ai_insights: false,
        og_show_ai_scores: false,
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
  }
  revalidatePath("/drafts");
  redirect(`/drafts/${id}`);
}

export async function saveDraft(
  id: string,
  input: unknown,
  publish = false,
): Promise<{ error: string | null; href?: string }> {
  const viewer = await requireViewer(`/drafts/${id}`);
  if (!z.uuid().safeParse(id).success) return { error: "Invalid draft." };
  const parsed = DraftEditSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid draft." };
  const edit = parsed.data;
  const supabase = await createClient();
  const { data: post, error: readError } = await supabase
    .from("posts")
    .select("*, sessions(*, session_problems(id))")
    .eq("id", id)
    .eq("user_id", viewer.id)
    .eq("status", "draft")
    .maybeSingle();
  if (readError || !post)
    return { error: readError?.message ?? "Draft not found or already published." };
  if (post.sessions && post.sessions.user_id !== viewer.id) return { error: "Session not found." };
  if (post.sessions?.kind === "interview" && edit.video_id !== post.video_id)
    return {
      error: "Interview recordings are attached by the extension, not the browser recorder.",
    };
  if (edit.video_id && edit.video_id === edit.demo_video_id)
    return { error: "The summary must be a different video from the full recording." };
  if (!post.session_id && edit.demo_video_id) return { error: "A summary video needs a session." };
  for (const videoId of [edit.video_id, edit.demo_video_id]) {
    if (!videoId) continue;
    const { data: video, error } = await supabase
      .from("videos")
      .select("id, status, session_id")
      .eq("id", videoId)
      .eq("user_id", viewer.id)
      .maybeSingle();
    if (error || !video) return { error: "Choose one of your own videos." };
    if (video.session_id && video.session_id !== post.session_id)
      return { error: "This video belongs to a different session." };
    if (publish && ["created", "uploading", "failed"].includes(video.status))
      return { error: "Finish uploading the attached videos before publishing." };
  }
  if (publish) {
    if (post.sessions && post.sessions.status !== "ended")
      return { error: "End the session in the extension before publishing." };
    for (let step = 0; step < 5; step++) {
      const error = validateDraftStep(
        step,
        edit,
        post.sessions?.session_problems.length ?? 0,
        !!post.session_id,
      );
      if (error) return { error };
    }
  }
  const ungraded = post.sessions?.graded === false;
  const { data, error } = await supabase
    .from("posts")
    .update({
      ...edit,
      ...(ungraded ? { include_ai_insights: false, og_show_ai_scores: false } : {}),
      video_kind: edit.video_id
        ? edit.video_id === post.video_id && post.video_kind !== "none"
          ? post.video_kind
          : "full"
        : "none",
      title: edit.title.trim() || null,
      body: edit.body.trim() || null,
      ...(publish ? { status: "published" as const, published_at: new Date().toISOString() } : {}),
    })
    .eq("id", id)
    .eq("user_id", viewer.id)
    .eq("status", "draft")
    .select("id, slug")
    .maybeSingle();
  if (error || !data) return { error: error?.message ?? "Draft changed or no longer exists." };
  if (publish) {
    after(async () => {
      await supabase.functions.invoke("og-snapshot", { body: { postId: id, force: true } });
    });
    revalidatePath("/drafts");
    revalidatePath("/sessions");
    revalidatePath("/");
  }
  return { error: null, ...(publish ? { href: `/p/${data.slug}` } : {}) };
}
