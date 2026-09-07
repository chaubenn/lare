"use client";

import {
  type ActivityDay,
  type ActivityWeek,
  buildActivityDays,
  buildActivityWeekBars,
  describeActivityCell,
  describeActivityWeek,
  formatWeekRange,
  maxPage,
  pageWindow,
  type SolvedActivity,
} from "@lare/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { useDragToPage } from "./gesture";
import { Button } from "./primitives/Button";

type Mode = "day" | "week";

function describeDayPage(bars: ActivityDay[]): string {
  const total = bars.reduce((n, d) => n + d.count, 0);
  const activeDays = bars.filter((d) => d.count > 0).length;
  if (total === 0) return "No problems this week";
  return `${total} problem${total === 1 ? "" : "s"} · ${activeDays} day${activeDays === 1 ? "" : "s"} active`;
}

function describeWeekPage(bars: ActivityWeek[]): string {
  const total = bars.reduce((n, w) => n + w.count, 0);
  if (total === 0) return "No problems these 7 weeks";
  return `${total} problem${total === 1 ? "" : "s"} over the last ${bars.length} weeks`;
}

function NavButton({
  side,
  disabled,
  onClick,
  label,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "absolute top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-[color-mix(in_oklab,var(--surface)_60%,transparent)] text-[var(--text)] ring-1 ring-white/10 backdrop-blur hover:bg-[color-mix(in_oklab,var(--surface)_80%,transparent)] disabled:pointer-events-none disabled:opacity-0 sm:inline-flex",
        side === "left" ? "-left-3 sm:-left-4" : "-right-3 sm:-right-4",
      )}
    >
      {side === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </Button>
  );
}

/**
 * Hevy-style solve chart. Toggle between a 7-day and a 7-week window; swipe
 * (drag, arrows, or keyboard) to page back through history.
 */
export function ActivityChart({
  activity,
  className,
}: {
  activity: SolvedActivity;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>("week");
  const [page, setPage] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => buildActivityDays(activity), [activity]);
  const weeks = useMemo(() => buildActivityWeekBars(activity), [activity]);

  const dayBars = useMemo(() => pageWindow(days, 7, page), [days, page]);
  const weekBars = useMemo(() => pageWindow(weeks, 7, page), [weeks, page]);
  const lastPage = maxPage(mode === "day" ? days.length : weeks.length, 7);
  const clampedPage = Math.min(page, lastPage);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth(next);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useDragToPage(dragRef, {
    page: clampedPage,
    pageCount: lastPage + 1,
    onPageChange: (next) => {
      setPage(next);
      setHover(null);
    },
  });

  function setModeAndReset(next: Mode) {
    setMode(next);
    setPage(0);
    setHover(null);
  }

  function goToPage(next: number) {
    setPage(Math.max(0, Math.min(lastPage, next)));
    setHover(null);
  }

  const bars = mode === "day" ? dayBars : weekBars;
  const max = Math.max(1, ...bars.map((b) => b.count));
  const activeDay = mode === "day" && hover !== null ? dayBars[hover] : null;
  const activeWeek = mode === "week" && hover !== null ? weekBars[hover] : null;

  const height = 144;
  const pad = { top: 8, right: 0, bottom: 22, left: 0 };
  const innerH = height - pad.top - pad.bottom;
  const gap = 10;
  const count = Math.max(bars.length, 1);
  const barW = width > 0 ? Math.max(8, (width - gap * (count - 1)) / count) : 24;

  return (
    <section
      aria-labelledby="activity-heading"
      className={cn(
        "relative rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)] p-4",
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") goToPage(clampedPage + 1);
        if (e.key === "ArrowRight") goToPage(clampedPage - 1);
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id="activity-heading" className="text-sm font-semibold text-[var(--text)]">
            Problems solved
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]" aria-live="polite">
            {activeDay ? (
              <span className="text-[var(--text-secondary)]">
                {describeActivityCell({ ...activeDay, outside: false })}
              </span>
            ) : activeWeek ? (
              <span className="text-[var(--text-secondary)]">
                {describeActivityWeek(activeWeek)}
              </span>
            ) : (
              <span className="text-[var(--text-secondary)]">
                {mode === "day" ? describeDayPage(dayBars) : describeWeekPage(weekBars)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="lare-micro tabular-nums text-[var(--text-tertiary)]">Peak {max}</p>
          <div className="flex rounded-[var(--lare-r-2)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_60%,transparent)] p-0.5 text-[11px]">
            {(["day", "week"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModeAndReset(m)}
                aria-pressed={mode === m}
                className={cn(
                  "lare-press rounded-md px-2 py-1 capitalize transition-colors",
                  mode === m
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text)]",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={frameRef} className="relative mt-3 min-w-0">
        <div ref={dragRef} className="touch-pan-y">
          <svg
            width="100%"
            height={height}
            role="img"
            aria-label="Problems solved"
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - rect.left;
              const i = Math.floor(x / (barW + gap));
              setHover(i >= 0 && i < bars.length ? i : null);
            }}
            onMouseLeave={() => setHover(null)}
          >
            {bars.map((bar, i) => {
              const countVal = bar.count;
              const empty = countVal === 0;
              const h = empty ? 3 : Math.max(3, (countVal / max) * innerH);
              const x = i * (barW + gap);
              const y = pad.top + innerH - h;
              const current =
                mode === "week"
                  ? "current" in bar && bar.current
                  : i === bars.length - 1 && clampedPage === 0;
              const fill =
                hover === i || (hover === null && current)
                  ? "var(--accent)"
                  : empty
                    ? "var(--border)"
                    : "var(--border-strong)";
              const label =
                mode === "day"
                  ? new Date((bar as ActivityDay).iso).toLocaleDateString("en-US", {
                      timeZone: "UTC",
                      weekday: "short",
                    })
                  : ((bar as ActivityWeek).monthLabel ?? "");
              return (
                <g key={mode === "day" ? (bar as ActivityDay).iso : (bar as ActivityWeek).start}>
                  <rect x={x} y={y} width={barW} height={h} rx={2} fill={fill} />
                  <text
                    x={x + barW / 2}
                    y={height - 6}
                    textAnchor="middle"
                    fill="var(--text-tertiary)"
                    fontSize={10}
                  >
                    {label}
                  </text>
                  <title>
                    {mode === "day"
                      ? describeActivityCell({ ...(bar as ActivityDay), outside: false })
                      : formatWeekRange(
                          (bar as ActivityWeek).firstDay,
                          (bar as ActivityWeek).lastDay,
                        )}
                  </title>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <NavButton
        side="left"
        disabled={clampedPage >= lastPage}
        onClick={() => goToPage(clampedPage + 1)}
        label="Previous period"
      />
      <NavButton
        side="right"
        disabled={clampedPage <= 0}
        onClick={() => goToPage(clampedPage - 1)}
        label="Next period"
      />
    </section>
  );
}
