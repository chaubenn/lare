import { describe, expect, it } from "vitest";
import {
  activeMs,
  fromMediaMs,
  pausedIntervals,
  problemActiveMs,
  type TimerEvent,
  timerStatus,
  toMediaMs,
} from "./timer";

const e = (t: number, type: TimerEvent["type"], slug?: string): TimerEvent =>
  slug ? { t, type, slug } : { t, type };

describe("timerStatus", () => {
  it("follows start/pause/resume/end", () => {
    expect(timerStatus([])).toBe("idle");
    expect(timerStatus([e(0, "start")])).toBe("running");
    expect(timerStatus([e(0, "start"), e(5, "pause")])).toBe("paused");
    expect(timerStatus([e(0, "start"), e(5, "pause"), e(7, "resume")])).toBe("running");
    expect(timerStatus([e(0, "start"), e(5, "end")])).toBe("ended");
  });

  it("ignores redundant pause/resume", () => {
    expect(timerStatus([e(0, "start"), e(1, "resume")])).toBe("running");
    expect(timerStatus([e(0, "start"), e(1, "pause"), e(2, "pause")])).toBe("paused");
  });
});

describe("activeMs", () => {
  it("excludes paused time and counts up to now while running", () => {
    const events = [e(0, "start"), e(10_000, "pause"), e(25_000, "resume")];
    expect(activeMs(events, 30_000)).toBe(15_000);
  });

  it("freezes at end", () => {
    const events = [e(0, "start"), e(10_000, "pause"), e(25_000, "resume"), e(40_000, "end")];
    expect(activeMs(events, 99_999)).toBe(25_000);
  });

  it("is zero while paused with no prior running time", () => {
    expect(activeMs([e(0, "start"), e(0, "pause")], 5000)).toBe(0);
  });
});

describe("problemActiveMs", () => {
  it("intersects running intervals with the problem's open window", () => {
    const events = [
      e(0, "start"),
      e(0, "problem_open", "two-sum"),
      e(10_000, "pause"),
      e(20_000, "resume"),
      e(30_000, "problem_close", "two-sum"),
      e(30_000, "problem_open", "add-two-numbers"),
      e(50_000, "end"),
    ];
    expect(problemActiveMs(events, "two-sum", 60_000)).toBe(20_000);
    expect(problemActiveMs(events, "add-two-numbers", 60_000)).toBe(20_000);
    expect(problemActiveMs(events, "unknown", 60_000)).toBe(0);
  });

  it("closes an open problem at end", () => {
    const events = [e(0, "start"), e(0, "problem_open", "x"), e(5000, "end")];
    expect(problemActiveMs(events, "x", 99_999)).toBe(5000);
  });
});

describe("media time with pauses", () => {
  const t0 = 1_000_000;
  const events: TimerEvent[] = [
    { t: t0, type: "start" },
    { t: t0 + 10_000, type: "pause" },
    { t: t0 + 15_000, type: "resume" },
    { t: t0 + 30_000, type: "pause" },
    { t: t0 + 32_000, type: "resume" },
    { t: t0 + 40_000, type: "end" },
  ];
  const pauses = pausedIntervals(events, t0 + 40_000);

  it("extracts pause/resume pairs", () => {
    expect(pauses).toEqual([
      { start: t0 + 10_000, end: t0 + 15_000 },
      { start: t0 + 30_000, end: t0 + 32_000 },
    ]);
  });

  it("closes an unmatched pause at now", () => {
    const open: TimerEvent[] = [
      { t: t0, type: "start" },
      { t: t0 + 5_000, type: "pause" },
    ];
    expect(pausedIntervals(open, t0 + 9_000)).toEqual([{ start: t0 + 5_000, end: t0 + 9_000 }]);
  });

  it("subtracts elapsed pauses from wall-clock time", () => {
    expect(toMediaMs(t0 + 5_000, t0, pauses)).toBe(5_000);
    expect(toMediaMs(t0 + 12_000, t0, pauses)).toBe(10_000); // inside pause -> pause start
    expect(toMediaMs(t0 + 20_000, t0, pauses)).toBe(15_000);
    expect(toMediaMs(t0 + 40_000, t0, pauses)).toBe(33_000);
    expect(toMediaMs(t0 - 500, t0, pauses)).toBe(0);
  });

  it("round-trips through fromMediaMs", () => {
    for (const media of [0, 5_000, 10_000, 15_000, 33_000]) {
      expect(toMediaMs(fromMediaMs(media, t0, pauses), t0, pauses)).toBe(media);
    }
    expect(fromMediaMs(15_000, t0, pauses)).toBe(t0 + 20_000);
  });

  it("ignores pauses that ended before the recording started", () => {
    const early = [{ start: t0 - 5_000, end: t0 - 1_000 }];
    expect(toMediaMs(t0 + 3_000, t0, early)).toBe(3_000);
  });
});
