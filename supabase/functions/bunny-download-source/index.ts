import { getVideo, libraryId } from "../_shared/bunny.ts";
import { env, HttpError, handler, json, readJson } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { sourceUrl } from "./source.ts";

export const downloadSource = handler(async (req) => {
  if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
  const user = await requireUser(req);
  const body = await readJson<{ videoId?: string }>(req);
  if (!body || typeof body.videoId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.videoId))
    throw new HttpError("Invalid videoId", 400);
  const { data: video, error } = await adminClient()
    .from("videos")
    .select("user_id, bunny_video_id, library_id")
    .eq("id", body.videoId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new HttpError("Could not look up source", 500);
  if (!video || video.library_id !== libraryId()) throw new HttpError("Video not found", 404);
  const bunny = await getVideo(video.bunny_video_id);
  if (!bunny) throw new HttpError("Source unavailable", 409);
  const source = await sourceUrl(bunny, env("BUNNY_CDN_HOST"), env("BUNNY_CDN_TOKEN_KEY"));
  return json(source, 200, { "Cache-Control": "no-store" });
});

if (import.meta.main) Deno.serve(downloadSource);
