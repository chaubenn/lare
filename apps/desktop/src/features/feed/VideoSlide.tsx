import { formatDurationHuman } from "@lare/shared";
import type { Video } from "@lare/supabase-types";
import { cn } from "@lare/ui";
import { CircleAlert, LoaderCircle, Play, Video as VideoIcon } from "lucide-react";
import { useState } from "react";
import { invokeFunction } from "@/lib/supabase";

const STATUS_LABEL: Record<Video["status"], string> = {
  created: "Uploading…",
  uploading: "Uploading…",
  uploaded: "Processing…",
  processing: "Processing…",
  ready: "Ready",
  failed: "This video failed to process.",
};

interface PlaybackToken {
  embedUrl: string;
  token: string;
  expires: number;
}

/**
 * Bunny Stream player slide, mirroring the web feed's video embed: a poster with a play
 * button that only mints the signed playback URL when the viewer actually asks to watch,
 * so a feed full of cards doesn't mint tokens nobody uses.
 */
export function VideoSlide({
  videoId,
  status,
  bunnyVideoId,
  posterUrl,
  durationMs,
  title = "Session recording",
  className,
}: {
  videoId: string;
  status: Video["status"];
  bunnyVideoId: string | null;
  posterUrl?: string | null;
  durationMs?: number | null;
  title?: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const body = await invokeFunction<PlaybackToken>("bunny-playback-token", {
        videoId,
      });
      if (!body.embedUrl) throw new Error("Couldn't load the player.");
      setSrc(body.embedUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the player.");
    } finally {
      setLoading(false);
    }
  }

  const ready = status === "ready" && Boolean(bunnyVideoId);

  if (!ready) {
    const failed = status === "failed";
    return (
      <div
        role="status"
        className={cn(
          "flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 text-sm text-zinc-400",
          className,
        )}
      >
        {failed ? (
          <CircleAlert className="size-6 text-rose-400" />
        ) : (
          <span className="relative inline-flex">
            <VideoIcon className="size-6 text-zinc-500" />
            <LoaderCircle className="absolute -right-2 -top-2 size-3.5 animate-spin text-amber-400" />
          </span>
        )}
        <span>{STATUS_LABEL[status]}</span>
        {!failed && <span className="text-xs text-zinc-600">Check back in a few minutes.</span>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative aspect-video overflow-hidden rounded-xl border border-zinc-800 bg-black",
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
            <span className="inline-flex size-14 items-center justify-center rounded-full bg-zinc-950/70 text-zinc-100 ring-1 ring-white/10 backdrop-blur transition-transform group-hover:scale-105">
              {loading ? (
                <LoaderCircle className="size-6 animate-spin" />
              ) : (
                <Play className="size-6 fill-current" />
              )}
            </span>
          </span>
          {durationMs ? (
            <span className="absolute bottom-2 right-2 rounded-md bg-zinc-950/70 px-1.5 py-0.5 text-[11px] font-medium text-zinc-200">
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
