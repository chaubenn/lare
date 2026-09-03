import { z } from "zod";

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------
const PROBLEM_PATH = /^\/problems\/([a-z0-9-]+)(?:\/|$)/i;

/** "https://leetcode.com/problems/two-sum/description/" -> "two-sum" */
export function problemSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)leetcode\.(com|cn)$/.test(u.hostname) && u.hostname !== "localhost") return null;
    const m = PROBLEM_PATH.exec(u.pathname);
    return m?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function problemUrl(slug: string): string {
  return `https://leetcode.com/problems/${slug}/`;
}

/** Submission id from "/submissions/detail/123456/check/" or "/problems/x/submissions/123456/" */
export function submissionIdFromUrl(url: string): number | null {
  const m = /\/submissions\/(?:detail\/)?(\d+)\/?/.exec(url);
  return m?.[1] ? Number(m[1]) : null;
}

export function isSubmitUrl(url: string): boolean {
  return /\/problems\/[a-z0-9-]+\/submit\/?(\?|$)/i.test(url);
}

export function isCheckUrl(url: string): boolean {
  return /\/submissions\/detail\/\d+\/check\/?(\?|$)/i.test(url);
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------
export const QUESTION_QUERY = `
query lareQuestion($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    content
    difficulty
    topicTags { name slug }
  }
}`;

export const SUBMISSION_DETAILS_QUERY = `
query lareSubmissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    runtime
    runtimeDisplay
    runtimePercentile
    runtimeDistribution
    memory
    memoryDisplay
    memoryPercentile
    memoryDistribution
    code
    timestamp
    statusCode
    lang { name verboseName }
    question { questionId titleSlug }
    runtimeError
    compileError
    lastTestcase
  }
}`;

export const DifficultySchema = z.enum(["Easy", "Medium", "Hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const QuestionSchema = z.object({
  questionId: z.string(),
  questionFrontendId: z.string(),
  title: z.string(),
  titleSlug: z.string(),
  content: z.string().nullable(),
  difficulty: DifficultySchema,
  topicTags: z.array(z.object({ name: z.string(), slug: z.string() })).default([]),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionResponseSchema = z.object({
  data: z.object({ question: QuestionSchema.nullable() }),
});

export const SubmissionDetailsSchema = z.object({
  runtime: z.number().nullable(),
  runtimeDisplay: z.string().nullable(),
  runtimePercentile: z.number().nullable(),
  runtimeDistribution: z.string().nullable(),
  memory: z.number().nullable(),
  memoryDisplay: z.string().nullable(),
  memoryPercentile: z.number().nullable(),
  memoryDistribution: z.string().nullable(),
  code: z.string().nullable(),
  timestamp: z.number().nullable(),
  statusCode: z.number().nullable(),
  lang: z.object({ name: z.string(), verboseName: z.string().nullable() }).nullable(),
  question: z.object({ questionId: z.string(), titleSlug: z.string().nullable() }).nullable(),
  runtimeError: z.string().nullable().optional(),
  compileError: z.string().nullable().optional(),
  lastTestcase: z.string().nullable().optional(),
});
export type SubmissionDetails = z.infer<typeof SubmissionDetailsSchema>;

export const SubmissionDetailsResponseSchema = z.object({
  data: z.object({ submissionDetails: SubmissionDetailsSchema.nullable() }),
});

// ---------------------------------------------------------------------------
// Judge "check" endpoint: /submissions/detail/{id}/check/
// ---------------------------------------------------------------------------
export const LEETCODE_STATUS: Record<number, string> = {
  10: "Accepted",
  11: "Wrong Answer",
  12: "Memory Limit Exceeded",
  13: "Output Limit Exceeded",
  14: "Time Limit Exceeded",
  15: "Runtime Error",
  16: "Internal Error",
  20: "Compile Error",
  21: "Unknown Error",
  30: "Timeout",
};

export const CheckResponseSchema = z.looseObject({
  state: z.string(),
  status_code: z.number().optional(),
  status_msg: z.string().optional(),
  submission_id: z.union([z.string(), z.number()]).optional(),
  lang: z.string().optional(),
  pretty_lang: z.string().optional(),
  run_success: z.boolean().optional(),
  status_runtime: z.string().optional(),
  display_runtime: z.string().optional(),
  status_memory: z.string().optional(),
  memory: z.number().optional(),
  runtime_percentile: z.number().nullable().optional(),
  memory_percentile: z.number().nullable().optional(),
  total_correct: z.number().nullable().optional(),
  total_testcases: z.number().nullable().optional(),
  question_id: z.union([z.string(), z.number()]).optional(),
  finished: z.boolean().optional(),
  task_finish_time: z.number().optional(),
});
export type CheckResponse = z.infer<typeof CheckResponseSchema>;

export const SubmitResponseSchema = z.looseObject({
  submission_id: z.union([z.string(), z.number()]),
});

export function isFinalCheck(c: CheckResponse): boolean {
  return c.state === "SUCCESS" || c.state === "FAILURE";
}

export function isAccepted(c: Pick<CheckResponse, "status_code" | "status_msg">): boolean {
  return c.status_code === 10 || c.status_msg === "Accepted";
}

/** "1219 ms" -> 1219 ; "1219" -> 1219 ; "N/A" -> null */
export function parseRuntimeMs(display: string | null | undefined): number | null {
  if (!display) return null;
  const m = /([\d.]+)/.exec(display);
  return m?.[1] ? Math.round(Number(m[1])) : null;
}

/** "22 MB" -> 22 ; 22000000 (bytes) -> 22 */
export function parseMemoryMb(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Math.round((value / 1_000_000) * 100) / 100;
  const m = /([\d.]+)\s*(KB|MB|GB)?/i.exec(value);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "MB").toUpperCase();
  if (unit === "KB") return n / 1024;
  if (unit === "GB") return n * 1024;
  return n;
}

// ---------------------------------------------------------------------------
// Runtime / memory distribution ("time complexity graph")
// ---------------------------------------------------------------------------
export const DistributionSchema = z.object({
  lang: z.string(),
  /** [{ value: ms or MB, pct: percentage of submissions in this bin }] sorted by value. */
  bins: z.array(z.object({ value: z.number(), pct: z.number() })),
});
export type Distribution = z.infer<typeof DistributionSchema>;

/**
 * LeetCode returns distributions as a JSON string:
 * {"lang":"python3","distribution":[["140","0.1"],["150","0.3"], ...]}
 * Values may be strings or numbers. Returns null when absent/unparseable.
 */
export function parseDistribution(raw: string | null | undefined | object): Distribution | null {
  if (!raw) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = z
    .object({
      lang: z.string().default("unknown"),
      distribution: z.array(
        z.tuple([z.union([z.string(), z.number()]), z.union([z.string(), z.number()])]),
      ),
    })
    .safeParse(obj);
  if (!parsed.success) return null;
  const bins = parsed.data.distribution
    .map(([v, p]) => ({ value: Number(v), pct: Number(p) }))
    .filter((b) => Number.isFinite(b.value) && Number.isFinite(b.pct))
    .sort((a, b) => a.value - b.value);
  if (bins.length === 0) return null;
  return { lang: parsed.data.lang, bins };
}

/** Index of the bin that contains the user's value (nearest bin at or below). */
export function userBinIndex(dist: Distribution, userValue: number): number {
  let idx = -1;
  for (let i = 0; i < dist.bins.length; i++) {
    const bin = dist.bins[i];
    if (bin && bin.value <= userValue) idx = i;
    else break;
  }
  return idx === -1 ? 0 : idx;
}

/** Strip LeetCode's HTML to a plain-text excerpt (for cards / OG descriptions). */
export function excerptFromHtml(html: string | null | undefined, maxLen = 200): string {
  if (!html) return "";
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
}

/** Monaco language id -> display name. */
export const LANGUAGE_LABELS: Record<string, string> = {
  python: "Python",
  python3: "Python3",
  cpp: "C++",
  c: "C",
  java: "Java",
  javascript: "JavaScript",
  typescript: "TypeScript",
  golang: "Go",
  go: "Go",
  rust: "Rust",
  kotlin: "Kotlin",
  swift: "Swift",
  csharp: "C#",
  ruby: "Ruby",
  scala: "Scala",
  php: "PHP",
  dart: "Dart",
  racket: "Racket",
  erlang: "Erlang",
  elixir: "Elixir",
  mysql: "MySQL",
  postgresql: "PostgreSQL",
};
