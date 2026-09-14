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

/** A paused stretch of a session, in epoch ms. */
export interface PauseInterval {
  start: number;
  end: number;
}

/**
 * Paused intervals from the event log (pause -> resume pairs). An unmatched pause ends at `now`.
 * Recordings skip these stretches, so media time = wall-clock time minus the pauses before it.
 */
export function pausedIntervals(events: readonly TimerEvent[], now: number): PauseInterval[] {
  const out: PauseInterval[] = [];
  let pausedSince: number | null = null;
  for (const e of events) {
    if (e.type === "pause" && pausedSince === null) pausedSince = e.t;
    else if ((e.type === "resume" || e.type === "end") && pausedSince !== null) {
      if (e.t > pausedSince) out.push({ start: pausedSince, end: e.t });
      pausedSince = null;
    }
  }
  if (pausedSince !== null && now > pausedSince) out.push({ start: pausedSince, end: now });
  return out;
}

/**
 * Wall-clock epoch ms -> media ms of a recording that started at `t0` and skipped `pauses`.
 * Times inside a pause map to the pause's start (the frame shown while paused).
 */
export function toMediaMs(epochMs: number, t0: number, pauses: readonly PauseInterval[]): number {
  let media = epochMs - t0;
  for (const p of pauses) {
    if (p.end <= t0) continue;
    const start = Math.max(p.start, t0);
    if (epochMs <= start) break;
    media -= Math.min(epochMs, p.end) - start;
  }
  return Math.max(0, media);
}

/** Inverse of {@link toMediaMs}: media ms -> wall-clock epoch ms (skipping paused stretches). */
export function fromMediaMs(mediaMs: number, t0: number, pauses: readonly PauseInterval[]): number {
  let epoch = t0 + Math.max(0, mediaMs);
  for (const p of pauses) {
    if (p.end <= t0) continue;
    const start = Math.max(p.start, t0);
    if (epoch < start) break;
    epoch += p.end - start;
  }
  return epoch;
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
