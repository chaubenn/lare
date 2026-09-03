import { formatDuration, type TranscriptSegment } from "@lare/shared";
import { cn } from "@lare/ui";
import { Copy, MicOff } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { ErrorState, Spinner } from "@/components/ui/States";
import { copyText } from "@/lib/clipboard";
import { plural } from "@/lib/format";
import { activeSegmentIndex, transcriptToText, withKeys } from "./media";

const EMPTY: readonly TranscriptSegment[] = [];

/**
 * Clickable transcript. The segment at `currentTime` is highlighted and kept in view; clicking a
 * segment seeks the page (and the video) to its start.
 */
export function TranscriptList({
  segments,
  model,
  isPending,
  error,
  onRetry,
  currentTime,
  onSeek,
}: {
  /** `null` when the session has no transcript row. */
  segments: readonly TranscriptSegment[] | null;
  model?: string | null;
  isPending: boolean;
  error?: unknown;
  onRetry?: () => void;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  const { toast } = useToast();
  const listRef = useRef<HTMLOListElement>(null);
  const list = segments ?? EMPTY;
  const keyed = useMemo(() => withKeys(list, (s) => `${s.s}-${s.e}`), [list]);
  const activeIndex = useMemo(() => activeSegmentIndex(list, currentTime), [list, currentTime]);

  // Keep the highlighted segment visible without hijacking the scroll when it already is.
  useEffect(() => {
    const ol = listRef.current;
    if (!ol || activeIndex < 0) return;
    const el = ol.children.item(activeIndex);
    if (!(el instanceof HTMLElement)) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    const viewTop = ol.scrollTop;
    const viewBottom = viewTop + ol.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) return;
    ol.scrollTo({
      top: Math.max(0, top - ol.clientHeight / 2 + el.offsetHeight / 2),
      behavior: "smooth",
    });
  }, [activeIndex]);

  const copy = async () => {
    const ok = await copyText(transcriptToText(list));
    toast(
      ok
        ? { title: "Transcript copied", variant: "success" }
        : { title: "Couldn't copy the transcript", variant: "error" },
    );
  };

  return (
    <Card>
      <SectionTitle
        action={
          list.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy className="size-3.5" aria-hidden />}
              onClick={() => void copy()}
            >
              Copy
            </Button>
          ) : undefined
        }
      >
        Transcript
      </SectionTitle>

      {isPending ? (
        <Spinner className="py-8" label="Loading transcript…" />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} title="Couldn't load the transcript" />
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center">
          <MicOff className="size-5 text-zinc-600" aria-hidden />
          <p className="text-sm text-zinc-400">
            No transcript — the microphone was off or transcription has not run yet.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500">
            {plural(list.length, "segment")}
            {model ? ` · ${model}` : ""}
          </p>
          <ol
            ref={listRef}
            className="relative max-h-[28rem] space-y-0.5 overflow-y-auto pr-1"
            aria-label="Transcript segments"
          >
            {keyed.map(({ key, item: seg }, i) => {
              const active = i === activeIndex;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onSeek(seg.s / 1000)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
                      active
                        ? "bg-emerald-500/10 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200",
                    )}
                  >
                    <span
                      className={cn(
                        "w-12 shrink-0 pt-px font-mono text-xs tabular-nums",
                        active ? "text-emerald-400" : "text-zinc-500",
                      )}
                    >
                      {formatDuration(seg.s)}
                    </span>
                    <span className="leading-relaxed">{seg.text.trim()}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Card>
  );
}
