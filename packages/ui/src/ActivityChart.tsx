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
  summarizeActivity,
} from "@lare/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { useDragToPage } from "./gesture";
import { Button } from "./primitives/Button";

type Mode = "day" | "week";

const DAY_WINDOW = 7;
/** Weeks per page: about a month. Seven weeks back read as an arbitrary span. */
const WEEK_WINDOW = 4;

function describeDayPage(bars: ActivityDay[]): string {
  const total = bars.reduce((n, d) => n + d.count, 0);
  const activeDays = bars.filter((d) => d.count > 0).length;
  if (total === 0) return "No problems this week";
  return `${total} problem${total === 1 ? "" : "s"} · ${activeDays} day${activeDays === 1 ? "" : "s"} active`;
}

function describeWeekPage(bars: ActivityWeek[]): string {
  const total = bars.reduce((n, w) => n + w.count, 0);
  if (total === 0) return `No problems these ${bars.length} weeks`;
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
 * Solve chart. Toggle between the last 7 days and the last 4 weeks (about a month); swipe
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

  const dayBars = useMemo(() => pageWindow(days, DAY_WINDOW, page), [days, page]);
  const weekBars = useMemo(() => pageWindow(weeks, WEEK_WINDOW, page), [weeks, page]);
  const lastPage =
    mode === "day" ? maxPage(days.length, DAY_WINDOW) : maxPage(weeks.length, WEEK_WINDOW);
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

  const summary = useMemo(() => summarizeActivity(days), [days]);
  const height = 160;
  const pad = { top: 18, right: 0, bottom: 22, left: 0 };
  const innerH = height - pad.top - pad.bottom;
  const gap = 10;
  const count = Math.max(bars.length, 1);
  const barW = width > 0 ? Math.max(8, (width - gap * (count - 1)) / count) : 24;

  return (
    <section
      aria-labelledby="activity-heading"
      className={cn(
        "@container relative rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] p-5",
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") goToPage(clampedPage + 1);
        if (e.key === "ArrowRight") goToPage(clampedPage - 1);
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="activity-heading" className="text-sm font-semibold text-[var(--text)]">
            Problems solved
          </h2>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold leading-none tabular-nums text-[var(--text)]">
              {bars.reduce((n, b) => n + b.count, 0)}
            </span>
            <span className="text-sm text-[var(--text-secondary)]">
              {mode === "day"
                ? clampedPage === 0
                  ? "in the last 7 days"
                  : "that week"
                : clampedPage === 0
                  ? "in the last 4 weeks"
                  : "in those 4 weeks"}
            </span>
          </p>
          <p className="mt-1.5 min-h-4 text-xs text-[var(--text-secondary)]" aria-live="polite">
            {/* The big number already states the period; this line narrates the hovered bar. */}
            {activeDay
              ? describeActivityCell({ ...activeDay, outside: false })
              : activeWeek
                ? describeActivityWeek(activeWeek)
                : "Hover a bar for details"}
          </p>
        </div>
        <div className="flex items-center gap-3">
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

      <dl className="mt-4 grid grid-cols-2 border-y border-[var(--border)] @xl:grid-cols-4">
        {[
          ["All time", activity.all_time],
          ["Last 7 days", summary.last7],
          [
            `Streak · best ${summary.longestStreak}`,
            summary.streak === 1 ? "1 day" : `${summary.streak} days`,
          ],
          ["Best day", summary.bestDay],
        ].map(([label, value], i) => (
          <div
            key={label}
            className={cn(
              "flex flex-col-reverse py-3",
              i > 0 && "@xl:border-l @xl:border-[var(--border)] @xl:pl-4",
              i % 2 === 1 && "@max-xl:pl-4",
            )}
          >
            <dt className="mt-0.5 text-xs text-[var(--text-secondary)]">{label}</dt>
            <dd className="text-base font-semibold tabular-nums text-[var(--text)]">{value}</dd>
          </div>
        ))}
      </dl>

      <div ref={frameRef} className="relative mt-4 min-w-0">
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
                  <rect x={x} y={y} width={barW} height={h} rx={3} fill={fill} />
                  {empty ? null : (
                    <text
                      x={x + barW / 2}
                      y={y - 5}
                      textAnchor="middle"
                      fill={
                        hover === i || (hover === null && current)
                          ? "var(--text)"
                          : "var(--text-secondary)"
                      }
                      fontSize={11}
                      fontWeight={600}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {countVal}
                    </text>
                  )}
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
