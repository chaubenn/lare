/** Parsers for the jsonb columns we read (all validated with zod; never trust the shape). */
import { AiReviewSchema, type Distribution, DistributionSchema } from "@lare/shared";
import type { Json, Submission } from "@lare/supabase-types";
import { z } from "zod";

export function parseDistributionJson(value: Json | null | undefined): Distribution | null {
  if (value === null || value === undefined) return null;
  const r = DistributionSchema.safeParse(value);
  return r.success ? r.data : null;
}

const TopicTagsSchema = z.array(z.object({ name: z.string(), slug: z.string() }));
export type TopicTag = z.infer<typeof TopicTagsSchema>[number];

export function parseTopicTags(value: Json | null | undefined): TopicTag[] {
  const r = TopicTagsSchema.safeParse(value);
  return r.success ? r.data : [];
}

export const ProfileStatsSchema = z.object({
  followers: z.number().default(0),
  following: z.number().default(0),
  visible: z.boolean().default(false),
  posts: z.number().optional(),
  problems_solved: z.number().optional(),
  total_active_ms: z.number().optional(),
});
export type ProfileStats = z.infer<typeof ProfileStatsSchema>;

export function parseProfileStats(value: Json | null | undefined): ProfileStats | null {
  const r = ProfileStatsSchema.safeParse(value);
  return r.success ? r.data : null;
}

/** `follow_list` RPC: the people behind a profile's follower / following count. */
export const FollowListSchema = z.object({
  /** False for a private account the viewer does not follow — the count is public, the names are not. */
  visible: z.boolean().default(false),
  people: z
    .array(
      z.object({
        id: z.string(),
        handle: z.string().nullable().default(null),
        display_name: z.string().nullable().default(null),
        avatar_url: z.string().nullable().default(null),
        is_private: z.boolean().default(false),
      }),
    )
    .default([]),
});
export type FollowList = z.infer<typeof FollowListSchema>;

export function parseFollowList(value: Json | null | undefined): FollowList {
  const r = FollowListSchema.safeParse(value);
  return r.success ? r.data : { visible: false, people: [] };
}

/** interview_reviews row -> AiReview (columns are jsonb; the schema validates the shape). */
export function parseAiReview(row: {
  overall: number | null;
  scores: Json;
  summary: string | null;
  moments: Json;
  code_iterations: Json;
  next_steps: Json;
}) {
  const r = AiReviewSchema.safeParse({
    overall: row.overall ?? 0,
    scores: row.scores,
    summary: row.summary ?? "",
    moments: row.moments,
    code_iterations: row.code_iterations,
    next_steps: row.next_steps,
  });
  return r.success ? r.data : null;
}

/** Accepted submissions first (fastest first), then the rest newest-first. */
export function sortSubmissions<
  T extends Pick<Submission, "accepted" | "runtime_ms" | "submitted_at">,
>(subs: readonly T[]): T[] {
  return [...subs].sort((a, b) => {
    if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
    if (a.accepted && b.accepted) {
      const ar = a.runtime_ms ?? Number.POSITIVE_INFINITY;
      const br = b.runtime_ms ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
    }
    return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
  });
}

/** Best (fastest) accepted submission, if any. */
export function bestAccepted<
  T extends Pick<Submission, "accepted" | "runtime_ms" | "submitted_at">,
>(subs: readonly T[]): T | null {
  return sortSubmissions(subs).find((s) => s.accepted) ?? null;
}
