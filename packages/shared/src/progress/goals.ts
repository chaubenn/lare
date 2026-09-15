/**
 * Practice goals: one private "N problems per day/week" goal with an optional minimum
 * difficulty. `goal_progress` measures it over UTC periods (weeks start Monday); this module
 * parses that and turns it into copy.
 */
import { z } from "zod";

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Count = z.number().int().nonnegative();

export const GOAL_PERIODS = ["day", "week"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export const GOAL_DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
export type GoalDifficulty = (typeof GOAL_DIFFICULTIES)[number];

export const GOAL_TARGET_MIN = 1;
export const GOAL_TARGET_MAX = 50;

export const GoalSchema = z.object({
  period: z.enum(GOAL_PERIODS),
  target: z.number().int().min(GOAL_TARGET_MIN).max(GOAL_TARGET_MAX),
  /** Null counts every difficulty; otherwise this difficulty or harder. */
  min_difficulty: z.enum(GOAL_DIFFICULTIES).nullable(),
});
export type Goal = z.infer<typeof GoalSchema>;

const ActiveGoalProgressSchema = z.object({
  goal: GoalSchema,
  period_start: IsoDateSchema,
  period_end: IsoDateSchema,
  current: Count,
  met: z.boolean(),
  /** Consecutive met periods; the open period only adds to it once met. */
  streak: Count,
  /** Last 8 periods, oldest first; the last entry is the current period. */
  history: z.array(z.object({ start: IsoDateSchema, count: Count, met: z.boolean() })),
});
export type ActiveGoalProgress = z.infer<typeof ActiveGoalProgressSchema>;

export const GoalProgressSchema = z.union([z.object({ goal: z.null() }), ActiveGoalProgressSchema]);
export type GoalProgress = z.infer<typeof GoalProgressSchema>;

export function parseGoalProgress(value: unknown): GoalProgress | null {
  const parsed = GoalProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isActiveGoal(progress: GoalProgress): progress is ActiveGoalProgress {
  return progress.goal !== null;
}

const GoalFormSchema = z.object({
  period: z.enum(GOAL_PERIODS),
  target: z.coerce.number().int().min(GOAL_TARGET_MIN).max(GOAL_TARGET_MAX),
  min_difficulty: z
    .enum(GOAL_DIFFICULTIES)
    .or(z.literal(""))
    .transform((value) => (value === "" ? null : value)),
});

/** Goal from raw form values (strings); null when anything is out of range. */
export function parseGoalForm(input: {
  period: unknown;
  target: unknown;
  min_difficulty: unknown;
}): Goal | null {
  const parsed = GoalFormSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** "3 problems per week", "1 Medium+ problem per day", "2 Hard problems per day". */
export function describeGoal(goal: Goal): string {
  const level =
    goal.min_difficulty === null
      ? ""
      : goal.min_difficulty === "Hard"
        ? "Hard "
        : `${goal.min_difficulty}+ `;
  return `${goal.target} ${level}problem${goal.target === 1 ? "" : "s"} per ${goal.period}`;
}

export function goalRatio(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1, Math.max(0, current / target));
}

/** "Goal met", "2 more this week", "1 more today". */
export function goalStatus(progress: ActiveGoalProgress): string {
  if (progress.met) return "Goal met";
  const left = Math.max(0, progress.goal.target - progress.current);
  return `${left} more ${progress.goal.period === "day" ? "today" : "this week"}`;
}

/** "No streak yet", "1 day in a row", "4 weeks in a row". */
export function describeGoalStreak(streak: number, period: GoalPeriod): string {
  if (streak <= 0) return "No streak yet";
  return `${streak} ${period}${streak === 1 ? "" : "s"} in a row`;
}
