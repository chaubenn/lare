// POST { mode?, title?, sessionId?, captureSource?: "desktop" | "extension" | "web", mimeType? }
// Creates a Bunny Stream video + our `videos` row and returns TUS credentials so
// browser and native clients upload directly to Bunny without seeing the API key.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  BUNNY_TUS_ENDPOINT,
  createVideo,
  deleteVideo,
  libraryId,
  tusSignature,
} from "../_shared/bunny.ts";
import { HttpError, handler, json, readJson } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

interface Body {
  mode?: "instant" | "studio";
  title?: string;
  sessionId?: string | null;
  captureSource?: "desktop" | "extension" | "web";
  mimeType?: string;
}

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
    const { id: userId } = await requireUser(req);
    const body = await readJson<Body>(req);
    if (!body || typeof body !== "object") throw new HttpError("Invalid body", 400);
    if (body.mode !== undefined && !["instant", "studio"].includes(body.mode))
      throw new HttpError("Invalid mode", 400);
    if (body.title !== undefined && typeof body.title !== "string")
      throw new HttpError("Invalid title", 400);
    if (body.sessionId != null && (typeof body.sessionId !== "string" || !body.sessionId.trim()))
      throw new HttpError("Invalid sessionId", 400);
    const captureSource = body.captureSource ?? "desktop";
    if (!["desktop", "extension", "web"].includes(captureSource))
      throw new HttpError("Invalid captureSource", 400);
    const mimeType = body.mimeType ?? "video/mp4";
    if (
      typeof mimeType !== "string" ||
      !/^video\/(mp4|webm)(;codecs=[a-zA-Z0-9., -]+)?$/.test(mimeType)
    )
      throw new HttpError("Invalid mimeType", 400);
    const mode = body.mode === "studio" ? "studio" : "instant";
    const title = (body.title ?? "Lare recording").slice(0, 120);

    const admin = adminClient();
    if (body.sessionId) {
      const { data: session } = await admin
        .from("sessions")
        .select("id, user_id")
        .eq("id", body.sessionId)
        .maybeSingle();
      if (!session || session.user_id !== userId) throw new HttpError("Session not found", 404);
    }

    const bunny = await createVideo(title);
    const { data: video, error } = await admin
      .from("videos")
      .insert({
        user_id: userId,
        bunny_video_id: bunny.guid,
        library_id: libraryId(),
        mode,
        status: "created",
        title,
        session_id: body.sessionId ?? null,
        capture_source: captureSource,
      })
      .select("id")
      .single();
    if (error || !video) {
      await deleteVideo(bunny.guid).catch(() =>
        console.error("Failed to clean up unlinked Bunny video", bunny.guid),
      );
      throw new HttpError("Could not create recording", 500);
    }

    const expire = Math.floor(Date.now() / 1000) + 24 * 3600;
    const signature = await tusSignature(bunny.guid, expire);
    return json({
      videoId: video.id,
      bunnyVideoId: bunny.guid,
      libraryId: libraryId(),
      tus: {
        endpoint: BUNNY_TUS_ENDPOINT,
        headers: {
          AuthorizationSignature: signature,
          AuthorizationExpire: String(expire),
          LibraryId: String(libraryId()),
          VideoId: bunny.guid,
        },
        metadata: { filetype: mimeType, title },
      },
    });
  }),
);
