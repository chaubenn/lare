/**
 * Bundle individual recorded sessions into sittings: everything worked within `gapMs` of the
 * previous activity is one sitting. A burst of five Two Sum attempts reads as one block of work,
 * not five rows. Pure (no app imports) so it is unit-tested directly.
 */

export const SITTING_GAP_MS = 2 * 60 * 60 * 1000;

export interface GroupableSession {
  id: string;
  kind: "practice" | "interview";
  started_at: string;
  ended_at: string | null;
  active_ms: number;
  is_practice_inbox?: boolean;
  session_problems: { slug: string; title: string; difficulty?: string | null }[];
}

export interface SittingProblem {
  slug: string;
  title: string;
  difficulty: string | null;
  /** How many sessions in the sitting touched it. */
  attempts: number;
}

export interface Sitting<S extends GroupableSession> {
  /** Stable key: the id of the sitting's earliest session. */
  key: string;
  /** Newest first, like the page. */
  sessions: S[];
  start: number;
  end: number;
  label: "Practice" | "Mock interview" | "Practice & mock interview";
  interviews: number;
  practices: number;
  activeMs: number;
  /** Unique by slug, most attempted first. */
  problems: SittingProblem[];
}

function endOf(s: GroupableSession): number {
  const start = Date.parse(s.started_at);
  const ended = s.ended_at ? Date.parse(s.ended_at) : Number.NaN;
  return Number.isNaN(ended) ? start + Math.max(0, s.active_ms) : Math.max(start, ended);
}

export function groupSittings<S extends GroupableSession>(
  sessions: readonly S[],
  gapMs = SITTING_GAP_MS,
): Sitting<S>[] {
  // The practice inbox is a long-lived container for unposted problems, not a sitting.
  const ordered = sessions
    .filter((s) => !s.is_practice_inbox && !Number.isNaN(Date.parse(s.started_at)))
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));

  const groups: S[][] = [];
  let sittingStart = Number.POSITIVE_INFINITY;
  for (const s of ordered) {
    const current = groups.at(-1);
    // Walking newest to oldest: a session joins if it ended within the gap of the sitting's start.
    if (current && sittingStart - endOf(s) <= gapMs) current.push(s);
    else {
      groups.push([s]);
      sittingStart = Number.POSITIVE_INFINITY;
    }
    sittingStart = Math.min(sittingStart, Date.parse(s.started_at));
  }

  return groups.map((group) => {
    const interviews = group.filter((s) => s.kind === "interview").length;
    const practices = group.length - interviews;
    const bySlug = new Map<string, SittingProblem>();
    for (const s of group)
      for (const p of s.session_problems) {
        const seen = bySlug.get(p.slug);
        if (seen) seen.attempts += 1;
        else
          bySlug.set(p.slug, {
            slug: p.slug,
            title: p.title,
            difficulty: p.difficulty ?? null,
            attempts: 1,
          });
      }
    const oldest = group.at(-1) as S;
    return {
      key: oldest.id,
      sessions: group,
      start: Math.min(...group.map((s) => Date.parse(s.started_at))),
      end: Math.max(...group.map(endOf)),
      label:
        interviews && practices
          ? "Practice & mock interview"
          : interviews
            ? "Mock interview"
            : "Practice",
      interviews,
      practices,
      activeMs: group.reduce((sum, s) => sum + Math.max(0, s.active_ms), 0),
      problems: [...bySlug.values()].sort((a, b) => b.attempts - a.attempts),
    };
  });
}
