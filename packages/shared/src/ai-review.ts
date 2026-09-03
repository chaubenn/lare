/**
 * Output contract for the ai-review Edge Function (OpenAI structured outputs)
 * and the review UI. Timestamps are milliseconds relative to recording start.
 */
import { z } from "zod";

export const ScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  rationale: z.string(),
});

export const MomentSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  kind: z.enum(["good", "issue", "suggestion"]),
  source: z.enum(["transcript", "code", "submission"]),
  /** Short verbatim quote from the transcript or code that anchors the moment. */
  quote: z.string(),
  comment: z.string(),
});
export type Moment = z.infer<typeof MomentSchema>;

export const CodeIterationSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  /** e.g. "brute force", "hash map optimisation", "edge-case fix" */
  label: z.string(),
  assessment: z.string(),
  /** Big-O the model believes this iteration has, e.g. "O(n^2) time, O(1) space". */
  complexity: z.string().nullable(),
});
export type CodeIteration = z.infer<typeof CodeIterationSchema>;

export const AiReviewSchema = z.object({
  overall: z.number().int().min(0).max(100),
  scores: z.object({
    communication: ScoreSchema,
    problem_solving: ScoreSchema,
    code_quality: ScoreSchema,
    speed: ScoreSchema,
    correctness: ScoreSchema,
  }),
  summary: z.string(),
  moments: z.array(MomentSchema),
  code_iterations: z.array(CodeIterationSchema),
  next_steps: z.array(z.string()),
});
export type AiReview = z.infer<typeof AiReviewSchema>;

export const AI_REVIEW_JSON_SCHEMA_NAME = "lare_interview_review";

/** JSON schema for OpenAI `text.format = { type: "json_schema", strict: true, ... }`. */
export function aiReviewJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AiReviewSchema, { target: "draft-2020-12" }) as Record<string, unknown>;
}

/** Transcript segment shape stored in transcripts.segments. */
export const TranscriptSegmentSchema = z.object({
  s: z.number().int().nonnegative(), // start ms
  e: z.number().int().nonnegative(), // end ms
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

/** WebVTT for Bunny captions. */
export function toWebVtt(segments: readonly TranscriptSegment[]): string {
  const ts = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const f = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(3, "0")}`;
  };
  const cues = segments.map(
    (seg, i) => `${i + 1}\n${ts(seg.s)} --> ${ts(Math.max(seg.e, seg.s + 1))}\n${seg.text.trim()}`,
  );
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
