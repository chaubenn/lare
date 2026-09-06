import {
  type ActivityWeek,
  buildActivityWeekBars,
  describeActivityWeek,
  formatWeekRange,
  type SolvedActivity,
} from "@lare/shared";
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

function WeekBar(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: ActivityWeek;
  fill?: string;
}) {
  const x = props.x ?? 0;
  const y = props.y ?? 0;
  const width = props.width ?? 0;
  const height = props.height ?? 0;
  const empty = (props.payload?.count ?? 0) === 0;
  const h = empty ? 3 : Math.max(height, 3);
  const top = empty ? y + height - 3 : y;
  return <rect x={x} y={top} width={Math.max(width, 2)} height={h} rx={2} fill={props.fill} />;
}

function WeekTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ActivityWeek }>;
}) {
  if (!active || !payload?.[0]) return null;
  const week = payload[0].payload;
  return (
    <div
      className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 shadow-lg shadow-black/40"
      style={{ background: PAPER, borderColor: LINE, color: INK }}
    >
      <p className="font-medium">{formatWeekRange(week.firstDay, week.lastDay)}</p>
      <p className="mt-1 tabular-nums text-zinc-300">
        {week.count === 0 ? "No problems" : `${week.count} problem${week.count === 1 ? "" : "s"}`}
      </p>
      <p className="text-zinc-500">
        {week.daysActive === 0
          ? "No active days"
          : `${week.daysActive} day${week.daysActive === 1 ? "" : "s"} active`}
        {week.maxDay > 1 ? ` · best day ${week.maxDay}` : ""}
      </p>
    </div>
  );
}

/**
 * Hevy-style weekly solve chart. One bar per week; hover writes the week into the header
 * and a tooltip. Empty weeks keep a 3px stub so the year stays readable as a rhythm.
 */
export function ActivityChart({
  activity,
  className,
}: {
  activity: SolvedActivity;
  className?: string;
}) {
  const weeks = useMemo(() => buildActivityWeekBars(activity), [activity]);
  const [hover, setHover] = useState<number | null>(null);
  const active = hover !== null ? weeks[hover] : null;
  const max = Math.max(1, ...weeks.map((w) => w.count));

  return (
    <section
      aria-labelledby="activity-heading"
      className={cn("rounded-xl border border-zinc-800 bg-zinc-900/40 p-4", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id="activity-heading" className="text-sm font-semibold text-zinc-100">
            Problems solved
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500" aria-live="polite">
            {active ? (
              <span className="text-zinc-300">{describeActivityWeek(active)}</span>
            ) : (
              <>
                <span className="font-semibold tabular-nums text-zinc-300">{activity.total}</span>{" "}
                in the last year · {activity.all_time} all time
              </>
            )}
          </p>
        </div>
        <p className="text-[11px] tabular-nums text-zinc-600">Peak week {max}</p>
      </div>

      <div className="mt-3 h-36 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={weeks}
            margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
            barCategoryGap="18%"
            onMouseMove={(state) => {
              const i = state.activeTooltipIndex;
              setHover(typeof i === "number" ? i : null);
            }}
            onMouseLeave={() => setHover(null)}
          >
            <XAxis
              dataKey="start"
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={{ fontSize: 10, fill: TICK }}
              tickFormatter={(_v: string, i: number) => weeks[i]?.monthLabel ?? ""}
              height={18}
            />
            <Tooltip
              cursor={{ fill: "rgba(240, 236, 228, 0.06)" }}
              content={<WeekTooltip />}
              allowEscapeViewBox={{ x: true, y: true }}
            />
            <Bar
              dataKey="count"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
              shape={<WeekBar />}
            >
              {weeks.map((week, i) => (
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
        </ResponsiveContainer>
      </div>
    </section>
  );
}
