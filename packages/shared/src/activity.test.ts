import { describe, expect, it } from "vitest";
import {
  buildActivityDays,
  buildActivityWeekBars,
  describeActivityWeek,
  formatWeekRange,
  maxPage,
  pageWindow,
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

describe("buildActivityDays", () => {
  it("returns one entry per real day in the window, in chronological order, no padding", () => {
    const days = buildActivityDays(SAMPLE);
    expect(days).toHaveLength(21); // Jan 1 - Jan 21 inclusive
    expect(days[0]?.iso).toBe("2026-01-01");
    expect(days[days.length - 1]?.iso).toBe("2026-01-21");
    expect(days.find((d) => d.iso === "2026-01-09")?.count).toBe(3);
    expect(days.find((d) => d.iso === "2026-01-01")?.count).toBe(0);
  });
});

describe("pageWindow", () => {
  const items = Array.from({ length: 21 }, (_, i) => i); // 0..20

  it("page 0 is the most recent `pageSize` items", () => {
    expect(pageWindow(items, 7, 0)).toEqual([14, 15, 16, 17, 18, 19, 20]);
  });

  it("page 1 is the 7 items before that", () => {
    expect(pageWindow(items, 7, 1)).toEqual([7, 8, 9, 10, 11, 12, 13]);
  });

  it("clamps a partial final page to what's actually available", () => {
    expect(pageWindow(items, 7, 2)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pageWindow(items, 8, 2)).toEqual([0, 1, 2, 3, 4]); // only 5 left before the start
  });
});

describe("maxPage", () => {
  it("is the last page index that still has at least one item", () => {
    expect(maxPage(21, 7)).toBe(2);
    expect(maxPage(20, 7)).toBe(2);
    expect(maxPage(14, 7)).toBe(1);
    expect(maxPage(0, 7)).toBe(0);
  });
});
