// POST { videoId, vtt, lang?: "en", label?: "English" } — owner-only.
// Attaches a WebVTT caption track (the whisper transcript) to the Bunny video.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { uploadCaptions } from "../_shared/bunny.ts";
import { HttpError, handler, json, readJson } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

const MAX_VTT_BYTES = 2 * 1024 * 1024;
const LANG_RE = /^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/;

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
    const { id: userId } = await requireUser(req);
    const body = await readJson<{ videoId?: string; vtt?: string; lang?: string; label?: string }>(
      req,
    );
    if (!body.videoId) throw new HttpError("videoId required");
    if (!body.vtt?.startsWith("WEBVTT")) throw new HttpError("vtt must be WebVTT text");
    if (body.vtt.length > MAX_VTT_BYTES) throw new HttpError("captions too large", 413);
    const lang = body.lang ?? "en";
    if (!LANG_RE.test(lang)) throw new HttpError("invalid lang");
    const label = (body.label ?? "English").slice(0, 40);

    const admin = adminClient();
    const { data: video } = await admin
      .from("videos")
      .select("id, user_id, bunny_video_id")
      .eq("id", body.videoId)
      .maybeSingle();
    if (!video || video.user_id !== userId) throw new HttpError("Video not found", 404);
    if (!video.bunny_video_id) throw new HttpError("Video has not been uploaded yet", 409);

    await uploadCaptions(video.bunny_video_id, lang, label, body.vtt);
    return json({ ok: true, lang });
  }),
);
