/** Pure helpers shared by server and client components (no data access here). */

export function sessionKindLabel(kind: "practice" | "interview" | null | undefined): string {
  return kind === "interview" ? "Mock interview" : "Practice session";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * An 11-character NanoID post slug — the canonical public id in `/p/<slug>`.
 * Matches `posts_slug_format` in the database. UUIDs are 36 chars, so the two
 * never overlap and a `/p/` segment can be classified by shape alone.
 */
const POST_SLUG_RE = /^[A-Za-z0-9_-]{11}$/;
export function isPostSlug(value: string): boolean {
  return POST_SLUG_RE.test(value);
}

/** Accepted first, then newest. */
export function sortSubmissions<T extends { accepted: boolean; submitted_at: string }>(
  submissions: readonly T[],
): T[] {
  return [...submissions].sort((a, b) => {
    if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
    return b.submitted_at.localeCompare(a.submitted_at);
  });
}
