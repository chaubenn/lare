import { cn } from "@lare/ui";
import type { CSSProperties } from "react";
import { formatMediaTime } from "./media";

export type MarkerTone = "emerald" | "rose" | "sky";

export interface TimelineMarker {
  key: string;
  /** Media seconds. */
  t: number;
  tone: MarkerTone;
  /** Tooltip / accessible name. */
  label: string;
}

const TONE_BG: Record<MarkerTone, string> = {
  emerald: "bg-emerald-400",
  rose: "bg-rose-400",
  sky: "bg-sky-400",
};

/** The thumb is 14px wide, so its centre travels from 7px to (width - 7px). */
const THUMB = 14;
const HALF = THUMB / 2;

const RANGE_CLASS = cn(
  "absolute inset-0 m-0 h-3.5 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none",
  "[&::-webkit-slider-runnable-track]:h-3.5 [&::-webkit-slider-runnable-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-zinc-950 [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:shadow-md",
  "[&::-moz-range-track]:h-3.5 [&::-moz-range-track]:bg-transparent",
  "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-zinc-950 [&::-moz-range-thumb]:bg-emerald-400",
  "[&:focus-visible::-webkit-slider-thumb]:ring-2 [&:focus-visible::-webkit-slider-thumb]:ring-emerald-500/60",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

function positionStyle(t: number, duration: number): CSSProperties {
  const frac = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
  return { left: `calc(${HALF}px + (100% - ${THUMB}px) * ${frac})` };
}

function MarkerLane({
  markers,
  duration,
  shape,
  onSeek,
}: {
  markers: readonly TimelineMarker[];
  duration: number;
  shape: "square" | "dot";
  onSeek: (t: number) => void;
}) {
  return (
    <div className="relative h-4">
      {markers.map((m) => (
        <button
          key={m.key}
          type="button"
          title={`${formatMediaTime(m.t)} · ${m.label}`}
          aria-label={`${m.label} at ${formatMediaTime(m.t)}`}
          onClick={() => onSeek(m.t)}
          style={positionStyle(m.t, duration)}
          className={cn(
            "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-150 focus-visible:scale-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            shape === "dot" ? "rounded-full" : "rounded-[3px]",
            TONE_BG[m.tone],
          )}
        />
      ))}
    </div>
  );
}

function LegendItem({
  tone,
  shape,
  label,
}: {
  tone: MarkerTone;
  shape: "square" | "dot";
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={cn("size-2", shape === "dot" ? "rounded-full" : "rounded-[2px]", TONE_BG[tone])}
      />
      {label}
    </span>
  );
}

/**
 * Master timeline for the review page: a scrubber over the whole session plus marker lanes for
 * submissions (squares) and AI moments (dots).
 *
 *  - Dragging the scrubber calls `onScrub` continuously (code + transcript follow live).
 *  - Releasing it, or clicking a marker, calls `onSeek` (which also re-positions the video).
 */
export function Timeline({
  duration,
  currentTime,
  submissions,
  moments,
  onScrub,
  onSeek,
}: {
  duration: number;
  currentTime: number;
  submissions: readonly TimelineMarker[];
  moments: readonly TimelineMarker[];
  onScrub: (t: number) => void;
  onSeek: (t: number) => void;
}) {
  const max = duration > 0 ? duration : 1;
  const value = Math.min(max, Math.max(0, currentTime));
  const frac = value / max;
  const hasAccepted = submissions.some((m) => m.tone === "emerald");
  const hasRejected = submissions.some((m) => m.tone === "rose");
  const momentTones = new Set(moments.map((m) => m.tone));

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="flex items-center justify-between font-mono text-xs tabular-nums">
        <span className="text-emerald-400">{formatMediaTime(value)}</span>
        <span className="text-zinc-500">{formatMediaTime(duration)}</span>
      </div>

      <div className="relative mt-2 h-3.5">
        <div
          aria-hidden
          className="absolute top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-zinc-800"
          style={{ left: HALF, right: HALF }}
        >
          <div
            className="h-full rounded-full bg-emerald-500/60"
            style={{ width: `${frac * 100}%` }}
          />
        </div>
        <input
          type="range"
          aria-label="Session time"
          aria-valuetext={formatMediaTime(value)}
          min={0}
          max={max}
          step={0.5}
          value={value}
          disabled={duration <= 0}
          onChange={(e) => onScrub(e.currentTarget.valueAsNumber)}
          onPointerUp={(e) => onSeek(e.currentTarget.valueAsNumber)}
          className={RANGE_CLASS}
        />
      </div>

      {submissions.length > 0 || moments.length > 0 ? (
        <div className="relative mt-1.5 space-y-0.5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-zinc-600"
            style={positionStyle(value, max)}
          />
          {submissions.length > 0 ? (
            <MarkerLane markers={submissions} duration={max} shape="square" onSeek={onSeek} />
          ) : null}
          {moments.length > 0 ? (
            <MarkerLane markers={moments} duration={max} shape="dot" onSeek={onSeek} />
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {hasAccepted ? <LegendItem tone="emerald" shape="square" label="Accepted" /> : null}
        {hasRejected ? <LegendItem tone="rose" shape="square" label="Not accepted" /> : null}
        {momentTones.has("emerald") ? <LegendItem tone="emerald" shape="dot" label="Good" /> : null}
        {momentTones.has("rose") ? <LegendItem tone="rose" shape="dot" label="Issue" /> : null}
        {momentTones.has("sky") ? <LegendItem tone="sky" shape="dot" label="Suggestion" /> : null}
        {submissions.length === 0 && moments.length === 0 ? (
          <span>Drag to scrub the code and transcript; release to move the video.</span>
        ) : (
          <span className="ml-auto">Click a marker to jump there.</span>
        )}
      </div>
    </div>
  );
}
