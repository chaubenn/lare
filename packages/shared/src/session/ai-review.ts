/**
 * Output contract for the ai-review Edge Function (OpenAI structured outputs)
 * and the review UI. Timestamps are milliseconds relative to recording start.
 */
import { z } from "zod";

/**
 * What the AI review grades against when the user has not written their own criteria. The Edge
 * Function cannot import this package, so supabase/functions/_shared/reviewCriteria.ts holds a
 * copy; edgeMirrors.test.ts fails when the two differ.
 */
export const DEFAULT_REVIEW_CRITERIA = [
  "Grade fairly and specifically.",
  "Scores are 0-100.",
  "If there is no transcript, score communication 0 and say why in the rationale.",
  "Speed considers total active time versus difficulty.",
  "Correctness reflects submissions (accepted, attempts, testcases).",
  "Keep the summary to 3-5 sentences.",
].join("\n");

/** Longest custom criteria the database accepts. */
export const REVIEW_CRITERIA_MAX_LENGTH = 2000;

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

export type AiScoreKey = keyof AiReview["scores"];

/** Display names for the five skill scores, in the order every surface renders them. */
export const AI_SCORE_LABELS: Record<AiScoreKey, string> = {
  communication: "Communication",
  problem_solving: "Problem solving",
  code_quality: "Code quality",
  speed: "Speed",
  correctness: "Correctness",
};

/** Transcript segment shape stored in transcripts.segments. */
export const TranscriptSegmentSchema = z.object({
  s: z.number().int().nonnegative(), // start ms
  e: z.number().int().nonnegative(), // end ms
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
