/**
 * Same-origin LeetCode GraphQL calls from the isolated content script. The
 * browser attaches the user's own leetcode.com cookies; nothing is stored.
 */
import {
  type Distribution,
  LEETCODE_STATUS,
  QUESTION_QUERY,
  type Question,
  QuestionResponseSchema,
  SUBMISSION_DETAILS_QUERY,
  type SubmissionDetails,
  SubmissionDetailsResponseSchema,
  parseDistribution,
} from "@lare/shared";

function csrfToken(): string | null {
  const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie);
  return m?.[1] ?? null;
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const csrf = csrfToken();
  if (csrf) headers["x-csrftoken"] = csrf;
  const res = await fetch(`${window.location.origin}/graphql`, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`LeetCode GraphQL ${res.status}`);
  return (await res.json()) as T;
}

const questionCache = new Map<string, Promise<Question | null>>();

export function fetchQuestion(slug: string): Promise<Question | null> {
  let p = questionCache.get(slug);
  if (!p) {
    p = graphql(QUESTION_QUERY, { titleSlug: slug })
      .then((json) => {
        const parsed = QuestionResponseSchema.safeParse(json);
        return parsed.success ? parsed.data.data.question : null;
      })
      .catch(() => null);
    questionCache.set(slug, p);
  }
  return p;
}

export interface SubmissionDetailsResult {
  details: SubmissionDetails | null;
  runtimeDistribution: Distribution | null;
  memoryDistribution: Distribution | null;
}

/**
 * Distributions are computed asynchronously by LeetCode after a submission is
 * judged, so we retry a few times before giving up on them (but still return
 * whatever we have).
 */
export async function fetchSubmissionDetails(
  submissionId: number,
  { retries = 6, delayMs = 1500 } = {},
): Promise<SubmissionDetailsResult> {
  let details: SubmissionDetails | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const json = await graphql(SUBMISSION_DETAILS_QUERY, { submissionId });
      const parsed = SubmissionDetailsResponseSchema.safeParse(json);
      if (parsed.success && parsed.data.data.submissionDetails) {
        details = parsed.data.data.submissionDetails;
        const accepted = details.statusCode === 10;
        if (!accepted || (details.runtimeDistribution && details.memoryDistribution)) break;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
  }
  return {
    details,
    runtimeDistribution: parseDistribution(details?.runtimeDistribution),
    memoryDistribution: parseDistribution(details?.memoryDistribution),
  };
}

export function statusLabel(code: number | null | undefined, fallback: string | null): string | null {
  if (code !== null && code !== undefined && LEETCODE_STATUS[code]) return LEETCODE_STATUS[code] ?? fallback;
  return fallback;
}
