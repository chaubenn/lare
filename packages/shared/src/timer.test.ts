import { describe, expect, it } from "vitest";
import { type TimerEvent, activeMs, problemActiveMs, timerStatus } from "./timer";

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
