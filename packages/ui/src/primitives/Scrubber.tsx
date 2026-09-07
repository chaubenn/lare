"use client";

import { type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";
import { cn } from "../cn";

export interface ScrubberMark {
  at: number;
  kind?: "square" | "dot";
  label?: string;
}

/**
 * 1:1 pointer-capture scrubber. Tracking survives leaving the element; the playhead
 * respects the grab offset rather than jumping to the pointer.
 */
export function Scrubber({
  value,
  max,
  onScrub,
  onSeek,
  marks,
  ranges,
  className,
}: {
  value: number;
  max: number;
  onScrub?: (next: number) => void;
  onSeek?: (next: number) => void;
  marks?: ScrubberMark[];
  ranges?: Array<{ start: number; end: number }>;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ startX: number; startValue: number; width: number } | null>(null);

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const g = grab.current;
      const track = trackRef.current;
      if (!track || max <= 0) return 0;
      const width = g?.width ?? track.getBoundingClientRect().width;
      if (g) {
        const delta = (clientX - g.startX) / width;
        return Math.min(max, Math.max(0, g.startValue + delta * max));
      }
      const rect = track.getBoundingClientRect();
      return Math.min(max, Math.max(0, ((clientX - rect.left) / rect.width) * max));
    },
    [max],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    grab.current = { startX: event.clientX, startValue: value, width: rect.width };
    track.setPointerCapture(event.pointerId);
    onScrub?.(valueFromClientX(event.clientX));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!grab.current) return;
    onScrub?.(valueFromClientX(event.clientX));
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!grab.current) return;
    const next = valueFromClientX(event.clientX);
    grab.current = null;
    try {
      trackRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
    onSeek?.(next);
  };

  const pct = max > 0 ? (value / max) * 100 : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        const step = max / 50;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onSeek?.(Math.min(max, value + step));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onSeek?.(Math.max(0, value - step));
        }
      }}
      className={cn(
        "relative h-8 cursor-ew-resize touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        className,
      )}
    >
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
        {ranges?.map((r) => (
          <div
            key={`${r.start}-${r.end}`}
            className="absolute inset-y-0 bg-[color-mix(in_oklab,var(--lare-status-run)_40%,transparent)]"
            style={{
              left: `${max > 0 ? (r.start / max) * 100 : 0}%`,
              width: `${max > 0 ? ((r.end - r.start) / max) * 100 : 0}%`,
            }}
          />
        ))}
        <div
          className="absolute inset-y-0 left-0 bg-[color-mix(in_oklab,var(--lare-status-run)_70%,transparent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {marks?.map((m) => (
        <span
          key={`${m.kind}-${m.at}`}
          title={m.label}
          className={cn(
            "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--text)]",
            m.kind === "square" ? "size-1.5 rounded-[1px]" : "size-1.5 rounded-full",
          )}
          style={{ left: `${max > 0 ? (m.at / max) * 100 : 0}%` }}
        />
      ))}
      <span
        aria-hidden
        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text)] shadow-[var(--lare-shadow-1)]"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
