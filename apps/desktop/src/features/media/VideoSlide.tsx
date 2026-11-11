import { formatDurationHuman } from "@lare/shared";
import type { Video } from "@lare/supabase-types";
import { cn } from "@lare/ui";
import { CircleAlert, LoaderCircle, Play, Video as VideoIcon } from "@lare/ui/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LocalPreview } from "./LocalPreview";
import { useLocalVideoSrc } from "./localCopies";
import { fetchPlaybackUrl } from "./playback";

const STATUS_LABEL: Record<Video["status"], string> = {
  created: "Uploading…",
  uploading: "Uploading…",
  uploaded: "Processing…",
  processing: "Processing…",
  ready: "Ready",
  failed: "This video failed to process.",
};

/**
 * Bunny Stream player for a slide of a post's deck: a poster with a play button that only mints
 * the signed playback URL when the viewer actually asks to watch, so a feed full of cards doesn't
 * mint tokens nobody uses. It fills the slide it is given and letterboxes inside the player.
 */
export function VideoSlide({
  videoId,
  status,
  bunnyVideoId,
  posterUrl,
  durationMs,
  title,
  className,
}: {
  videoId: string;
  status: Video["status"];
  bunnyVideoId: string | null;
  posterUrl?: string | null;
  durationMs?: number | null;
  title: string;
  className: string;
}) {
  const queryClient = useQueryClient();
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSrc(await fetchPlaybackUrl(queryClient, videoId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the player.");
    } finally {
      setLoading(false);
    }
  }

  const ready = status === "ready" && Boolean(bunnyVideoId);
  const localSrc = useLocalVideoSrc(videoId, status);

  if (!ready && localSrc) {
    return <LocalPreview src={localSrc} status={status} title={title} className={className} />;
  }

  if (!ready) {
    const failed = status === "failed";
    return (
      <div
        role="status"
        className={cn(
          "flex aspect-video flex-col items-center justify-center gap-2 rounded-[var(--lare-r-4)] border border-dashed border-[var(--border)] bg-[var(--surface-raised)] text-sm text-zinc-400",
          className,
        )}
      >
        {failed ? (
          <CircleAlert className="size-6 text-rose-400" />
        ) : (
          <span className="relative inline-flex">
            <VideoIcon className="size-6 text-[var(--text-tertiary)]" />
            <LoaderCircle className="absolute -right-2 -top-2 size-3.5 animate-spin text-amber-400" />
          </span>
        )}
        <span>{STATUS_LABEL[status]}</span>
        {!failed && (
          <span className="text-xs text-[var(--text-tertiary)]">Check back in a few minutes.</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-black",
        className,
      )}
    >
      {src ? (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          // `allow` supersedes the legacy allowfullscreen attribute; setting both makes the
          // player log "Allow attribute will take precedence over 'allowfullscreen'".
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (!src && !loading) void load();
          }}
          className="group absolute inset-0 size-full"
          aria-label={`Play ${title}`}
        >
          {posterUrl ? (
            <img
              src={posterUrl}
              alt=""
              className="absolute inset-0 size-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
            />
          ) : (
            <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(240,236,228,0.10),_transparent_65%)]" />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex size-14 items-center justify-center rounded-full bg-zinc-950/70 text-[var(--text)] ring-1 ring-white/10 backdrop-blur transition-transform group-hover:scale-105">
              {loading ? (
                <LoaderCircle className="size-6 animate-spin" />
              ) : (
                <Play className="size-6 fill-current" />
              )}
            </span>
          </span>
          {durationMs ? (
            <span className="absolute bottom-2 right-2 rounded-md bg-zinc-950/70 px-1.5 py-0.5 text-xs font-medium text-zinc-200">
              {formatDurationHuman(durationMs)}
            </span>
          ) : null}
        </button>
      )}
      {error && (
        <p
          role="alert"
          className="absolute inset-x-0 bottom-0 bg-rose-950/80 px-3 py-2 text-center text-xs text-rose-200"
        >
          {error}
        </p>
      )}
    </div>
  );
}
