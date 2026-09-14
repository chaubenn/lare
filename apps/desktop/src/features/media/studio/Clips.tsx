import { formatDuration } from "@lare/shared";
import { Trash2 } from "lucide-react";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Tooltip } from "@/components/ui/Tooltip";
import type { TimeRange } from "@/lib/recorder";

function stamp(seconds: number): string {
  return formatDuration(seconds * 1000);
}

export function StudioClips({
  segments,
  duration,
  outputDuration,
  isHighlights,
  onSeek,
  onRemove,
}: {
  segments: TimeRange[];
  duration: number;
  outputDuration: number;
  isHighlights: boolean;
  onSeek: (t: number) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Card>
      <SectionTitle>Kept ranges</SectionTitle>
      {segments.length === 0 ? (
        <p className="text-sm text-zinc-500">
          The whole recording ({stamp(duration)}) will be exported.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {segments.map((r, i) => (
            <li key={`${r.start}-${r.end}`} className="flex items-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => onSeek(r.start)}
                className="font-mono text-zinc-200 hover:text-emerald-300"
              >
                {stamp(r.start)} → {stamp(r.end)}
              </button>
              <span className="text-xs text-zinc-500">{stamp(r.end - r.start)}</span>
              <Tooltip label="Remove range" align="end" className="ml-auto">
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label="Remove range"
                  className="rounded p-1 text-zinc-500 hover:text-rose-300"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </Tooltip>
            </li>
          ))}
          <li className="pt-1 text-xs text-zinc-500">
            Output: {stamp(outputDuration)} {isHighlights ? "· published as highlights" : ""}
          </li>
        </ul>
      )}
    </Card>
  );
}
