// Strict JSON schema for OpenAI structured outputs. Mirrors AiReviewSchema in
// packages/shared/src/ai-review.ts (all fields required, additionalProperties false).

const score = {
  type: "object",
  additionalProperties: false,
  required: ["score", "rationale"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    rationale: { type: "string" },
  },
} as const;

export const AI_REVIEW_SCHEMA_NAME = "lare_interview_review";

export const aiReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["overall", "scores", "summary", "moments", "code_iterations", "next_steps"],
  properties: {
    overall: { type: "integer", minimum: 0, maximum: 100 },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["communication", "problem_solving", "code_quality", "speed", "correctness"],
      properties: {
        communication: score,
        problem_solving: score,
        code_quality: score,
        speed: score,
        correctness: score,
      },
    },
    summary: { type: "string" },
    moments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["t_ms", "kind", "source", "quote", "comment"],
        properties: {
          t_ms: { type: "integer", minimum: 0 },
          kind: { type: "string", enum: ["good", "issue", "suggestion"] },
          source: { type: "string", enum: ["transcript", "code", "submission"] },
          quote: { type: "string" },
          comment: { type: "string" },
        },
      },
    },
    code_iterations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["t_ms", "label", "assessment", "complexity"],
        properties: {
          t_ms: { type: "integer", minimum: 0 },
          label: { type: "string" },
          assessment: { type: "string" },
          complexity: { type: ["string", "null"] },
        },
      },
    },
    next_steps: { type: "array", items: { type: "string" } },
  },
} as const;

export interface AiReview {
  overall: number;
  scores: Record<
    "communication" | "problem_solving" | "code_quality" | "speed" | "correctness",
    { score: number; rationale: string }
  >;
  summary: string;
  moments: { t_ms: number; kind: string; source: string; quote: string; comment: string }[];
  code_iterations: { t_ms: number; label: string; assessment: string; complexity: string | null }[];
  next_steps: string[];
}
