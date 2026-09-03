import { BUNNY_EMBED_BASE } from "@lare/shared";
import type { Video } from "@lare/supabase-types";
import { CircleAlert, LoaderCircle, Video as VideoIcon } from "lucide-react";

export interface VideoEmbedProps {
  libraryId: number;
  bunnyVideoId: string | null;
  status: Video["status"];
  /** Optional Bunny token-authentication params (later phase). */
  token?: string | null;
  expires?: number | null;
  title?: string;
}

const STATUS_LABEL: Record<Video["status"], string> = {
  created: "Uploading…",
  uploading: "Uploading…",
  uploaded: "Processing…",
  processing: "Processing…",
  ready: "Ready",
  failed: "This video failed to process.",
};

export function VideoEmbed({
  libraryId,
  bunnyVideoId,
  status,
  token,
  expires,
  title = "Session recording",
}: VideoEmbedProps) {
  if (status === "ready" && bunnyVideoId) {
    const params = new URLSearchParams({ autoplay: "false", preload: "true" });
    if (token) params.set("token", token);
    if (expires) params.set("expires", String(expires));
    const src = `${BUNNY_EMBED_BASE}/${libraryId}/${bunnyVideoId}?${params.toString()}`;
    return (
      <div className="relative aspect-video overflow-hidden rounded-xl border border-zinc-800 bg-black">
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
        />
      </div>
    );
  }

  const failed = status === "failed";
  return (
    <div
      role="status"
      className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 text-sm text-zinc-400"
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
