"use client";

import { type Distribution, userBinIndex } from "@lare/shared";
import { useId, useMemo, useState } from "react";
import { cn } from "./cn";

export interface RuntimeChartProps {
  distribution: Distribution;
  /** The user's runtime (ms) or memory (MB) to highlight. */
  userValue: number | null | undefined;
  unit: "ms" | "MB";
  height?: number;
  className?: string;
}

/**
 * LeetCode-style runtime/memory distribution histogram: percentage of accepted
 * submissions per bin, with the user's bin highlighted.
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
  const gid = useId();

  const ticks = useMemo(() => {
    const every = Math.max(1, Math.floor(data.length / 8));
    return data.flatMap((b, i) => (i % every === 0 ? [{ i, value: b.value }] : []));
  }, [data]);

  const pad = { top: 8, right: 8, bottom: 22, left: 36 };
  const innerW = 100;
  const innerH = 100;
  const gap = 0.6;
  const barW = data.length > 0 ? (innerW - gap * (data.length - 1)) / data.length : innerW;
  const active = hover ?? (highlight >= 0 ? highlight : null);
  const tip = active !== null ? data[active] : null;

  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <svg
        viewBox={`0 0 ${innerW + pad.left + pad.right} ${innerH + pad.top + pad.bottom}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label={`${unit} distribution`}
        onMouseMove={(event) => {
          const svg = event.currentTarget;
          const rect = svg.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * (innerW + pad.left + pad.right);
          const i = Math.floor((x - pad.left) / (barW + gap));
          setHover(i >= 0 && i < data.length ? i : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <g transform={`translate(${pad.left},${pad.top})`}>
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
                  strokeWidth={0.2}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={-2}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="var(--text-tertiary)"
                  fontSize={3.2}
                >
                  {`${Math.round(maxPct * t)}%`}
                </text>
              </g>
            );
          })}
          {data.map((b, i) => {
            const h = (b.pct / maxPct) * innerH;
            const x = i * (barW + gap);
            const y = innerH - h;
            const on = i === highlight || i === hover;
            return (
              <rect
                key={`${b.value}-${b.pct}`}
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 0.6)}
                rx={0.4}
                fill={on ? "var(--accent)" : "var(--border-strong)"}
              />
            );
          })}
          {ticks.map((t) => (
            <text
              key={t.i}
              x={t.i * (barW + gap) + barW / 2}
              y={innerH + 6}
              textAnchor="middle"
              fill="var(--text-tertiary)"
              fontSize={3}
            >
              {`${t.value}${unit}`}
            </text>
          ))}
        </g>
      </svg>
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
