import {
  type AiReview,
  AiReviewSchema,
  CodeIterationSchema,
  type Distribution,
  DistributionSchema,
  MomentSchema,
  parseDistribution,
  ScoreSchema,
  type TranscriptSegment,
  TranscriptSegmentSchema,
} from "@lare/shared";
import type { InterviewReview, Json } from "@lare/supabase-types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// session_problems.topic_tags
// ---------------------------------------------------------------------------
const TopicTagsSchema = z.array(z.object({ name: z.string(), slug: z.string() }));
export type TopicTag = z.infer<typeof TopicTagsSchema>[number];

export function parseTopicTags(raw: Json | null | undefined): TopicTag[] {
  const parsed = TopicTagsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

// ---------------------------------------------------------------------------
// submissions.runtime_distribution / memory_distribution
// ---------------------------------------------------------------------------
/** Stored rows are already `{lang, bins}`; fall back to LeetCode's raw shape just in case. */
export function toDistribution(raw: Json | null | undefined): Distribution | null {
  if (raw === null || raw === undefined) return null;
  const direct = DistributionSchema.safeParse(raw);
  if (direct.success) return direct.data.bins.length > 0 ? direct.data : null;
  if (typeof raw === "string" || typeof raw === "object") return parseDistribution(raw);
  return null;
}

// ---------------------------------------------------------------------------
// transcripts.segments
// ---------------------------------------------------------------------------
export function parseTranscriptSegments(raw: Json | null | undefined): TranscriptSegment[] {
  const parsed = z.array(TranscriptSegmentSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

// ---------------------------------------------------------------------------
// interview_reviews -> AiReview (lenient: render whatever validates)
// ---------------------------------------------------------------------------
const LooseReviewSchema = z.object({
  overall: z.number().nullable().catch(null),
  scores: z.record(z.string(), ScoreSchema).catch({}),
  summary: z.string().nullable().catch(null),
  moments: z.array(MomentSchema).catch([]),
  code_iterations: z.array(CodeIterationSchema).catch([]),
  next_steps: z.array(z.string()).catch([]),
});

export type ReviewView = {
  overall: number | null;
  scores: Array<{ key: string; label: string; score: number; rationale: string }>;
  summary: string | null;
  moments: AiReview["moments"];
  code_iterations: AiReview["code_iterations"];
  next_steps: string[];
  created_at: string;
  model: string;
};

const SCORE_LABELS: Record<string, string> = {
  communication: "Communication",
  problem_solving: "Problem solving",
  code_quality: "Code quality",
  speed: "Speed",
  correctness: "Correctness",
};
const SCORE_ORDER = ["communication", "problem_solving", "code_quality", "speed", "correctness"];

export function toReviewView(row: InterviewReview): ReviewView {
  const candidate = {
    overall: row.overall,
    scores: row.scores,
    summary: row.summary ?? "",
    moments: row.moments,
    code_iterations: row.code_iterations,
    next_steps: row.next_steps,
  };
  const strict = AiReviewSchema.safeParse(candidate);
  const data = strict.success
    ? { ...strict.data, summary: strict.data.summary || null }
    : LooseReviewSchema.parse(candidate);

  const scores = Object.entries(data.scores)
    .sort(([a], [b]) => {
      const ia = SCORE_ORDER.indexOf(a);
      const ib = SCORE_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([key, value]) => ({
      key,
      label: SCORE_LABELS[key] ?? key.replace(/_/g, " "),
      score: value.score,
      rationale: value.rationale,
    }));

  return {
    overall: data.overall,
    scores,
    summary: data.summary,
    moments: [...data.moments].sort((a, b) => a.t_ms - b.t_ms),
    code_iterations: [...data.code_iterations].sort((a, b) => a.t_ms - b.t_ms),
    next_steps: data.next_steps,
    created_at: row.created_at,
    model: row.model,
  };
}

// ---------------------------------------------------------------------------
// profile_stats RPC
// ---------------------------------------------------------------------------
export const ProfileStatsSchema = z.object({
  followers: z.number(),
  following: z.number(),
  visible: z.boolean(),
  posts: z.number().optional(),
  problems_solved: z.number().optional(),
  total_active_ms: z.number().optional(),
});
export type ProfileStats = z.infer<typeof ProfileStatsSchema>;

export function parseProfileStats(raw: Json | null | undefined): ProfileStats | null {
  const parsed = ProfileStatsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export const HandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HANDLE_RE, "Use 3–20 lowercase letters, numbers or underscores.");
