"use client";

import { type Distribution, userBinIndex } from "@lare/shared";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "./cn";

export interface RuntimeChartProps {
  distribution: Distribution;
  /** The user's runtime (ms) or memory (MB) to highlight. */
  userValue: number | null | undefined;
  unit: "ms" | "MB";
  height?: number;
  className?: string;
}

const PAD = { top: 8, right: 8, bottom: 22, left: 40 };
const GAP = 1;
/** Widest tick label we allow, so labels thin out instead of colliding. */
const TICK_LABEL_W = 44;

/**
 * LeetCode-style runtime/memory distribution histogram: percentage of accepted
 * submissions per bin, with the user's bin highlighted.
 *
 * Drawn in pixel space off a measured width (like ActivityChart) rather than a
 * stretched viewBox — a non-uniform scale would smear the axis labels.
 */
export function RuntimeChart({
  distribution,
  userValue,
  unit,
  height = 160,
  className,
}: RuntimeChartProps) {
  const highlight =
    userValue === null || userValue === undefined ? -1 : userBinIndex(distribution, userValue);
  const data = distribution.bins;
  const maxPct = Math.max(1, ...data.map((b) => b.pct));
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const gid = useId();

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = Math.max(0, height - PAD.top - PAD.bottom);
  const step = data.length > 0 ? innerW / data.length : 0;
  const barW = Math.max(1, step - GAP);

  // Label every nth bin, where n keeps neighbouring labels from overlapping.
  const ticks = useMemo(() => {
    if (data.length === 0 || step <= 0) return [];
    const every = Math.max(1, Math.ceil(TICK_LABEL_W / step));
    return data.flatMap((b, i) => (i % every === 0 ? [{ i, value: b.value }] : []));
  }, [data, step]);

  const active = hover ?? (highlight >= 0 ? highlight : null);
  const tip = active !== null ? data[active] : null;

  return (
    <div ref={frameRef} className={cn("relative w-full", className)} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block"
          role="img"
          aria-label={`${unit} distribution`}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const i = Math.floor((event.clientX - rect.left - PAD.left) / (step || 1));
            setHover(i >= 0 && i < data.length ? i : null);
          }}
          onMouseLeave={() => setHover(null)}
        >
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {[0, 0.5, 1].map((t) => {
              const y = innerH - t * innerH;
              return (
                <g key={t}>
                  <line
                    x1={0}
                    x2={innerW}
                    y1={y}
                    y2={y}
                    stroke="var(--border)"
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={-8}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill="var(--text-tertiary)"
                    fontSize={11}
                  >
                    {`${Math.round(maxPct * t)}%`}
                  </text>
                </g>
              );
            })}
            {data.map((b, i) => {
              const h = (b.pct / maxPct) * innerH;
              const on = i === highlight || i === hover;
              return (
                <rect
                  key={`${b.value}-${b.pct}`}
                  x={i * step}
                  y={innerH - h}
                  width={barW}
                  height={Math.max(h, 1)}
                  rx={1}
                  fill={on ? "var(--accent)" : "var(--border-strong)"}
                />
              );
            })}
            {ticks.map((t) => (
              <text
                key={t.i}
                x={t.i * step + barW / 2}
                y={innerH + 14}
                textAnchor="middle"
                fill="var(--text-tertiary)"
                fontSize={11}
              >
                {`${t.value}${unit}`}
              </text>
            ))}
          </g>
        </svg>
      )}
      {tip ? (
        <div
          id={gid}
          className="pointer-events-none absolute top-2 right-2 rounded-[var(--lare-r-2)] border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 text-[11px] text-[var(--text)] shadow-[var(--lare-shadow-1)]"
        >
          {tip.value}
          {unit} · {tip.pct.toFixed(2)}% submissions
        </div>
      ) : null}
    </div>
  );
}
