import {
  difficultyMixLabel,
  formatBeats,
  formatDurationHuman,
  type ProblemOverview,
  type SessionOverview,
} from "@lare/shared";
import { cn } from "@lare/ui";

/**
 * The session card: the slide a post leads with, summarising what the author actually did.
 *
 * It used to be a PNG — rendered by a Next route with `next/og`, stored in a bucket by the
 * `og-snapshot` function, and served as the post's Open Graph image. An OG image's only job is the
 * link unfurl, and with the website reduced to a landing page there are no links to unfurl. What
 * was left was this: a slide, inside the app, drawn from data the deck already has.
 *
 * Being a component rather than a stored image means it cannot go stale — it always shows the
 * current title and problems, which is why there is no "regenerate" anywhere. The author line and
 * the AI score strip the PNG carried are gone: the post card above the deck already names the
 * author, and it already renders the AI review when the author includes it.
 */
export function SessionCardSlide({
  title,
  overview,
  kind,
  className,
}: {
  title: string;
  overview: SessionOverview;
  kind: "practice" | "interview" | null | undefined;
  className?: string;
}) {
  const mix = difficultyMixLabel(overview.difficulty);
  const beats = formatBeats(overview.bestPercentile);
  const shown = overview.problems.slice(0, 3);
  const remaining = overview.total - shown.length;
  const allSolved = overview.total > 0 && overview.solved === overview.total;

  return (
    <div
      className={cn(
        "flex size-full flex-col justify-between gap-3 bg-zinc-950 p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold tracking-tight text-[var(--text)]">Lare</span>
        <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          {kind === "interview" ? "Mock interview" : "Practice session"}
        </span>
      </div>

      <div className="min-w-0">
        <h3 className="line-clamp-2 text-xl font-bold leading-tight tracking-tight text-[var(--text)] sm:text-2xl">
          {title}
        </h3>
        {mix ? <p className="mt-1 text-xs text-[var(--text-tertiary)]">{mix}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Solved"
          value={`${overview.solved}/${overview.total}`}
          accent={allSolved ? "text-[var(--lare-status-run)]" : undefined}
        />
        {overview.activeMs > 0 ? (
          <Stat label="Active" value={formatDurationHuman(overview.activeMs)} />
        ) : null}
        <Stat label="Best runtime" value={beats ? `beats ${beats}` : "—"} />
        <Stat label="Submissions" value={String(overview.attempts)} />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {shown.map((problem) => (
          <ProblemRow key={problem.id} problem={problem} />
        ))}
        {remaining > 0 ? (
          <p className="border-t border-[var(--border)] pt-2 text-xs text-[var(--text-tertiary)]">
            +{remaining} more {remaining === 1 ? "problem" : "problems"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className={cn("mt-0.5 truncate text-base font-bold text-[var(--text)]", accent)}>
        {value}
      </div>
    </div>
  );
}

function ProblemRow({ problem }: { problem: ProblemOverview }) {
  const beats = problem.solved ? formatBeats(problem.runtimePercentile) : null;
  const right = problem.solved
    ? [problem.runtimeLabel, beats ? `beats ${beats}` : null].filter(Boolean).join(" · ")
    : problem.attempts > 0
      ? `${problem.attempts} ${problem.attempts === 1 ? "attempt" : "attempts"}`
      : "no submission";

  return (
    <div className="flex items-center gap-3 border-t border-[var(--border)] py-2">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          problem.difficulty === "Easy" && "bg-[var(--lare-diff-easy)]",
          problem.difficulty === "Medium" && "bg-[var(--lare-diff-medium)]",
          problem.difficulty === "Hard" && "bg-[var(--lare-diff-hard)]",
          !problem.difficulty && "bg-[var(--text-tertiary)]",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">
        {problem.title}
      </span>
      <span
        className={cn(
          "shrink-0 text-xs",
          problem.solved ? "text-[var(--lare-status-run)]" : "text-[var(--text-tertiary)]",
        )}
      >
        {right || "—"}
      </span>
    </div>
  );
}
