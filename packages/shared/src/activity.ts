/**
 * Solved-problem activity grid (the GitHub-contributions-style square on profiles).
 *
 * The `solved_activity` RPC buckets accepted submissions into UTC days; everything here is
 * pure layout maths over that payload so the web and desktop apps render the same grid.
 */
import { z } from "zod";

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SolvedActivitySchema = z.object({
  /** False when the profile is private and the viewer is not an accepted follower. */
  visible: z.boolean(),
  /** First and last day of the window, inclusive. */
  start: IsoDateSchema,
  end: IsoDateSchema,
  days: z.array(z.object({ day: IsoDateSchema, count: z.number().int().nonnegative() })),
  total: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
  all_time: z.number().int().nonnegative(),
});
export type SolvedActivity = z.infer<typeof SolvedActivitySchema>;

export function parseSolvedActivity(value: unknown): SolvedActivity | null {
  const parsed = SolvedActivitySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const ACTIVITY_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Blank label rows keep the Mon/Wed/Fri pattern GitHub uses. */
export const ACTIVITY_WEEKDAYS = ["", "Mon", "", "Wed", "", "Fri", ""] as const;

export interface ActivityCell {
  iso: string;
  date: Date;
  count: number;
  /** Padding outside the window (before `start` or after `end`); render as a gap. */
  outside: boolean;
}

/** Parses `YYYY-MM-DD` at UTC midnight, matching the RPC's UTC day buckets. */
function utcDate(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Columns of 7 days, Sunday-first, padded out to whole weeks at both ends. */
export function buildActivityWeeks(activity: SolvedActivity): ActivityCell[][] {
  const counts = new Map(activity.days.map((d) => [d.day, d.count]));
  const start = utcDate(activity.start);
  const end = utcDate(activity.end);
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());

  const weeks: ActivityCell[][] = [];
  let week: ActivityCell[] = [];
  while (cursor <= end || week.length > 0) {
    const iso = cursor.toISOString().slice(0, 10);
    const outside = cursor < start || cursor > end;
    week.push({
      iso,
      date: new Date(cursor),
      count: outside ? 0 : (counts.get(iso) ?? 0),
      outside,
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
      if (cursor >= end) break;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return weeks;
}

/** 0 means "no solves" (neutral surface); 1-4 are steps of the sequential ramp. */
export function activityLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as 1 | 2 | 3 | 4;
}

/** One label per week column, set only on the week that starts a new month. */
export function activityMonthLabels(weeks: ActivityCell[][]): Array<string | null> {
  let previous = -1;
  return weeks.map((week) => {
    const month = week[0]?.date.getUTCMonth() ?? previous;
    if (month === previous) return null;
    previous = month;
    return ACTIVITY_MONTHS[month] ?? null;
  });
}

export function describeActivityCell(cell: ActivityCell): string {
  const label = cell.date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (cell.count === 0) return `No problems solved on ${label}`;
  return `${cell.count} problem${cell.count === 1 ? "" : "s"} solved on ${label}`;
}
