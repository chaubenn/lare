import { BUNNY_EMBED_BASE } from "@lare/shared";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isUuid } from "@/lib/post-utils";
import { createClient } from "@/lib/supabase/server";

/**
 * Signed Bunny embed URL for one video.
 *
 * The Stream library has embed token authentication switched on, so a plain
 * `player.mediadelivery.net/embed/{library}/{guid}` iframe answers 403 — that was the bug
 * behind "can't see the video on the website". The `bunny-playback-token` Edge Function mints
 * `token` + `expires` for callers that RLS says may read the video row, which covers anonymous
 * visitors looking at a public post as well as the owner.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await ctx.params;
  if (!isUuid(videoId)) {
    return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: video, error } = await supabase
    .from("videos")
    .select("id, bunny_video_id, library_id, status")
    .eq("id", videoId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!video?.bunny_video_id) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
  if (video.status !== "ready") {
    return NextResponse.json({ error: "Video is not ready yet" }, { status: 409 });
  }

  const { data, error: fnError } = await supabase.functions.invoke<{
    embedUrl?: string;
    token?: string;
    expires?: number;
  }>("bunny-playback-token", { body: { videoId } });

  // Falling back to the unsigned URL keeps playback working if token auth is ever turned off;
  // when it is on, the player itself surfaces the failure rather than a blank frame.
  const libraryId = video.library_id || env.bunnyLibraryId;
  const embedUrl =
    data?.embedUrl ??
    `${BUNNY_EMBED_BASE}/${libraryId}/${video.bunny_video_id}?autoplay=false&preload=true&responsive=true`;

  return NextResponse.json(
    { embedUrl, signed: Boolean(data?.embedUrl), error: fnError ? fnError.message : null },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
