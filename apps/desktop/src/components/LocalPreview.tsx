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
 * So both halves are watched: `error` for a pipeline that gave up, and the element's own progress
 * for one that stopped without admitting it — the clock when it has something to play, what it
 * has buffered when it does not. See `features/media/previewStallRules.ts`.
 */
export function LocalPreview({
  src,
  status,
  title,
  className,
  onReload,
}: {
  src: string;
  status: Video["status"];
  title: string;
  className?: string;
  /** Re-check the local copy, so Reload can drop a preview whose file is no longer there. */
  onReload?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Bumped to remount the element: a pipeline that has stalled does not come back from `load()`.
  const [attempt, setAttempt] = useState(0);
  // A retry has to be a different URL, not just a different element. WebKit keys the media
  // resource it builds on the URL, and handing back the same one is how a Reload can come back
  // exactly as dead as it went in. The server routes on the path, so the query is ignored.
  const url = attempt === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;

  const reload = useCallback(() => {
    setProblem(null);
    setAttempt((n) => n + 1);
    onReload?.();
  }, [onReload]);

  // `attempt` is not read in the body, but Reload changes the element's `key`, so without it the
  // listeners and the interval would go on watching the element React has already thrown away.
  // `src` is not read either: re-running on a new source is what clears the last one's failure
  // and starts the watch again, which otherwise trips on a clock that is back at zero.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach to the remounted element.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    setProblem(null);

    const onError = () => setProblem(mediaErrorText(element.error?.code));
    let watch: StallWatch | null = null;
    const tick = () => {
      const { buffered } = element;
      const verdict = watchPlayback(
        // Read field by field: these are prototype accessors, so spreading the element copies
        // none of them.
        {
          paused: element.paused,
          ended: element.ended,
          readyState: element.readyState,
          currentTime: element.currentTime,
          buffered: buffered.length ? buffered.end(buffered.length - 1) : 0,
        },
        watch,
        Date.now(),
      );
      watch = verdict.watch;
      if (verdict.problem) setProblem(verdict.problem);
    };

    element.addEventListener("error", onError);
    const timer = window.setInterval(tick, 1000);
    return () => {
      element.removeEventListener("error", onError);
      window.clearInterval(timer);
    };
  }, [attempt, src]);

  return (
    <div className={cn("space-y-1.5", className)}>
      <video
        key={attempt}
        ref={video}
        src={url}
        controls
        // The file is on this device, behind loopback: there is no bandwidth to save by holding
        // back, and `metadata` buys a suspend/resume of the load at the moment play is pressed —
        // the one step in the chain where a preview can end up sitting there never being fed.
        preload="auto"
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
