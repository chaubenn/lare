// Bunny Stream webhook: { VideoLibraryId, VideoGuid, Status }, signed with
// X-BunnyStream-Signature (HMAC-SHA256 over the raw body, key = read-only API key).
// Deployed with verify_jwt = false; authentication is the HMAC check.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getVideo, libraryId, mapWebhookStatus, verifyWebhookSignature } from "../_shared/bunny.ts";
import { handler, json } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") return json({ ok: true, info: "bunny webhook" });
    const raw = await req.text();
    const ok = await verifyWebhookSignature(raw, req.headers.get("X-BunnyStream-Signature"));
    if (!ok) return json({ error: "invalid signature" }, 401);

    const payload = JSON.parse(raw) as {
      VideoLibraryId?: number;
      VideoGuid?: string;
      Status?: number;
    };
    if (Number(payload.VideoLibraryId) !== libraryId() || !payload.VideoGuid) {
      return json({ ignored: true });
    }
    const status = mapWebhookStatus(Number(payload.Status));
    if (!status) return json({ ignored: true, status: payload.Status });

    const admin = adminClient();
    const patch: Record<string, unknown> = { status };
    if (status === "ready") {
      patch.ready_at = new Date().toISOString();
      const details = await getVideo(payload.VideoGuid).catch(() => null);
      if (details) {
        patch.duration_ms = Math.round((details.length ?? 0) * 1000);
        patch.width = details.width || null;
        patch.height = details.height || null;
      }
    }
    if (status === "failed") patch.error = `Bunny status ${payload.Status}`;

    // Never regress a video that is already ready (e.g. late "processing" events).
    const query = admin.from("videos").update(patch).eq("bunny_video_id", payload.VideoGuid);
    const { error } = status === "ready" ? await query : await query.neq("status", "ready");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status });
  }),
);
