import { Scrubber } from "@lare/ui/primitives";
import type { TimeRange } from "@/lib/recorder";

/** Scrubber with kept ranges highlighted. */
export function StudioTimeline({
  duration,
  current,
  segments,
  markIn,
  onSeek,
}: {
  duration: number;
  current: number;
  segments: TimeRange[];
  markIn: number | null;
  onSeek: (t: number) => void;
}) {
  return (
    <Scrubber
      value={current}
      max={Math.max(0.1, duration)}
      onScrub={onSeek}
      onSeek={onSeek}
      ranges={segments.length > 0 ? segments : [{ start: 0, end: duration }]}
      marks={markIn !== null ? [{ at: markIn, kind: "square", label: "In" }] : undefined}
    />
  );
}
