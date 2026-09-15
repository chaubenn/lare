/**
 * Weekly friends leaderboard. The `weekly_leaderboard` RPC counts distinct problems solved in a
 * UTC Monday–Sunday week by the viewer and the people they follow; this module parses it and
 * labels the week.
 */
import { z } from "zod";
import { formatWeekRange } from "../session/activity";

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Count = z.number().int().nonnegative();

export const LeaderboardRowSchema = z.object({
  user_id: z.string(),
  handle: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  total: Count,
  easy: Count,
  medium: Count,
  hard: Count,
  /** Competition rank on `total`: ties share a rank (1, 1, 3). */
  rank: z.number().int().positive(),
  is_viewer: z.boolean(),
});
export type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>;

export const LeaderboardSchema = z.object({
  week_start: IsoDateSchema,
  /** Sunday, inclusive. */
  week_end: IsoDateSchema,
  rows: z.array(LeaderboardRowSchema),
});
export type Leaderboard = z.infer<typeof LeaderboardSchema>;

export function parseLeaderboard(value: unknown): Leaderboard | null {
  const parsed = LeaderboardSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** "This week · Sep 14 – Sep 20, 2026", "Last week · …", or just the range further back. */
export function leaderboardWeekLabel(offset: number, weekStart: string, weekEnd: string): string {
  const range = formatWeekRange(weekStart, weekEnd);
  if (offset === 0) return `This week · ${range}`;
  if (offset === -1) return `Last week · ${range}`;
  return range;
}

/** Whether anyone besides the viewer is on the board. */
export function leaderboardHasFriends(board: Leaderboard): boolean {
  return board.rows.some((row) => !row.is_viewer);
}
