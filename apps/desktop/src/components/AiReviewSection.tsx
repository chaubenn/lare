import type { AiReview } from "@lare/shared";
import { formatDuration } from "@lare/shared";
import { cn } from "@lare/ui";
import { ChevronDown } from "lucide-react";

const SCORE_LABELS: Record<keyof AiReview["scores"], string> = {
  communication: "Communication",
  problem_solving: "Problem solving",
  code_quality: "Code quality",
  speed: "Speed",
  correctness: "Correctness",
};

/**
 * Renders a parsed `AiReview`. Face value is the overall score, per-skill percents, and
 * summary. Moments, rationales, and next steps sit behind a closed accordion.
 * Pass `onSeek` to make timestamped rows clickable.
 */
export function AiReviewSection({
  review,
  onSeek,
}: {
  review: AiReview;
  onSeek?: (tMs: number) => void;
}) {
  const entries = Object.entries(SCORE_LABELS) as Array<[keyof AiReview["scores"], string]>;
  const hasScoreNotes = entries.some(([key]) => review.scores[key].rationale);
  const detailBits = [
    review.moments.length > 0 ? `${review.moments.length} moments` : null,
    review.code_iterations.length > 0 ? `${review.code_iterations.length} code notes` : null,
    review.next_steps.length > 0 ? `${review.next_steps.length} next steps` : null,
    hasScoreNotes ? "score notes" : null,
  ].filter(Boolean);
  const hasDetails = detailBits.length > 0;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-100">AI interview review</h2>
        <p className="tabular-nums text-sm text-zinc-300">
          {review.overall}
          <span className="text-zinc-500">/100</span>
        </p>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-5">
        {entries.map(([key, label]) => {
          const s = review.scores[key];
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-xs text-zinc-500">{label}</dt>
                <dd className="text-sm tabular-nums text-zinc-200">{s.score}</dd>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-400"
                  style={{ width: `${Math.max(0, Math.min(100, s.score))}%` }}
                />
              </div>
            </div>
          );
        })}
      </dl>

      <p className="mt-4 select-text text-sm leading-relaxed text-zinc-300">{review.summary}</p>

      {hasDetails ? (
        <details className="group mt-4 border-t border-zinc-800 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="size-4 shrink-0 transition-transform duration-[var(--duration-fast)] group-open:rotate-180"
              aria-hidden
            />
            More detail
            <span className="truncate text-xs text-zinc-600">{detailBits.join(" · ")}</span>
          </summary>

          <div className="mt-4 space-y-5">
            {hasScoreNotes ? (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Score notes
                </h3>
                <dl className="mt-2 space-y-3">
                  {entries.map(([key, label]) => {
                    const s = review.scores[key];
                    if (!s.rationale) return null;
                    return (
                      <div key={key}>
                        <dt className="text-sm text-zinc-200">
                          {label} <span className="tabular-nums text-zinc-500">{s.score}</span>
                        </dt>
                        <dd className="mt-0.5 text-sm leading-relaxed text-zinc-400">
                          {s.rationale}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ) : null}

            {review.moments.length > 0 ? (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Moments
                </h3>
                <ul className="mt-2 space-y-3">
                  {review.moments.map((m) => {
                    const body = (
                      <>
                        <span className="flex items-center gap-2 text-xs text-zinc-500">
                          <span className={cn("font-mono", onSeek && "text-zinc-300 underline")}>
                            {formatDuration(m.t_ms)}
                          </span>
                          <span className="capitalize">{m.kind}</span>
                        </span>
                        {m.quote ? (
                          <span className="mt-1 block border-l-2 border-zinc-700 pl-2 text-sm text-zinc-400">
                            {m.quote}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-sm text-zinc-300">{m.comment}</span>
                      </>
                    );
                    return (
                      <li key={`${m.t_ms}-${m.kind}-${m.quote.slice(0, 24)}`}>
                        {onSeek ? (
                          <button
                            type="button"
                            onClick={() => onSeek(m.t_ms)}
                            title={`Jump to ${formatDuration(m.t_ms)}`}
                            className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/70"
                          >
                            {body}
                          </button>
                        ) : (
                          body
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {review.code_iterations.length > 0 ? (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Code iterations
                </h3>
                <ol className="mt-2 space-y-2 text-sm">
                  {review.code_iterations.map((it) => (
                    <li key={`${it.t_ms}-${it.label}`} className="flex gap-3">
                      {onSeek ? (
                        <button
                          type="button"
                          onClick={() => onSeek(it.t_ms)}
                          title={`Jump to ${formatDuration(it.t_ms)}`}
                          className="w-14 shrink-0 text-left font-mono text-xs text-zinc-400 underline hover:text-zinc-200"
                        >
                          {formatDuration(it.t_ms)}
                        </button>
                      ) : (
                        <span className="w-14 shrink-0 font-mono text-xs text-zinc-500">
                          {formatDuration(it.t_ms)}
                        </span>
                      )}
                      <div>
                        <span className="text-zinc-200">{it.label}</span>
                        {it.complexity ? (
                          <span className="ml-2 font-mono text-xs text-zinc-500">
                            {it.complexity}
                          </span>
                        ) : null}
                        <p className="text-sm text-zinc-400">{it.assessment}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {review.next_steps.length > 0 ? (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Next steps
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
                  {review.next_steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
