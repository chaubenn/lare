import { z } from "zod";

export const TimerEventTypeSchema = z.enum([
  "start",
  "pause",
  "resume",
  "end",
  "problem_open",
  "problem_close",
]);
export type TimerEventType = z.infer<typeof TimerEventTypeSchema>;

export const TimerEventSchema = z.object({
  /** Epoch ms. */
  t: z.number().int().nonnegative(),
  type: TimerEventTypeSchema,
  /** Problem slug for problem_open/problem_close. */
  slug: z.string().optional(),
});
export type TimerEvent = z.infer<typeof TimerEventSchema>;

export type TimerStatus = "idle" | "running" | "paused" | "ended";

/** Derive the current status from the event log. */
export function timerStatus(events: readonly TimerEvent[]): TimerStatus {
  let status: TimerStatus = "idle";
  for (const e of events) {
    switch (e.type) {
      case "start":
        status = "running";
        break;
      case "pause":
        if (status === "running") status = "paused";
        break;
      case "resume":
        if (status === "paused") status = "running";
        break;
      case "end":
        status = "ended";
        break;
      default:
        break;
    }
  }
  return status;
}

/**
 * Active (unpaused) milliseconds between `start` and `end` (or `now` when the
 * session is still open). Pauses are excluded. Events must be in time order.
 */
export function activeMs(events: readonly TimerEvent[], now: number): number {
  let total = 0;
  let runningSince: number | null = null;
  for (const e of events) {
    switch (e.type) {
      case "start":
      case "resume":
        if (runningSince === null) runningSince = e.t;
        break;
      case "pause":
      case "end":
        if (runningSince !== null) {
          total += Math.max(0, e.t - runningSince);
          runningSince = null;
        }
        break;
      default:
        break;
    }
  }
  if (runningSince !== null) total += Math.max(0, now - runningSince);
  return total;
}

/**
 * Active milliseconds attributed to a single problem: the intersection of the
 * session's running intervals with the problem's open interval(s).
 */
export function problemActiveMs(events: readonly TimerEvent[], slug: string, now: number): number {
  const running: [number, number][] = [];
  let runningSince: number | null = null;
  const open: [number, number][] = [];
  let openSince: number | null = null;
  for (const e of events) {
    switch (e.type) {
      case "start":
      case "resume":
        if (runningSince === null) runningSince = e.t;
        break;
      case "pause":
      case "end":
        if (runningSince !== null) {
          running.push([runningSince, e.t]);
          runningSince = null;
        }
        if (e.type === "end" && openSince !== null) {
          open.push([openSince, e.t]);
          openSince = null;
        }
        break;
      case "problem_open":
        if (e.slug === slug && openSince === null) openSince = e.t;
        break;
      case "problem_close":
        if (e.slug === slug && openSince !== null) {
          open.push([openSince, e.t]);
          openSince = null;
        }
        break;
    }
  }
  if (runningSince !== null) running.push([runningSince, now]);
  if (openSince !== null) open.push([openSince, now]);
  let total = 0;
  for (const [rs, re] of running) {
    for (const [os, oe] of open) {
      const s = Math.max(rs, os);
      const e = Math.min(re, oe);
      if (e > s) total += e - s;
    }
  }
  return total;
}
