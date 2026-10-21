import { describe, expect, it } from "vitest";
import {
  globalViewerInRows,
  leaderboardHasFriends,
  leaderboardWeekLabel,
  parseGlobalLeaderboard,
  parseLeaderboard,
} from "./leaderboard";

const ROW = {
  user_id: "u1",
  handle: "alice",
  display_name: "Alice",
  avatar_url: null,
  total: 2,
  easy: 1,
  medium: 0,
  hard: 1,
  rank: 1,
  is_viewer: true,
};
const BOARD = { week_start: "2026-09-14", week_end: "2026-09-20", rows: [ROW] };

describe("parseLeaderboard", () => {
  it("accepts the RPC payload", () => {
    expect(parseLeaderboard(BOARD)?.rows[0]).toEqual(ROW);
  });

  it("rejects anything else", () => {
    expect(parseLeaderboard(null)).toBeNull();
    expect(parseLeaderboard({ ...BOARD, rows: [{ ...ROW, rank: 0 }] })).toBeNull();
  });
});

describe("leaderboardWeekLabel", () => {
  it("names this week and last week, and dates older weeks", () => {
    expect(leaderboardWeekLabel(0, "2026-09-14", "2026-09-20")).toBe(
      "This week · Sep 14 – Sep 20, 2026",
    );
    expect(leaderboardWeekLabel(-1, "2026-09-07", "2026-09-13")).toBe(
      "Last week · Sep 7 – Sep 13, 2026",
    );
    expect(leaderboardWeekLabel(-3, "2026-08-24", "2026-08-30")).toBe("Aug 24 – Aug 30, 2026");
  });
});

describe("leaderboardHasFriends", () => {
  it("is false when only the viewer is on the board", () => {
    const board = parseLeaderboard(BOARD);
    expect(board && leaderboardHasFriends(board)).toBe(false);
    const withFriend = parseLeaderboard({
      ...BOARD,
      rows: [ROW, { ...ROW, user_id: "u2", handle: "bob", is_viewer: false, rank: 2 }],
    });
    expect(withFriend && leaderboardHasFriends(withFriend)).toBe(true);
  });
});

describe("parseGlobalLeaderboard", () => {
  const VIEWER = { ...ROW, rank: 2, is_private: true };
  const GLOBAL = { ...BOARD, rows: [], viewer: VIEWER, ranked_count: 0 };

  it("accepts the RPC payload, including a private viewer and one without a rank yet", () => {
    expect(parseGlobalLeaderboard(GLOBAL)?.viewer).toEqual(VIEWER);
    expect(
      parseGlobalLeaderboard({ ...GLOBAL, viewer: { ...VIEWER, rank: null, total: 0 } }),
    ).not.toBeNull();
    expect(parseGlobalLeaderboard({ ...GLOBAL, viewer: null })).not.toBeNull();
  });

  it("rejects a payload without the global fields", () => {
    expect(parseGlobalLeaderboard(BOARD)).toBeNull();
    expect(parseGlobalLeaderboard({ ...GLOBAL, ranked_count: -1 })).toBeNull();
  });

  it("knows whether the viewer is already listed", () => {
    const listed = parseGlobalLeaderboard({ ...GLOBAL, rows: [ROW] });
    const unlisted = parseGlobalLeaderboard(GLOBAL);
    expect(listed && globalViewerInRows(listed)).toBe(true);
    expect(unlisted && globalViewerInRows(unlisted)).toBe(false);
  });
});
