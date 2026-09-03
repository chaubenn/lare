import { BUNNY_EMBED_BASE } from "@lare/shared";
import type { Video } from "@lare/supabase-types";
import { Video as VideoIcon } from "lucide-react";
import { env } from "@/lib/env";

const STATUS_TEXT: Record<Video["status"], string> = {
  created: "Video is waiting to be uploaded.",
  uploading: "Video is uploading…",
  uploaded: "Video uploaded — waiting for encoding to start.",
  processing: "Video is processing. It will appear here when it's ready.",
  ready: "",
  failed: "Video processing failed.",
};

/**
 * Bunny Stream player for a ready video; a status placeholder otherwise.
 * The iframe URL is `https://player.mediadelivery.net/embed/{libraryId}/{guid}`.
 */
export function VideoEmbed({ video, title = "Demo video" }: { video: Video; title?: string }) {
  const libraryId = video.library_id || env.VITE_BUNNY_LIBRARY_ID;
  if (video.status === "ready" && video.bunny_video_id) {
    const src = `${BUNNY_EMBED_BASE}/${libraryId}/${video.bunny_video_id}?autoplay=false&preload=true`;
    return (
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
        <iframe
          title={title}
          src={src}
          loading="lazy"
          className="aspect-video w-full"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 text-center">
      <VideoIcon className="size-6 text-zinc-600" aria-hidden />
      <p className="text-sm text-zinc-400">{STATUS_TEXT[video.status] || "Video unavailable."}</p>
      {video.error ? <p className="max-w-sm text-xs text-rose-400">{video.error}</p> : null}
    </div>
  );
}
