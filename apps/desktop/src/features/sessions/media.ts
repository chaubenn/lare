/**
 * Media time model for the session review page.
 *
 * Everything on the page is positioned in *media seconds*: seconds since the recording started
 * (`sessions.recording_started_at`, falling back to `started_at` when the session was never
 * recorded). Transcript segments and AI moments are already relative to media start; edit events
 * and submissions carry wall-clock epochs and are shifted by `t0`.
 */
import { formatDuration, type TranscriptSegment, TranscriptSegmentSchema } from "@lare/shared";
import type { Json, Session } from "@lare/supabase-types";
import { z } from "zod";

/** Epoch ms of media time zero for a session. */
export function mediaEpoch(session: Pick<Session, "recording_started_at" | "started_at">): number {
  const t0 = Date.parse(session.recording_started_at ?? session.started_at);
  return Number.isFinite(t0) ? t0 : Date.parse(session.started_at) || 0;
}

/** Epoch ms -> media seconds. */
export function epochToMedia(epochMs: number, t0: number): number {
  return (epochMs - t0) / 1000;
}

/** ISO timestamp -> media seconds (NaN-safe: unparsable dates map to 0). */
export function isoToMedia(iso: string, t0: number): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? epochToMedia(ms, t0) : 0;
}

/** Media seconds -> epoch ms (for `codeAt`). */
export function mediaToEpoch(seconds: number, t0: number): number {
  return t0 + seconds * 1000;
}

export function clampTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(Math.max(0, seconds), Math.max(0, duration));
}

/** "m:ss" / "h:mm:ss" label for a media time in seconds. */
export function formatMediaTime(seconds: number): string {
  return formatDuration(Math.max(0, seconds) * 1000);
}

/**
 * `transcripts.segments` is jsonb; keep every element that matches the contract and drop the
 * rest so one odd segment does not hide the whole transcript.
 */
export function parseTranscriptSegments(value: Json | null | undefined): TranscriptSegment[] {
  const list = z.array(z.unknown()).safeParse(value);
  if (!list.success) return [];
  const out: TranscriptSegment[] = [];
  for (const item of list.data) {
    const seg = TranscriptSegmentSchema.safeParse(item);
    if (seg.success && seg.data.text.trim().length > 0) out.push(seg.data);
  }
  return out.sort((a, b) => a.s - b.s);
}

/**
 * Index of the segment to highlight at `seconds`: the one containing the time, otherwise the
 * most recent one that already started (so the highlight survives silences). -1 before speech.
 */
export function activeSegmentIndex(
  segments: readonly TranscriptSegment[],
  seconds: number,
): number {
  const ms = seconds * 1000;
  let candidate = -1;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || seg.s > ms) break;
    candidate = i;
    if (ms < seg.e) return i;
  }
  return candidate;
}

/** Plain-text transcript, one `[m:ss] text` line per segment. */
export function transcriptToText(segments: readonly TranscriptSegment[]): string {
  return segments.map((seg) => `[${formatDuration(seg.s)}] ${seg.text.trim()}`).join("\n");
}

/** Stable, content-derived React keys; duplicates get a numeric suffix instead of array indices. */
export function withKeys<T>(
  items: readonly T[],
  base: (item: T) => string,
): Array<{ key: string; item: T }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const b = base(item);
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return { key: n === 0 ? b : `${b}#${n}`, item };
  });
}
