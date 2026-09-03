// POST { mode: "instant" | "studio", title?: string, sessionId?: string }
// Creates a Bunny Stream video + our `videos` row and returns TUS credentials so
// the desktop app can upload directly to Bunny without ever seeing the API key.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { BUNNY_TUS_ENDPOINT, createVideo, libraryId, tusSignature } from "../_shared/bunny.ts";
import { HttpError, handler, json, readJson } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

interface Body {
  mode?: "instant" | "studio";
  title?: string;
  sessionId?: string | null;
}

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
    const { id: userId } = await requireUser(req);
    const body = await readJson<Body>(req);
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
      })
      .select("id")
      .single();
    if (error || !video) throw new HttpError(`videos insert failed: ${error?.message}`, 500);

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
        metadata: { filetype: "video/mp4", title },
      },
    });
  }),
);
