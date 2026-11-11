import { BUNNY_EMBED_BASE } from "@lare/shared";
import type { Video } from "@lare/supabase-types";
import { LoaderCircle, Video as VideoIcon } from "@lare/ui/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { env } from "@/lib/env";
import { LocalPreview } from "./LocalPreview";
import { useLocalVideoSrc } from "./localCopies";
import { cachedPlaybackUrl, fetchPlaybackUrl } from "./playback";

const STATUS_TEXT: Record<Video["status"], string> = {
  created: "Video is waiting to be uploaded.",
  uploading: "Video is uploading…",
  uploaded: "Video uploaded — waiting for encoding to start.",
  processing: "Video is processing. It will appear here when it's ready.",
  ready: "",
  failed: "Video processing failed.",
};

interface Embed {
  videoId: string;
  /** Where the player starts, in whole seconds; null for the beginning. */
  start: number | null;
  url: string;
}

/**
 * The embed URL for a ready video, fetched again for every `start`: each seek loads the player
 * afresh, and a playback token only lives a few minutes. It is the signed URL, or the plain embed
 * when a token cannot be minted (token auth disabled, say). Null until the first one arrives;
 * after that the previous one stays while the next is fetched.
 */
function useEmbed(video: Video, start: number | null): Embed | null {
  const queryClient = useQueryClient();
  const ready = video.status === "ready" && !!video.bunny_video_id;
  const libraryId = video.library_id || env.VITE_BUNNY_LIBRARY_ID;
  const plainUrl = `${BUNNY_EMBED_BASE}/${libraryId}/${video.bunny_video_id}?autoplay=false&preload=true`;
  const [embed, setEmbed] = useState<Embed | null>(() => {
    const url = ready ? cachedPlaybackUrl(queryClient, video.id) : null;
    return url ? { videoId: video.id, start, url } : null;
  });

  useEffect(() => {
    if (!ready) return;
    let live = true;
    fetchPlaybackUrl(queryClient, video.id)
      .catch(() => plainUrl)
      .then((url) => {
        if (live) setEmbed({ videoId: video.id, start, url });
      });
    return () => {
      live = false;
    };
  }, [ready, video.id, start, plainUrl, queryClient]);

  return embed?.videoId === video.id ? embed : null;
}

/**
 * Bunny Stream player for a ready video; a status placeholder otherwise.
 * `startAt` (seconds) is appended to the embed URL as `&t=…s`; changing it re-mounts the iframe,
 * which is how callers seek (the player does not expose a postMessage seek API to us).
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
  const embed = useEmbed(
    video,
    startAt !== undefined && Number.isFinite(startAt) ? Math.max(0, Math.floor(startAt)) : null,
  );
  const localSrc = useLocalVideoSrc(video.id, video.status);
  if (video.status !== "ready" && localSrc) {
    return <LocalPreview src={localSrc} status={video.status} title={title} />;
  }
  if (video.status === "ready" && video.bunny_video_id) {
    if (!embed) {
      return (
        <div className="flex aspect-video w-full items-center justify-center rounded-[var(--lare-r-4)] border border-[var(--border)] bg-black">
          <LoaderCircle
            className="size-5 animate-spin text-[var(--text-tertiary)]"
            aria-label="Loading player"
          />
        </div>
      );
    }
    const { start, url } = embed;
    const src = start === null ? url : `${url}${url.includes("?") ? "&" : "?"}t=${start}s`;
    return (
      <div className="overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-black">
        <iframe
          key={start === null ? "start" : `t-${start}`}
          title={title}
          src={src}
          loading="lazy"
          className="aspect-video w-full"
          // `allow` supersedes the legacy allowfullscreen attribute; setting both makes the
          // player log "Allow attribute will take precedence over 'allowfullscreen'".
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-[var(--lare-r-4)] border border-dashed border-[var(--border)] bg-[var(--surface-raised)] text-center">
      <VideoIcon className="size-6 text-[var(--text-tertiary)]" aria-hidden />
      <p className="text-sm text-zinc-400">{STATUS_TEXT[video.status] || "Video unavailable."}</p>
      {video.error ? <p className="max-w-sm text-xs text-rose-400">{video.error}</p> : null}
    </div>
  );
}
