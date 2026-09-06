/**
 * Session overview: the numbers a post shows at a glance (feed card, OG image, post page).
 *
 * Everything here is derived from rows the extension already captured — no invented
 * metrics. "Beats" is LeetCode's runtime percentile for the best accepted submission;
 * we never guess a Big-O complexity because we do not have one.
 */
import { type Difficulty, LANGUAGE_LABELS } from "./leetcode";

export const DIFFICULTIES: readonly Difficulty[] = ["Easy", "Medium", "Hard"] as const;

export interface OverviewSubmission {
  accepted: boolean;
  runtime_ms: number | null;
  runtime_display?: string | null;
  runtime_percentile: number | null;
  memory_mb?: number | null;
  memory_display?: string | null;
  memory_percentile?: number | null;
  lang?: string | null;
  submitted_at: string;
}

export interface OverviewProblem {
  id: string;
  title: string;
  slug?: string;
  difficulty: Difficulty | string | null;
  active_ms?: number | null;
  opened_at: string;
  submissions?: OverviewSubmission[] | null;
}

export interface ProblemOverview {
  id: string;
  title: string;
  slug: string | null;
  difficulty: Difficulty | null;
  activeMs: number;
  solved: boolean;
  attempts: number;
  /** Best accepted run: "4 ms" (or null when nothing was accepted). */
  runtimeLabel: string | null;
  runtimePercentile: number | null;
  memoryLabel: string | null;
  memoryPercentile: number | null;
  /** Human language label of the best accepted submission, e.g. "Python3". */
  language: string | null;
}

export interface SessionOverview {
  problems: ProblemOverview[];
  total: number;
  solved: number;
  attempts: number;
  activeMs: number;
  /** Counts per difficulty; problems with no difficulty are left out. */
  difficulty: Record<Difficulty, number>;
  /** Highest and mean runtime percentile across solved problems. */
  bestPercentile: number | null;
  avgPercentile: number | null;
  languages: string[];
}

function asDifficulty(value: string | null | undefined): Difficulty | null {
  return value === "Easy" || value === "Medium" || value === "Hard" ? value : null;
}

function languageLabel(lang: string | null | undefined): string | null {
  if (!lang) return null;
  return LANGUAGE_LABELS[lang] ?? lang;
}

/** Fastest accepted submission, or null when the problem was never accepted. */
function bestAccepted(submissions: readonly OverviewSubmission[]): OverviewSubmission | null {
  const accepted = submissions.filter((s) => s.accepted);
  if (accepted.length === 0) return null;
  return accepted.reduce((a, b) => {
    const ra = a.runtime_ms ?? Number.POSITIVE_INFINITY;
    const rb = b.runtime_ms ?? Number.POSITIVE_INFINITY;
    return rb < ra ? b : a;
  });
}

export function problemOverview(problem: OverviewProblem): ProblemOverview {
  const submissions = problem.submissions ?? [];
  const best = bestAccepted(submissions);
  return {
    id: problem.id,
    title: problem.title,
    slug: problem.slug ?? null,
    difficulty: asDifficulty(typeof problem.difficulty === "string" ? problem.difficulty : null),
    activeMs: problem.active_ms ?? 0,
    solved: best !== null,
    attempts: submissions.length,
    runtimeLabel: best
      ? (best.runtime_display ?? (best.runtime_ms !== null ? `${best.runtime_ms} ms` : null))
      : null,
    runtimePercentile: best?.runtime_percentile ?? null,
    memoryLabel: best
      ? (best.memory_display ?? (best.memory_mb != null ? `${best.memory_mb} MB` : null))
      : null,
    memoryPercentile: best?.memory_percentile ?? null,
    language: languageLabel(best?.lang),
  };
}

/**
 * Overview for a whole session. Problems are ordered by `opened_at` so the story of the
 * session reads top to bottom, the same order every surface uses.
 */
export function buildSessionOverview(
  problems: readonly OverviewProblem[],
  sessionActiveMs?: number | null,
): SessionOverview {
  const ordered = [...problems].sort((a, b) => a.opened_at.localeCompare(b.opened_at));
  const list = ordered.map(problemOverview);
  const difficulty: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
  const languages: string[] = [];
  const percentiles: number[] = [];

  for (const p of list) {
    if (p.difficulty) difficulty[p.difficulty] += 1;
    if (p.language && !languages.includes(p.language)) languages.push(p.language);
    if (p.solved && p.runtimePercentile !== null && Number.isFinite(p.runtimePercentile)) {
      percentiles.push(p.runtimePercentile);
    }
  }

  const activeMs = sessionActiveMs ?? list.reduce((total, p) => total + p.activeMs, 0);

  return {
    problems: list,
    total: list.length,
    solved: list.filter((p) => p.solved).length,
    attempts: list.reduce((n, p) => n + p.attempts, 0),
    activeMs,
    difficulty,
    bestPercentile: percentiles.length > 0 ? Math.max(...percentiles) : null,
    avgPercentile:
      percentiles.length > 0 ? percentiles.reduce((a, b) => a + b, 0) / percentiles.length : null,
    languages,
  };
}

/** "1 Easy · 2 Medium" — difficulty mix with the empty buckets dropped. */
export function difficultyMixLabel(mix: Record<Difficulty, number>): string | null {
  const parts = DIFFICULTIES.filter((d) => mix[d] > 0).map((d) => `${mix[d]} ${d}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
