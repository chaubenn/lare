import { formatDuration } from "@lare/shared";
import {
  Bot,
  ChevronDown,
  CodeXml,
  Lightbulb,
  ListChecks,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ReviewView } from "@/lib/parse";
import { cardClass } from "@/lib/styles";

function scoreTone(score: number): string {
  if (score >= 80) return "text-zinc-100";
  if (score >= 60) return "text-zinc-300";
  return "text-zinc-400";
}

const KIND: Record<
  ReviewView["moments"][number]["kind"],
  { icon: typeof ThumbsUp; label: string; text: string }
> = {
  good: { icon: ThumbsUp, label: "Good", text: "text-zinc-200" },
  issue: { icon: TriangleAlert, label: "Issue", text: "text-rose-300" },
  suggestion: { icon: Lightbulb, label: "Suggestion", text: "text-zinc-300" },
};

/** Stable, content-derived React keys; duplicates get a suffix instead of using array indices. */
function withKeys<T>(
  items: readonly T[],
  base: (item: T) => string,
): Array<{ key: string; item: T }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const b = base(item);
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return { key: n === 0 ? b : `${b}#${n}`, item };
  });
}

export function InterviewReview({ review }: { review: ReviewView }) {
  const moments = withKeys(review.moments, (m) => `${m.t_ms}:${m.kind}:${m.source}`);
  const iterations = withKeys(review.code_iterations, (c) => `${c.t_ms}:${c.label}`);
  const steps = withKeys(review.next_steps, (s) => s);
  const detailBits = [
    review.moments.length > 0 ? `${review.moments.length} moments` : null,
    review.code_iterations.length > 0 ? `${review.code_iterations.length} code notes` : null,
    review.next_steps.length > 0 ? `${review.next_steps.length} next steps` : null,
    review.scores.some((s) => s.rationale) ? "score notes" : null,
  ].filter(Boolean);
  const hasDetails = detailBits.length > 0;

  return (
    <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby="ai-review-heading">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2
            id="ai-review-heading"
            className="flex items-center gap-2 text-lg font-medium text-zinc-50"
          >
            <Bot className="size-5 text-zinc-400" />
            AI interview review
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {review.model} · {new Date(review.created_at).toLocaleDateString()}
          </p>
        </div>
        {review.overall !== null && (
          <div className="text-right">
            <div className="text-3xl font-medium tabular-nums text-zinc-50">
              {review.overall}
              <span className="text-sm font-normal text-zinc-500">/100</span>
            </div>
            <p className="text-xs text-zinc-500">Overall</p>
          </div>
        )}
      </header>

      {review.scores.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          {review.scores.map((s) => (
            <div key={s.key}>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-xs text-zinc-500">{s.label}</dt>
                <dd className={cn("text-sm tabular-nums", scoreTone(s.score))}>{s.score}</dd>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-400"
                  style={{ width: `${Math.max(0, Math.min(100, s.score))}%` }}
                />
              </div>
            </div>
          ))}
        </dl>
      )}

      {review.summary && (
        <p className="mt-5 text-sm leading-relaxed text-zinc-300">{review.summary}</p>
      )}

      {hasDetails ? (
        <details className="group mt-5 border-t border-zinc-800 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="size-4 shrink-0 transition-transform duration-[var(--duration-fast)] group-open:rotate-180"
              aria-hidden
            />
            More detail
            <span className="truncate text-xs text-zinc-600">{detailBits.join(" · ")}</span>
          </summary>
          <div className="mt-4 space-y-6">
            {review.scores.some((s) => s.rationale) ? (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Score notes
                </h3>
                <dl className="space-y-3">
                  {review.scores
                    .filter((s) => s.rationale)
                    .map((s) => (
                      <div key={s.key}>
                        <dt className="text-sm text-zinc-200">
                          {s.label} <span className="tabular-nums text-zinc-500">{s.score}</span>
                        </dt>
                        <dd className="mt-0.5 text-sm leading-relaxed text-zinc-400">
                          {s.rationale}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : null}

            {review.moments.length > 0 && (
              <SubSection title="Moments" icon={<TriangleAlert className="size-4 text-zinc-500" />}>
                <ol className="relative ml-2 space-y-4 border-l border-zinc-800 pl-5">
                  {moments.map(({ key, item: m }) => {
                    const kind = KIND[m.kind];
                    const Icon = kind.icon;
                    return (
                      <li key={key} className="relative">
                        <span className="absolute -left-[27px] top-0.5 inline-flex size-3.5 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950">
                          <Icon className={cn("size-2.5", kind.text)} />
                        </span>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                          <span className="font-mono text-zinc-400">{formatDuration(m.t_ms)}</span>
                          <span className={kind.text}>{kind.label}</span>
                        </div>
                        {m.quote && (
                          <blockquote className="mt-1.5 border-l-2 border-zinc-700 pl-3 text-sm text-zinc-400">
                            “{m.quote}”
                          </blockquote>
                        )}
                        <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{m.comment}</p>
                      </li>
                    );
                  })}
                </ol>
              </SubSection>
            )}

            {review.code_iterations.length > 0 && (
              <SubSection
                title="Code iterations"
                icon={<CodeXml className="size-4 text-zinc-500" />}
              >
                <ol className="space-y-3">
                  {iterations.map(({ key, item: c }) => (
                    <li key={key}>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span className="font-mono text-zinc-400">{formatDuration(c.t_ms)}</span>
                        <span className="text-sm text-zinc-100">{c.label}</span>
                        {c.complexity ? (
                          <span className="font-mono text-[11px] text-zinc-500">
                            {c.complexity}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{c.assessment}</p>
                    </li>
                  ))}
                </ol>
              </SubSection>
            )}

            {review.next_steps.length > 0 && (
              <SubSection title="Next steps" icon={<ListChecks className="size-4 text-zinc-500" />}>
                <ul className="space-y-2">
                  {steps.map(({ key, item: step }) => (
                    <li key={key} className="flex gap-2 text-sm text-zinc-300">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-zinc-500" />
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ul>
              </SubSection>
            )}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function SubSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}
