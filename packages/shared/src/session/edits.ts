import { z } from "zod";
import { SNAPSHOT_EVERY_EVENTS, SNAPSHOT_EVERY_MS } from "./constants";

/**
 * A single Monaco content change, compacted as a tuple:
 * [rangeOffset, rangeLength, text]. Offsets refer to the model text *before*
 * the event is applied. Monaco orders changes from the end of the document to
 * the start so they can be applied sequentially; we re-sort defensively.
 */
export const EditChangeSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
  z.string(),
]);
export type EditChange = z.infer<typeof EditChangeSchema>;

export const EditEventSchema = z.object({
  /** Wall-clock time in epoch milliseconds. */
  t: z.number().int().nonnegative(),
  /** Monaco model versionId after this event. */
  v: z.number().int().nonnegative(),
  /** Changes in this event (may be empty when `full` is a bare snapshot). */
  c: z.array(EditChangeSchema),
  /** Full model text after this event (periodic snapshot / first event). */
  full: z.string().optional(),
});
export type EditEvent = z.infer<typeof EditEventSchema>;

export const EditLogSchema = z.object({
  version: z.literal(1),
  /** LeetCode problem slug the log belongs to. */
  slug: z.string(),
  /** Monaco language id (e.g. "python", "cpp"). */
  language: z.string().optional(),
  events: z.array(EditEventSchema),
});
export type EditLog = z.infer<typeof EditLogSchema>;

/** Apply one event's changes to `text`. */
export function applyEvent(text: string, event: EditEvent): string {
  if (event.full !== undefined) return event.full;
  // Sort by descending offset so earlier edits do not shift later offsets.
  const changes = [...event.c].sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [offset, length, insert] of changes) {
    if (offset > out.length) {
      throw new RangeError(`edit offset ${offset} beyond text length ${out.length}`);
    }
    out = out.slice(0, offset) + insert + out.slice(offset + length);
  }
  return out;
}

/**
 * Reconstruct the editor text at time `t` (inclusive) from an event log.
 * Uses the latest snapshot at or before `t` as the base to avoid replaying
 * from the start of the session. Events must be sorted by `t` ascending.
 */
export function codeAt(events: readonly EditEvent[], t: number, initial = ""): string {
  let base = initial;
  let startIdx = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    if (e.t <= t && e.full !== undefined) {
      base = e.full;
      startIdx = i + 1;
      break;
    }
  }
  let text = base;
  for (let i = startIdx; i < events.length; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.t > t) break;
    text = applyEvent(text, e);
  }
  return text;
}

/** Final text of the log (convenience). */
export function finalCode(events: readonly EditEvent[], initial = ""): string {
  const last = events[events.length - 1];
  return last ? codeAt(events, last.t, initial) : initial;
}

/** Decide whether the next event should carry a full snapshot. */
export function shouldSnapshot(
  eventsSinceSnapshot: number,
  msSinceSnapshot: number,
  isFirst: boolean,
): boolean {
  if (isFirst) return true;
  return eventsSinceSnapshot >= SNAPSHOT_EVERY_EVENTS || msSinceSnapshot >= SNAPSHOT_EVERY_MS;
}

/**
 * Checkpoints for AI review: the code state at the end of every typing pause
 * longer than `pauseMs`, plus the final state. Returns [{t, code}] in time order,
 * de-duplicated on identical code.
 */
export function checkpoints(
  events: readonly EditEvent[],
  pauseMs = 20_000,
  initial = "",
): { t: number; code: string }[] {
  const out: { t: number; code: string }[] = [];
  let text = initial;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e) continue;
    text = applyEvent(text, e);
    const next = events[i + 1];
    const isPauseBoundary = !next || next.t - e.t >= pauseMs;
    if (isPauseBoundary) {
      const prev = out[out.length - 1];
      if (!prev || prev.code !== text) out.push({ t: e.t, code: text });
    }
  }
  return out;
}

/** Minimal line-based diff summary used to keep AI prompts compact. */
export function lineDiff(before: string, after: string): { added: string[]; removed: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  const aSet = new Map<string, number>();
  for (const line of a) aSet.set(line, (aSet.get(line) ?? 0) + 1);
  const bSet = new Map<string, number>();
  for (const line of b) bSet.set(line, (bSet.get(line) ?? 0) + 1);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [line, n] of bSet) {
    const m = aSet.get(line) ?? 0;
    for (let i = 0; i < n - m; i++) added.push(line);
  }
  for (const [line, n] of aSet) {
    const m = bSet.get(line) ?? 0;
    for (let i = 0; i < n - m; i++) removed.push(line);
  }
  return { added, removed };
}
