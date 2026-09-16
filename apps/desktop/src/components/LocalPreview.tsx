import type { Video } from "@lare/supabase-types";
import { cn } from "@lare/ui";
import { AlertTriangle, HardDrive, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { mediaErrorText, type StallWatch, watchPlayback } from "@/features/media/previewStallRules";

/**
 * This device's own copy of a video, played while the cloud copy is still processing (or failed).
 * Only the author ever has one, so viewers never see this.
 *
 * A media element that dies does it quietly: the frame stays up, the clock stays at 0:00, and
 * `controls` goes on showing a pause button, because as far as the element is concerned playback
 * was never stopped — it is just never fed. Left alone the caption underneath keeps promising the
 * cloud copy is on its way, which is the one thing that makes this failure impossible to report.
 * So both halves are watched: `error` for a pipeline that gave up, and the clock itself for one
 * that stalled without admitting it.
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
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Bumped to remount the element: a pipeline that has stalled does not come back from `load()`.
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setProblem(null);
    setAttempt((n) => n + 1);
  }, []);

  // A new source is a new chance; never carry the last one's failure over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clearing on a new src is the point.
  useEffect(() => setProblem(null), [src]);

  // `attempt` is not read in the body, but Reload changes the element's `key`, so without it the
  // listeners and the interval would go on watching the element React has already thrown away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach to the remounted element.
  useEffect(() => {
    const element = video.current;
    if (!element) return;

    const onError = () => setProblem(mediaErrorText(element.error?.code));
    let watch: StallWatch | null = null;
    const tick = () => {
      const verdict = watchPlayback(element, watch, Date.now());
      watch = verdict.watch;
      if (verdict.problem) setProblem(verdict.problem);
    };

    element.addEventListener("error", onError);
    const timer = window.setInterval(tick, 1000);
    return () => {
      element.removeEventListener("error", onError);
      window.clearInterval(timer);
    };
  }, [attempt]);

  return (
    <div className={cn("space-y-1.5", className)}>
      <video
        key={attempt}
        ref={video}
        src={src}
        controls
        preload="metadata"
        title={title}
        onPlaying={() => setProblem(null)}
        className="aspect-video w-full rounded-xl border border-zinc-800 bg-black"
      >
        <track kind="captions" />
      </video>
      {problem ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-400">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" aria-hidden />
            {problem}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCw className="size-3" aria-hidden />}
            onClick={reload}
          >
            Reload
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-zinc-500">
          <HardDrive className="size-3.5" aria-hidden />
          {status === "failed"
            ? "Local preview. The cloud copy failed to process."
            : "Local preview. Others can watch once the cloud copy finishes processing."}
        </p>
      )}
    </div>
  );
}
