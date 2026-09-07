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
import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { cn } from "./cn";

const BAR_IDLE = "#3d3c39";
const BAR_ACTIVE = "#f0ece4";
const BAR_STUB = "#2a2a27";
const TICK = "#8a8780";
const PAPER = "#161615";
const INK = "#f0ece4";
const LINE = "#2a2a27";

type Mode = "day" | "week";

function Bar3({
  x,
  y,
  width,
  height,
  fill,
  empty,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  empty: boolean;
}) {
  const px = x ?? 0;
  const py = y ?? 0;
  const w = width ?? 0;
  const h = height ?? 0;
  const barH = empty ? 3 : Math.max(h, 3);
  const top = empty ? py + h - 3 : py;
  return <rect x={px} y={top} width={Math.max(w, 2)} height={barH} rx={2} fill={fill} />;
}

function WeekBar(props: { payload?: ActivityWeek } & Record<string, unknown>) {
  return <Bar3 {...props} empty={(props.payload?.count ?? 0) === 0} />;
}

function DayBar(props: { payload?: ActivityDay } & Record<string, unknown>) {
  return <Bar3 {...props} empty={(props.payload?.count ?? 0) === 0} />;
}

function TooltipCard({ children, flip }: { children: React.ReactNode; flip: boolean }) {
  return (
    <div
      className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 shadow-lg shadow-black/40"
      style={{
        background: PAPER,
        borderColor: LINE,
        color: INK,
        // Recharts offsets its default tooltip from the cursor with no viewport-edge
        // awareness, so it clips when the chart sits near the right edge of the page.
        // Flip it to the left of the cursor instead of translating off-screen.
        transform: flip ? "translateX(calc(-100% - 24px))" : undefined,
      }}
    >
      {children}
    </div>
  );
}

function WeekTooltip({
  active,
  payload,
  coordinate,
  chartWidth,
}: {
  active?: boolean;
  payload?: Array<{ payload: ActivityWeek }>;
  coordinate?: { x?: number };
  chartWidth: number;
}) {
  if (!active || !payload?.[0]) return null;
  const week = payload[0].payload;
  const flip = (coordinate?.x ?? 0) > chartWidth * 0.6;
  return (
    <TooltipCard flip={flip}>
      <p className="font-medium">{formatWeekRange(week.firstDay, week.lastDay)}</p>
      <p className="mt-1 tabular-nums text-zinc-300">
        {week.count === 0
          ? "No problems solved"
          : `${week.count} problem${week.count === 1 ? "" : "s"} solved`}
      </p>
    </TooltipCard>
  );
}

function DayTooltip({
  active,
  payload,
  coordinate,
  chartWidth,
}: {
  active?: boolean;
  payload?: Array<{ payload: ActivityDay }>;
  coordinate?: { x?: number };
  chartWidth: number;
}) {
  if (!active || !payload?.[0]) return null;
  const day = payload[0].payload;
  const flip = (coordinate?.x ?? 0) > chartWidth * 0.6;
  return (
    <TooltipCard flip={flip}>
      <p className="font-medium">{describeActivityCell({ ...day, outside: false })}</p>
    </TooltipCard>
  );
}

/**
 * Arrows sit outside the chart frame so they never cover bars. Hidden on mobile, same
 * treatment as the post carousel's nav buttons, for a uniform swipe affordance app-wide.
 */
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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "absolute top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-zinc-950/60 p-1.5 text-zinc-100 ring-1 ring-white/10 backdrop-blur transition-opacity hover:bg-zinc-950/80 disabled:pointer-events-none disabled:opacity-0 sm:block",
        side === "left" ? "-left-3 sm:-left-4" : "-right-3 sm:-right-4",
      )}
    >
      {side === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
}

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

/**
 * Hevy-style solve chart. Toggle between a 7-day and a 7-week window; swipe (arrows,
 * touch-scroll via the surrounding page, or keyboard once focused) to page back through
 * history, forward again once you've gone back.
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
  const [chartWidth, setChartWidth] = useState(0);

  const days = useMemo(() => buildActivityDays(activity), [activity]);
  const weeks = useMemo(() => buildActivityWeekBars(activity), [activity]);

  const dayBars = useMemo(() => pageWindow(days, 7, page), [days, page]);
  const weekBars = useMemo(() => pageWindow(weeks, 7, page), [weeks, page]);
  const lastPage = maxPage(mode === "day" ? days.length : weeks.length, 7);
  const clampedPage = Math.min(page, lastPage);

  function setModeAndReset(next: Mode) {
    setMode(next);
    setPage(0);
    setHover(null);
  }

  function goToPage(next: number) {
    setPage(Math.max(0, Math.min(lastPage, next)));
    setHover(null);
  }

  const activeDay = mode === "day" && hover !== null ? dayBars[hover] : null;
  const activeWeek = mode === "week" && hover !== null ? weekBars[hover] : null;
  const bars = mode === "day" ? dayBars : weekBars;
  const max = Math.max(1, ...bars.map((b) => b.count));

  return (
    <section
      aria-labelledby="activity-heading"
      className={cn("relative rounded-xl border border-zinc-800 bg-zinc-900/40 p-4", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id="activity-heading" className="text-sm font-semibold text-zinc-100">
            Problems solved
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500" aria-live="polite">
            {activeDay ? (
              <span className="text-zinc-300">
                {describeActivityCell({ ...activeDay, outside: false })}
              </span>
            ) : activeWeek ? (
              <span className="text-zinc-300">{describeActivityWeek(activeWeek)}</span>
            ) : (
              <span className="text-zinc-300">
                {mode === "day" ? describeDayPage(dayBars) : describeWeekPage(weekBars)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[11px] tabular-nums text-zinc-600">Peak {max}</p>
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5 text-[11px]">
            {(["day", "week"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModeAndReset(m)}
                aria-pressed={mode === m}
                className={cn(
                  "rounded-md px-2 py-1 capitalize transition-colors",
                  mode === m ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 h-36 min-w-0" ref={(el) => setChartWidth(el?.clientWidth ?? 0)}>
        <ResponsiveContainer width="100%" height="100%">
          {mode === "day" ? (
            <BarChart
              data={dayBars}
              margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
              barCategoryGap="18%"
            >
              <XAxis
                dataKey="iso"
                tickLine={false}
                axisLine={false}
                interval={0}
                tick={{ fontSize: 10, fill: TICK }}
                tickFormatter={(iso: string) =>
                  new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })
                }
                height={18}
              />
              <Tooltip
                cursor={false}
                content={<DayTooltip chartWidth={chartWidth} />}
                allowEscapeViewBox={{ x: true, y: true }}
              />
              <Bar
                dataKey="count"
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
                shape={<DayBar />}
                onMouseEnter={(_data, i) => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                {dayBars.map((day, i) => (
                  <Cell
                    key={day.iso}
                    fill={
                      hover === i ||
                      (hover === null && i === dayBars.length - 1 && clampedPage === 0)
                        ? BAR_ACTIVE
                        : day.count === 0
                          ? BAR_STUB
                          : BAR_IDLE
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <BarChart
              data={weekBars}
              margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
              barCategoryGap="18%"
            >
              <XAxis
                dataKey="start"
                tickLine={false}
                axisLine={false}
                interval={0}
                tick={{ fontSize: 10, fill: TICK }}
                tickFormatter={(_v: string, i: number) => weekBars[i]?.monthLabel ?? ""}
                height={18}
              />
              <Tooltip
                cursor={false}
                content={<WeekTooltip chartWidth={chartWidth} />}
                allowEscapeViewBox={{ x: true, y: true }}
              />
              <Bar
                dataKey="count"
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
                shape={<WeekBar />}
                onMouseEnter={(_data, i) => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                {weekBars.map((week, i) => (
                  <Cell
                    key={week.start}
                    fill={
                      hover === i || (hover === null && week.current)
                        ? BAR_ACTIVE
                        : week.count === 0
                          ? BAR_STUB
                          : BAR_IDLE
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
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
