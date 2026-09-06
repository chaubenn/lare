import { describe, expect, it } from "vitest";
import {
  buildActivityWeekBars,
  describeActivityWeek,
  formatWeekRange,
  type SolvedActivity,
} from "./activity";

const SAMPLE: SolvedActivity = {
  visible: true,
  start: "2026-01-01",
  end: "2026-01-21",
  days: [
    { day: "2026-01-02", count: 2 },
    { day: "2026-01-08", count: 1 },
    { day: "2026-01-09", count: 3 },
  ],
  total: 6,
  max: 3,
  all_time: 10,
};

describe("buildActivityWeekBars", () => {
  it("rolls daily solves into Sunday-first weeks", () => {
    const weeks = buildActivityWeekBars(SAMPLE);
    expect(weeks.length).toBeGreaterThanOrEqual(3);

    const weekOfJan4 = weeks.find((w) => w.firstDay <= "2026-01-02" && w.lastDay >= "2026-01-02");
    expect(weekOfJan4?.count).toBe(2);
    expect(weekOfJan4?.daysActive).toBe(1);

    const weekOfJan11 = weeks.find((w) => w.firstDay <= "2026-01-08" && w.lastDay >= "2026-01-09");
    expect(weekOfJan11?.count).toBe(4);
    expect(weekOfJan11?.daysActive).toBe(2);
    expect(weekOfJan11?.maxDay).toBe(3);
  });

  it("marks the week that contains the window end as current", () => {
    const weeks = buildActivityWeekBars(SAMPLE);
    const current = weeks.filter((w) => w.current);
    expect(current).toHaveLength(1);
    const lastDay = current[0]?.lastDay ?? "";
    expect(lastDay >= "2026-01-21").toBe(true);
  });
});

describe("formatWeekRange", () => {
  it("prints a short UTC range", () => {
    expect(formatWeekRange("2026-01-04", "2026-01-10")).toBe("Jan 4 – Jan 10, 2026");
  });
});

describe("describeActivityWeek", () => {
  it("names the count and active days", () => {
    const week = buildActivityWeekBars(SAMPLE).find((w) => w.count === 4);
    expect(week).toBeDefined();
    expect(describeActivityWeek(week!)).toContain("4 problems");
    expect(describeActivityWeek(week!)).toContain("2 days active");
  });
});
