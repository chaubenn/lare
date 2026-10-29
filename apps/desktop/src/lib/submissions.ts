/** Ordering for a problem's submissions, kept out of the component so it can be tested directly. */
import type { Submission } from "@lare/supabase-types";

type Attempt = Pick<Submission, "id" | "submitted_at">;
type Ranked = Attempt & Pick<Submission, "accepted" | "runtime_ms">;

/**
 * Submissions in the order they were attempted, so "#1" is the first one they sent.
 * This is deliberately not `sortSubmissions`, which ranks by result for display.
 */
export function submissionsInAttemptOrder<T extends Attempt>(subs: readonly T[]): T[] {
  return [...subs].sort((a, b) => {
    const at = new Date(a.submitted_at).getTime();
    const bt = new Date(b.submitted_at).getTime();
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
}

/** Which attempt to open on: the fastest accepted run, or the latest try if none passed. */
export function defaultSubmissionIndex<T extends Ranked>(ordered: readonly T[]): number {
  let best = -1;
  let bestRuntime = Number.POSITIVE_INFINITY;
  ordered.forEach((submission, i) => {
    if (!submission.accepted) return;
    const runtime = submission.runtime_ms ?? Number.POSITIVE_INFINITY;
    if (best === -1 || runtime < bestRuntime) {
      best = i;
      bestRuntime = runtime;
    }
  });
  if (best !== -1) return best;
  return ordered.length > 0 ? ordered.length - 1 : 0;
}
