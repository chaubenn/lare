import type { AiReview } from "@lare/shared";
import type { TimeRange } from "@/lib/recorder";

/** Merge overlapping/adjacent ranges and clamp to the duration. */
export function mergeRanges(ranges: TimeRange[], duration: number): TimeRange[] {
  const sorted = ranges
    .map((r) => ({
      start: Math.max(0, Math.min(r.start, r.end)),
      end: Math.min(duration, Math.max(r.start, r.end)),
    }))
    .filter((r) => r.end - r.start > 0.05)
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 0.25) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Highlight ranges around AI moments (10 s before, 20 s after), merged. */
export function highlightRanges(review: AiReview, duration: number): TimeRange[] {
  const ranges = review.moments
    .filter((m) => m.kind === "good" || m.kind === "issue")
    .map((m) => ({ start: m.t_ms / 1000 - 10, end: m.t_ms / 1000 + 20 }));
  return mergeRanges(ranges, duration);
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = Number.parseInt(m[1] ?? "000000", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
