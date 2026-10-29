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

/**
 * Submission id from "/submissions/detail/123456/check/",
 * "/submissions/detail/123456/v2/check/" or "/problems/x/submissions/123456/".
 */
export function submissionIdFromUrl(url: string): number | null {
  const m = /\/submissions\/(?:detail\/)?(\d+)\/?/.exec(url);
  return m?.[1] ? Number(m[1]) : null;
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url, "https://leetcode.com").pathname;
  } catch {
    return null;
  }
}

/** POST /problems/{slug}/submit/ (REST). Query strings are ignored. */
export function isSubmitUrl(url: string): boolean {
  const path = pathnameOf(url) ?? url;
  return /\/problems\/[^/]+\/submit\/?$/i.test(path);
}

/**
 * Judge result polls. LeetCode's current client polls
 * `/submissions/detail/{id}/v2/check/` for Submit (`submitResultV2`) and
 * `/submissions/detail/{id}/check/` for Run (`runcodeResult`); older clients used the
 * un-versioned path for both. Accept any `/vN/` segment so future bumps still match.
 */
export function isCheckUrl(url: string): boolean {
  const path = pathnameOf(url) ?? url;
  return /\/submissions\/(?:detail\/)?\d+\/(?:v\d+\/)?check\/?$/i.test(path);
}

export function isGraphqlUrl(url: string): boolean {
  const path = pathnameOf(url) ?? url;
  return /\/graphql\/?$/i.test(path);
}

/** True when a GraphQL POST body is LeetCode's "Run" (interpret), not Submit. */
function isInterpretGraphql(body: string): boolean {
  return /interpret_solution|interpretSolution/i.test(body);
}

/**
 * GraphQL bodies that are a real Submit (not "Run"/interpret). LeetCode's Next.js
 * client sometimes sends judge traffic through /graphql instead of the REST paths.
 * Operation name may be omitted; the mutation name in `query` is matched too.
 */
export function isSubmitGraphql(body: string): boolean {
  if (isInterpretGraphql(body)) return false;
  return (
    /submitCode|submitProblem|submitSolution|"operationName"\s*:\s*"submit/i.test(body) ||
    /mutation\s+submit\w*/i.test(body)
  );
}

/** GraphQL poll for a submission's judge result (as opposed to interpret/"Run"). */
export function isCheckGraphql(body: string): boolean {
  if (isInterpretGraphql(body)) return false;
  return (
    /checkSubmission|submissionCheck|submissionDetails|"operationName"\s*:\s*"check/i.test(body) ||
    /(?:mutation|query)\s+checkSubmission/i.test(body)
  );
}

/** True when a JSON value looks like LeetCode's `/check/` payload (possibly nested under `data`). */
export function looksLikeCheckPayload(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  if (checkShapeSignals(o)) return true;
  if (o.data && typeof o.data === "object") {
    return Object.values(o.data as Record<string, unknown>).some(looksLikeCheckPayload);
  }
  return false;
}

function checkShapeSignals(o: Record<string, unknown>): boolean {
  if (
    typeof o.state === "string" &&
    (o.status_code != null ||
      o.statusCode != null ||
      o.status_msg != null ||
      o.statusMsg != null ||
      o.total_testcases != null ||
      o.totalTestcases != null)
  ) {
    return true;
  }
  return (
    o.statusCode != null &&
    (o.statusDisplay != null ||
      o.statusMsg != null ||
      o.totalTestcases != null ||
      o.total_testcases != null ||
      o.finished === true)
  );
}

function looseNum(v: unknown): number | null | undefined {
  if (v == null || v === "") return v === "" ? null : undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return undefined;
}

/** Peel GraphQL `{ data: { op: { state, ... } } }` down to the check object. */
export function unwrapCheckPayload(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const o = body as Record<string, unknown>;
  if (
    typeof o.state === "string" ||
    typeof o.statusCode === "number" ||
    typeof o.status_code === "number"
  ) {
    return body;
  }
  if (o.data) return unwrapCheckPayload(o.data);
  for (const v of Object.values(o)) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (
      typeof r.state === "string" ||
      typeof r.statusCode === "number" ||
      typeof r.status_code === "number"
    ) {
      return v;
    }
  }
  return body;
}

/**
 * Normalize REST and GraphQL judge payloads into the snake_case shape our schema
 * expects (LeetCode's Next.js client often returns camelCase and string numbers).
 */
export function normalizeCheckPayload(body: unknown): unknown {
  const raw = unwrapCheckPayload(body);
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  const statusCode = looseNum(o.status_code ?? o.statusCode);
  const statusMsg =
    (typeof o.status_msg === "string" ? o.status_msg : null) ??
    (typeof o.statusMsg === "string" ? o.statusMsg : null) ??
    (typeof o.statusDisplay === "string" ? o.statusDisplay : null);
  let state = typeof o.state === "string" ? o.state : undefined;
  if (!state) {
    if (o.finished === true || statusCode != null) state = "SUCCESS";
    else if (statusMsg === "Accepted") state = "SUCCESS";
  }
  const lang =
    typeof o.lang === "string" ? o.lang : (o.lang as { name?: string } | undefined)?.name;
  return {
    ...o,
    state: state ?? "PENDING",
    status_code: statusCode ?? o.status_code,
    status_msg: statusMsg ?? o.status_msg,
    submission_id: o.submission_id ?? o.submissionId,
    status_runtime:
      o.status_runtime ??
      o.statusRuntime ??
      (typeof o.runtime === "string" ? o.runtime : undefined),
    display_runtime: o.display_runtime ?? o.displayRuntime,
    status_memory:
      o.status_memory ?? o.statusMemory ?? (typeof o.memory === "string" ? o.memory : undefined),
    pretty_lang: o.pretty_lang ?? o.prettyLang,
    run_success: o.run_success ?? o.runSuccess,
    total_correct: looseNum(o.total_correct ?? o.totalCorrect) ?? o.total_correct,
    total_testcases: looseNum(o.total_testcases ?? o.totalTestcases) ?? o.total_testcases,
    runtime_percentile: looseNum(o.runtime_percentile ?? o.runtimePercentile),
    memory_percentile: looseNum(o.memory_percentile ?? o.memoryPercentile),
    memory: typeof o.memory === "number" ? o.memory : looseNum(o.memory),
    lang,
    finished: o.finished ?? (o.isPending === false ? true : undefined),
  };
}

/** Pull a numeric submission id out of REST or GraphQL JSON. */
export function submissionIdFromPayload(body: unknown): number | null {
  if (body == null) return null;
  if (typeof body === "number" && Number.isFinite(body)) return body;
  if (typeof body === "string" && /^\d+$/.test(body)) return Number(body);
  if (typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const direct = o.submission_id ?? o.submissionId;
  if (direct != null) {
    const n = Number(direct);
    if (Number.isFinite(n)) return n;
  }
  const data = o.data;
  if (data && typeof data === "object") {
    for (const v of Object.values(data as Record<string, unknown>)) {
      const nested = submissionIdFromPayload(v);
      if (nested != null) return nested;
    }
  }
  return null;
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
  status_code: z.coerce.number().optional(),
  status_msg: z.string().optional(),
  submission_id: z.union([z.string(), z.number()]).optional(),
  lang: z.string().optional(),
  pretty_lang: z.string().optional(),
  run_success: z.boolean().optional(),
  status_runtime: z.string().optional(),
  display_runtime: z.string().optional(),
  status_memory: z.string().optional(),
  memory: z.coerce.number().optional(),
  runtime_percentile: z.coerce.number().nullable().optional(),
  memory_percentile: z.coerce.number().nullable().optional(),
  total_correct: z.coerce.number().nullable().optional(),
  total_testcases: z.coerce.number().nullable().optional(),
  question_id: z.union([z.string(), z.number()]).optional(),
  finished: z.boolean().optional(),
  task_finish_time: z.coerce.number().optional(),
  compare_result: z.string().optional(),
  // v2/check only: an AI-judge pass runs after the classic judge. LeetCode keeps
  // showing "Judging" until this settles, so we must too.
  ai_state: z.string().nullable().optional(),
  ai_judge_message: z.string().nullable().optional(),
  judger_status_code: z.coerce.number().nullable().optional(),
});
export type CheckResponse = z.infer<typeof CheckResponseSchema>;

export const SubmitResponseSchema = z.looseObject({
  submission_id: z.union([z.string(), z.number()]),
});

const SETTLED_STATES = new Set(["SUCCESS", "FAILURE", "REVOKED"]);

/**
 * True once the judge has stopped working on a submission. Mirrors LeetCode's own
 * polling predicate: `state` must be SUCCESS/FAILURE (PENDING, STARTED, PREPARING,
 * COMPILING and RUNNING_TESTS are all in-flight) and, when the v2 endpoint reports an
 * `ai_state`, that must be settled as well.
 */
export function isFinalCheck(c: CheckResponse): boolean {
  if (c.finished === true) return true;
  if (!SETTLED_STATES.has(c.state)) return false;
  if (c.ai_state != null && !SETTLED_STATES.has(c.ai_state)) return false;
  return true;
}

/** A settled check that carries no verdict (judge/server failure, revoked task). */
export function isJudgeFailure(c: CheckResponse): boolean {
  return (
    isFinalCheck(c) &&
    (c.state === "FAILURE" || c.state === "REVOKED" || c.ai_state === "FAILURE") &&
    c.status_code == null
  );
}

export function isAccepted(
  c: Pick<CheckResponse, "status_code" | "status_msg" | "compare_result">,
): boolean {
  // LeetCode downgrades AC to WA when any testcase in compare_result failed.
  if (c.compare_result?.includes("0")) return false;
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
