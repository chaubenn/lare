import { describe, expect, it } from "vitest";
import {
  describeGoal,
  describeGoalStreak,
  goalRatio,
  goalStatus,
  isActiveGoal,
  parseGoalForm,
  parseGoalProgress,
} from "./goals";

const ACTIVE = {
  goal: { period: "week", target: 3, min_difficulty: null },
  period_start: "2026-09-14",
  period_end: "2026-09-20",
  current: 1,
  met: false,
  streak: 4,
  history: [{ start: "2026-09-14", count: 1, met: false }],
};

describe("parseGoalProgress", () => {
  it("accepts no goal and an active goal", () => {
    expect(parseGoalProgress({ goal: null })).toEqual({ goal: null });
    const active = parseGoalProgress(ACTIVE);
    expect(active && isActiveGoal(active)).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(parseGoalProgress(undefined)).toBeNull();
    expect(parseGoalProgress({ ...ACTIVE, goal: { ...ACTIVE.goal, target: 0 } })).toBeNull();
  });
});

describe("describeGoal", () => {
  it("reads naturally", () => {
    expect(describeGoal({ period: "week", target: 3, min_difficulty: null })).toBe(
      "3 problems per week",
    );
    expect(describeGoal({ period: "day", target: 1, min_difficulty: "Medium" })).toBe(
      "1 Medium+ problem per day",
    );
    expect(describeGoal({ period: "day", target: 2, min_difficulty: "Hard" })).toBe(
      "2 Hard problems per day",
    );
  });
});

describe("goalRatio", () => {
  it("clamps to 0..1", () => {
    expect(goalRatio(0, 3)).toBe(0);
    expect(goalRatio(2, 4)).toBe(0.5);
    expect(goalRatio(5, 3)).toBe(1);
  });
});

describe("goalStatus", () => {
  it("says what is left in the period", () => {
    const active = parseGoalProgress(ACTIVE);
    if (!active || !isActiveGoal(active)) throw new Error("fixture");
    expect(goalStatus(active)).toBe("2 more this week");
    expect(goalStatus({ ...active, goal: { ...active.goal, period: "day", target: 2 } })).toBe(
      "1 more today",
    );
    expect(goalStatus({ ...active, current: 3, met: true })).toBe("Goal met");
  });
});

describe("describeGoalStreak", () => {
  it("counts periods in a row", () => {
    expect(describeGoalStreak(0, "day")).toBe("No streak yet");
    expect(describeGoalStreak(1, "day")).toBe("1 day in a row");
    expect(describeGoalStreak(4, "week")).toBe("4 weeks in a row");
  });
});

describe("parseGoalForm", () => {
  it("coerces form values", () => {
    expect(parseGoalForm({ period: "week", target: "3", min_difficulty: "" })).toEqual({
      period: "week",
      target: 3,
      min_difficulty: null,
    });
    expect(parseGoalForm({ period: "day", target: "1", min_difficulty: "Hard" })).toEqual({
      period: "day",
      target: 1,
      min_difficulty: "Hard",
    });
  });

  it("rejects out-of-range or unknown values", () => {
    expect(parseGoalForm({ period: "week", target: "0", min_difficulty: "" })).toBeNull();
    expect(parseGoalForm({ period: "week", target: "2.5", min_difficulty: "" })).toBeNull();
    expect(parseGoalForm({ period: "month", target: "3", min_difficulty: "" })).toBeNull();
    expect(parseGoalForm({ period: "week", target: "3", min_difficulty: "Insane" })).toBeNull();
  });
});
