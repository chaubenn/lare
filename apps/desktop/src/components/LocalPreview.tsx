import type { Video } from "@lare/supabase-types";
import { cn } from "@lare/ui";
import { HardDrive } from "lucide-react";

/**
 * This device's own copy of a video, played while the cloud copy is still processing (or failed).
 * Only the author ever has one, so viewers never see this.
 */
export function LocalPreview({
  src,
  status,
  title,
  className,
}: {
  src: string;
  status: Video["status"];
  title: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <video
        src={src}
        controls
        preload="metadata"
        title={title}
        className="aspect-video w-full rounded-xl border border-zinc-800 bg-black"
      >
        <track kind="captions" />
      </video>
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <HardDrive className="size-3.5" aria-hidden />
        {status === "failed"
          ? "Local preview. The cloud copy failed to process."
          : "Local preview. Others can watch once the cloud copy finishes processing."}
      </p>
    </div>
  );
}
