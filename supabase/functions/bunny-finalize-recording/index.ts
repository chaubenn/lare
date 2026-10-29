// Receipt confirmation only. Clients must first finish deferred TUS with Upload-Length.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getVideo, libraryId, mapWebhookStatus } from "../_shared/bunny.ts";
import { HttpError, handler, json, readJson } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
    const user = await requireUser(req);
    const body = await readJson<{ videoId: string; sizeBytes: number; durationMs: number }>(req);
    if (
      !body ||
      typeof body.videoId !== "string" ||
      !Number.isSafeInteger(body.sizeBytes) ||
      body.sizeBytes <= 0 ||
      !Number.isSafeInteger(body.durationMs) ||
      body.durationMs < 0 ||
      body.durationMs > 2147483647
    ) {
      throw new HttpError("Invalid recording metadata", 400);
    }
    const admin = adminClient();
    const { data: video, error } = await admin
      .from("videos")
      .select("id,user_id,bunny_video_id,library_id,status")
      .eq("id", body.videoId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new HttpError("Could not read recording", 500);
    if (!video?.bunny_video_id || Number(video.library_id) !== libraryId())
      throw new HttpError("Recording not found", 404);
    // Never trust a client-provided upload URL (SSRF) or mark an unreceived video playable.
    const bunny = await getVideo(video.bunny_video_id);
    if (!bunny || ![1, 2, 3, 4, 7].includes(bunny.status)) {
      throw new HttpError("Bunny has not confirmed receipt yet; retry finalization", 409);
    }
    const status = mapWebhookStatus(bunny.status);
    if (!status) throw new HttpError("Unknown Bunny status", 409);
    const patch: Record<string, unknown> = {
      size_bytes: body.sizeBytes,
      duration_ms: body.durationMs,
    };
    if (video.status !== "ready") patch.status = status;
    if (status === "ready") {
      if (video.status !== "ready") patch.ready_at = new Date().toISOString();
      patch.width = bunny.width || null;
      patch.height = bunny.height || null;
    }
    // Compare-and-set prevents a concurrent ready webhook being regressed by finalization.
    const { data: updated, error: updateError } = await admin
      .from("videos")
      .update(patch)
      .eq("id", video.id)
      .eq("user_id", user.id)
      .eq("status", video.status)
      .select("id")
      .maybeSingle();
    if (updateError) throw new HttpError("Could not finalize recording", 500);
    if (!updated) throw new HttpError("Recording status changed; retry finalization", 409);
    return json({ videoId: video.id, status: video.status === "ready" ? "ready" : status });
  }),
);
