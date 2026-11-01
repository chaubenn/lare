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

/**
 * Colour is never the only signal: each outcome also has its own shape, so the markers still read
 * for anyone who cannot tell the colours apart. Submissions use a square and a triangle; the AI's
 * moments use a circle (good), a triangle (issue) and a diamond (suggestion).
 */
type MarkerShape = "square" | "circle" | "triangle" | "diamond";

const SHAPE_CLASS: Record<MarkerShape, string> = {
  square: "rounded-[3px]",
  circle: "rounded-full",
  triangle: "[clip-path:polygon(50%_6%,100%_94%,0_94%)]",
  diamond: "rotate-45 scale-90 rounded-[2px]",
};

type Lane = "submission" | "moment";

function shapeFor(lane: Lane, tone: MarkerTone): MarkerShape {
  if (lane === "submission") return tone === "rose" ? "triangle" : "square";
  return tone === "rose" ? "triangle" : tone === "sky" ? "diamond" : "circle";
}

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
  lane,
  onSeek,
}: {
  markers: readonly TimelineMarker[];
  duration: number;
  lane: Lane;
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
            "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 transition-transform hover:scale-150 focus-visible:scale-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            SHAPE_CLASS[shapeFor(lane, m.tone)],
            TONE_BG[m.tone],
          )}
        />
      ))}
    </div>
  );
}

function LegendItem({ tone, lane, label }: { tone: MarkerTone; lane: Lane; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={cn("size-2.5", SHAPE_CLASS[shapeFor(lane, tone)], TONE_BG[tone])}
      />
      {label}
    </span>
  );
}

/**
 * Master timeline for the review page: a scrubber over the whole session plus marker lanes for
 * submissions and AI moments, each outcome with its own shape.
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
    <div className="rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
      <div className="flex items-center justify-between font-mono text-xs tabular-nums">
        <span className="text-emerald-400">{formatMediaTime(value)}</span>
        <span className="text-[var(--text-tertiary)]">{formatMediaTime(duration)}</span>
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
            <MarkerLane markers={submissions} duration={max} lane="submission" onSeek={onSeek} />
          ) : null}
          {moments.length > 0 ? (
            <MarkerLane markers={moments} duration={max} lane="moment" onSeek={onSeek} />
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-tertiary)]">
        {hasAccepted ? <LegendItem tone="emerald" lane="submission" label="Accepted" /> : null}
        {hasRejected ? <LegendItem tone="rose" lane="submission" label="Not accepted" /> : null}
        {momentTones.has("emerald") ? (
          <LegendItem tone="emerald" lane="moment" label="Good" />
        ) : null}
        {momentTones.has("rose") ? <LegendItem tone="rose" lane="moment" label="Issue" /> : null}
        {momentTones.has("sky") ? <LegendItem tone="sky" lane="moment" label="Suggestion" /> : null}
        {submissions.length === 0 && moments.length === 0 ? (
          <span>Drag to scrub the code and transcript; release to move the video.</span>
        ) : (
          <span className="ml-auto">Click a marker to jump there.</span>
        )}
      </div>
    </div>
  );
}
