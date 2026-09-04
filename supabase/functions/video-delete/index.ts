// POST { videoId } — owner-only. Deletes the Bunny video, the thumbnail object and
// the `videos` row (posts.video_id becomes null via ON DELETE SET NULL).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { deleteVideo } from "../_shared/bunny.ts";
import { HttpError, handler, json, readJson } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
    const { id: userId } = await requireUser(req);
    const body = await readJson<{ videoId?: string }>(req);
    if (!body.videoId) throw new HttpError("videoId required");

    const admin = adminClient();
    const { data: video } = await admin
      .from("videos")
      .select("id, user_id, bunny_video_id, thumbnail_path")
      .eq("id", body.videoId)
      .maybeSingle();
    if (!video || video.user_id !== userId) throw new HttpError("Video not found", 404);

    if (video.bunny_video_id) await deleteVideo(video.bunny_video_id);
    if (video.thumbnail_path) {
      await admin.storage
        .from("thumbnails")
        .remove([video.thumbnail_path])
        .catch(() => undefined);
    }
    await admin
      .from("posts")
      .update({ video_id: null, video_kind: "none" })
      .eq("video_id", video.id);
    const { error } = await admin.from("videos").delete().eq("id", video.id);
    if (error) throw new HttpError(error.message, 500);
    return json({ ok: true });
  }),
);
