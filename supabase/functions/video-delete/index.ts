// POST { videoId } — owner-only. Deletes the Bunny video, the thumbnail object and
// the `videos` row (posts.video_id / posts.demo_video_id become null via ON DELETE SET NULL).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { deleteVideo } from "../_shared/bunny.ts";
import { HttpError, handler, json, readJson } from "../_shared/http.ts";
import { isOwnStoragePath } from "../_shared/storage.ts";
import { adminClient, ownedRow, requireUser } from "../_shared/supabase.ts";

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
    const { id: userId } = await requireUser(req);
    const body = await readJson<{ videoId?: string }>(req);
    if (!body.videoId) throw new HttpError("videoId required");

    const admin = adminClient();
    const video = await ownedRow(
      admin,
      "videos",
      body.videoId,
      userId,
      "id, user_id, bunny_video_id, thumbnail_path",
      "Video not found",
    );

    if (video.bunny_video_id) await deleteVideo(video.bunny_video_id);
    // The service role ignores storage policies, so only a path in the caller's own folder is
    // removed; anything else is left where it is.
    if (video.thumbnail_path && isOwnStoragePath(video.thumbnail_path, userId)) {
      await admin.storage
        .from("thumbnails")
        .remove([video.thumbnail_path])
        .catch(() => undefined);
    } else if (video.thumbnail_path) {
      console.warn("video-delete: not removing a thumbnail outside the caller's folder", video.id);
    }
    // The FK already nulls both slots on delete; this is only about `video_kind`, which
    // describes the main slot and would otherwise still claim there is a video there.
    await admin
      .from("posts")
      .update({ video_id: null, video_kind: "none" })
      .eq("video_id", video.id);
    const { error } = await admin.from("videos").delete().eq("id", video.id);
    if (error) {
      console.error("videos delete failed", error);
      throw new HttpError("Could not delete video", 500);
    }
    return json({ ok: true });
  }),
);
