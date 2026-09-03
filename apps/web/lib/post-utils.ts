/** Pure helpers shared by server and client components (no data access here). */

export interface BestRun {
  runtimeLabel: string;
  beats: number | null;
}

/** Fastest accepted submission, e.g. "1219 ms" + percentile for "beats 17.99%". */
export function bestAcceptedRun(
  submissions: ReadonlyArray<{
    accepted: boolean;
    runtime_ms: number | null;
    runtime_display: string | null;
    runtime_percentile: number | null;
  }>,
): BestRun | null {
  const accepted = submissions.filter((s) => s.accepted);
  if (accepted.length === 0) return null;
  const best = accepted.reduce((a, b) => {
    const ra = a.runtime_ms ?? Number.POSITIVE_INFINITY;
    const rb = b.runtime_ms ?? Number.POSITIVE_INFINITY;
    return rb < ra ? b : a;
  });
  const runtimeLabel =
    best.runtime_display ?? (best.runtime_ms !== null ? `${best.runtime_ms} ms` : "Accepted");
  return { runtimeLabel, beats: best.runtime_percentile };
}

export function sessionKindLabel(kind: "practice" | "interview" | null | undefined): string {
  return kind === "interview" ? "Mock interview" : "Practice session";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
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
