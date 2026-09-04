import {
  ACTIVITY_WEEKDAYS,
  activityLevel,
  activityMonthLabels,
  buildActivityWeeks,
  describeActivityCell,
  type SolvedActivity,
} from "@lare/shared";
import { Card } from "@/components/ui/Card";

/**
 * Sequential single-hue ramp on the zinc dark surface: empty days sit on the neutral surface,
 * busier days step light-ward through one emerald hue. Index 0 is "no solves", not a data step.
 */
const LEVELS = [
  "bg-zinc-900 ring-1 ring-inset ring-zinc-800/70",
  "bg-emerald-950",
  "bg-emerald-800",
  "bg-emerald-600",
  "bg-emerald-400",
] as const;

/** GitHub-style grid of problems solved per day, read from the `solved_activity` RPC. */
export function ActivityGrid({ activity }: { activity: SolvedActivity }) {
  const weeks = buildActivityWeeks(activity);
  const months = activityMonthLabels(weeks);

  return (
    <Card aria-labelledby="activity-heading" className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="activity-heading" className="text-sm font-semibold text-zinc-100">
          Problems solved
        </h2>
        <p className="text-xs text-zinc-500">
          <span className="font-semibold tabular-nums text-zinc-300">{activity.total}</span> in the
          last year · {activity.all_time} all time
        </p>
      </div>

      <div className="mt-4 overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2">
          <div className="grid shrink-0 grid-rows-7 gap-[3px] pt-[18px] text-[10px] text-zinc-500">
            {ACTIVITY_WEEKDAYS.map((label, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed weekday positions
              <span key={i} className="flex h-[11px] items-center leading-none">
                {label}
              </span>
            ))}
          </div>

          <div>
            <div className="mb-1 flex gap-[3px] text-[10px] leading-none text-zinc-500">
              {months.map((label, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: one slot per week column
                <span key={i} className="w-[11px] shrink-0 whitespace-nowrap">
                  {label}
                </span>
              ))}
            </div>

            <div className="flex gap-[3px]">
              {weeks.map((week) => (
                <div key={week[0]?.iso} className="grid grid-rows-7 gap-[3px]">
                  {week.map((cell) =>
                    cell.outside ? (
                      <span key={cell.iso} className="size-[11px]" />
                    ) : (
                      <span
                        key={cell.iso}
                        role="img"
                        title={describeActivityCell(cell)}
                        aria-label={describeActivityCell(cell)}
                        className={`size-[11px] rounded-[2px] ${LEVELS[activityLevel(cell.count, activity.max)]}`}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-zinc-500">
        <span>Less</span>
        {LEVELS.map((level, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed ramp steps
          <span key={i} className={`size-[11px] rounded-[2px] ${level}`} />
        ))}
        <span>More</span>
      </div>
    </Card>
  );
}
