import { BUNNY_EMBED_BASE } from "@lare/shared";
import type { Video } from "@lare/supabase-types";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Video as VideoIcon } from "lucide-react";
import { env } from "@/lib/env";
import { invokeFunction } from "@/lib/supabase";

const STATUS_TEXT: Record<Video["status"], string> = {
  created: "Video is waiting to be uploaded.",
  uploading: "Video is uploading…",
  uploaded: "Video uploaded — waiting for encoding to start.",
  processing: "Video is processing. It will appear here when it's ready.",
  ready: "",
  failed: "Video processing failed.",
};

interface PlaybackToken {
  embedUrl: string;
  token: string;
  expires: number;
}

/** Signed embed URL from the `bunny-playback-token` function (library uses token auth). */
export function usePlaybackUrl(video: Pick<Video, "id" | "status" | "bunny_video_id">) {
  return useQuery({
    queryKey: ["playback-url", video.id, video.status],
    enabled: video.status === "ready" && !!video.bunny_video_id,
    staleTime: 4 * 3600 * 1000,
    retry: 1,
    queryFn: () => invokeFunction<PlaybackToken>("bunny-playback-token", { videoId: video.id }),
  });
}

/**
 * Bunny Stream player for a ready video; a status placeholder otherwise.
 * The iframe URL is `https://player.mediadelivery.net/embed/{libraryId}/{guid}?token=…&expires=…`.
 * `startAt` (seconds) is appended as `&t=…s`; changing it re-mounts the iframe, which is how
 * callers seek (the player does not expose a postMessage seek API to us).
 */
export function VideoEmbed({
  video,
  title = "Demo video",
  startAt,
}: {
  video: Video;
  title?: string;
  startAt?: number;
}) {
  const libraryId = video.library_id || env.VITE_BUNNY_LIBRARY_ID;
  const playback = usePlaybackUrl(video);
  if (video.status === "ready" && video.bunny_video_id) {
    if (playback.isPending) {
      return (
        <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-zinc-800 bg-black">
          <LoaderCircle className="size-5 animate-spin text-zinc-500" aria-label="Loading player" />
        </div>
      );
    }
    // Fall back to the plain embed if token minting fails (e.g. token auth disabled).
    const base =
      playback.data?.embedUrl ??
      `${BUNNY_EMBED_BASE}/${libraryId}/${video.bunny_video_id}?autoplay=false&preload=true`;
    const start =
      startAt !== undefined && Number.isFinite(startAt) ? Math.max(0, Math.floor(startAt)) : null;
    const src = start === null ? base : `${base}${base.includes("?") ? "&" : "?"}t=${start}s`;
    return (
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
        <iframe
          key={start === null ? "start" : `t-${start}`}
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
