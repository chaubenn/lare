// POST { videoId } -> { embedUrl, token, expires, libraryId, guid, status }
// Authorisation is delegated to RLS: the caller's client can only select the
// `videos` row if they own it or can view a post that references it (works for
// anonymous viewers of public posts too).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { embedToken, embedUrl, libraryId } from "../_shared/bunny.ts";
import { HttpError, handler, json, readJson } from "../_shared/http.ts";
import { optionalUser } from "../_shared/supabase.ts";

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
    const body = await readJson<{ videoId?: string }>(req);
    if (!body.videoId) throw new HttpError("videoId required");
    const { client } = await optionalUser(req);
    const { data: video, error } = await client
      .from("videos")
      .select("id, bunny_video_id, status, duration_ms, width, height")
      .eq("id", body.videoId)
      .maybeSingle();
    if (error) throw new HttpError(error.message, 500);
    if (!video || !video.bunny_video_id) throw new HttpError("Video not found", 404);

    const expires = Math.floor(Date.now() / 1000) + 6 * 3600;
    const token = await embedToken(video.bunny_video_id, expires);
    return json({
      libraryId: libraryId(),
      guid: video.bunny_video_id,
      status: video.status,
      durationMs: video.duration_ms,
      width: video.width,
      height: video.height,
      token,
      expires,
      embedUrl: embedUrl(video.bunny_video_id, { token, expires }),
    });
  }),
);
