import { formatBeats, formatDurationHuman, type SessionOverview } from "@lare/shared";
import { cn } from "@lare/ui/cn";
import { DifficultyBadge } from "@lare/ui/DifficultyBadge";
import { Check, Clock, ListChecks, Minus } from "lucide-react";

/**
 * The second slide of a post: the same session the cover card summarises, one row per problem
 * with the metrics we actually captured (accepted or not, fastest run, percentile, memory, time).
 */
export function SessionOverviewSlide({
  overview,
  kind,
  className,
}: {
  overview: SessionOverview;
  kind: "practice" | "interview" | null | undefined;
  className?: string;
  active?: boolean;
}) {
  const beats = formatBeats(overview.bestPercentile);
  const avg = formatBeats(overview.avgPercentile);

  return (
    <div className={cn("flex size-full flex-col gap-3 bg-[var(--surface)] p-4 sm:p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          {kind === "interview" ? "Interview breakdown" : "Session breakdown"}
        </h3>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-3.5" />
            {overview.solved}/{overview.total} solved
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            {formatDurationHuman(overview.activeMs)}
          </span>
        </div>
      </div>

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {overview.problems.map((problem) => (
          <li
            key={problem.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-800/70 bg-zinc-900/50 px-3 py-2"
          >
            <span
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                problem.solved
                  ? "bg-[color-mix(in_oklab,var(--lare-diff-easy)_15%,transparent)] text-[var(--lare-diff-easy)]"
                  : "bg-[var(--surface-sunken)] text-[var(--text-tertiary)]",
              )}
              aria-hidden
            >
              {problem.solved ? <Check className="size-3" /> : <Minus className="size-3" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-zinc-100">{problem.title}</span>
                <DifficultyBadge difficulty={problem.difficulty} />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500">
                {problem.activeMs > 0 && <span>{formatDurationHuman(problem.activeMs)}</span>}
                <span>
                  {problem.attempts} {problem.attempts === 1 ? "submission" : "submissions"}
                </span>
                {problem.language && <span>{problem.language}</span>}
              </div>
            </div>
            <div className="shrink-0 text-right text-xs">
              {problem.solved ? (
                <>
                  <div className="text-[var(--lare-diff-easy)]">
                    {problem.runtimeLabel ?? "Accepted"}
                  </div>
                  {problem.runtimePercentile !== null && (
                    <div className="text-zinc-500">
                      beats {formatBeats(problem.runtimePercentile)}
                    </div>
                  )}
                </>
              ) : (
                <span className="text-zinc-500">
                  {problem.attempts > 0 ? "Not accepted" : "No submission"}
                </span>
              )}
            </div>
          </li>
        ))}
        {overview.problems.length === 0 && (
          <li className="text-sm text-zinc-500">No problems were recorded in this session.</li>
        )}
      </ul>

      <dl className="grid shrink-0 grid-cols-3 gap-2 text-center">
        <Tile label="Submissions" value={String(overview.attempts)} />
        <Tile label="Best runtime" value={beats ? `beats ${beats}` : "—"} />
        <Tile label="Average" value={avg ? `beats ${avg}` : "—"} />
      </dl>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/50 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="text-sm font-semibold text-zinc-100">{value}</dd>
    </div>
  );
}
