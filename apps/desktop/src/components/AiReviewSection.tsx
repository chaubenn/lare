import type { AiReview } from "@lare/shared";
import { formatDuration, AI_SCORE_LABELS as SCORE_LABELS } from "@lare/shared";
import { cn } from "@lare/ui";
import { useState } from "react";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";

type DetailTab = "scores" | "moments" | "code" | "next";

const MOMENT_TONE: Record<string, string> = {
  good: "bg-emerald-400",
  issue: "bg-rose-400",
  suggestion: "bg-sky-400",
};

/**
 * Renders a parsed `AiReview` as a dashboard instead of one long scroll: the overall score, the
 * five skill scores side by side and the summary stay on show, and everything else (the reasoning
 * behind each score, timestamped moments, code iterations, next steps) sits on tabs, each in a
 * panel of fixed height that scrolls on its own. It lays itself out from its own width, so it fills
 * a full-width section and still fits a narrow card.
 * Pass `onSeek` to make timestamped rows clickable.
 */
export function AiReviewSection({
  review,
  onSeek,
  nested = false,
}: {
  review: AiReview;
  onSeek?: (tMs: number) => void;
  /** Sitting inside another raised container, so step one shade lighter to stay distinct. */
  nested?: boolean;
}) {
  const entries = Object.entries(SCORE_LABELS) as Array<[keyof AiReview["scores"], string]>;
  const scoreNotes = entries.filter(([key]) => review.scores[key].rationale);

  const tabs: Array<{ key: DetailTab; label: string; badge?: number }> = [
    ...(scoreNotes.length > 0 ? [{ key: "scores" as const, label: "Score notes" }] : []),
    ...(review.moments.length > 0
      ? [{ key: "moments" as const, label: "Moments", badge: review.moments.length }]
      : []),
    ...(review.code_iterations.length > 0
      ? [{ key: "code" as const, label: "Code", badge: review.code_iterations.length }]
      : []),
    ...(review.next_steps.length > 0
      ? [{ key: "next" as const, label: "Next steps", badge: review.next_steps.length }]
      : []),
  ];
  const [picked, setPicked] = useState<DetailTab | null>(null);
  const active = tabs.find((t) => t.key === picked)?.key ?? tabs[0]?.key;

  return (
    <section
      className={cn(
        "@container rounded-xl border border-zinc-800 p-4 @2xl:p-5",
        nested ? "bg-[var(--surface-sunken)]" : "bg-[var(--surface-raised)]",
      )}
    >
      <div className="grid gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="min-w-0">
          <header className="flex items-end justify-between gap-3">
            <h2 className="text-sm font-medium text-zinc-100">AI interview review</h2>
            <p className="tabular-nums leading-none text-zinc-300">
              <span className="text-3xl font-semibold text-zinc-50">{review.overall}</span>
              <span className="text-sm text-zinc-500">/100</span>
            </p>
          </header>
          <p className="mt-3 select-text text-sm leading-relaxed text-zinc-300">{review.summary}</p>
        </div>

        <dl className="grid min-w-0 grid-cols-2 content-start gap-2 @lg:grid-cols-3 @4xl:grid-cols-2 @6xl:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-full @lg:[&>*:last-child:nth-child(odd)]:col-span-1 @4xl:[&>*:last-child:nth-child(odd)]:col-span-full @6xl:[&>*:last-child:nth-child(odd)]:col-span-1">
          {entries.map(([key, label]) => {
            const s = review.scores[key];
            return (
              <div
                key={key}
                className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--text)_3%,transparent)] px-3 py-2.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="truncate text-xs text-zinc-400">{label}</dt>
                  <dd className="text-base font-semibold tabular-nums text-zinc-100">{s.score}</dd>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${Math.max(0, Math.min(100, s.score))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </dl>
      </div>

      {tabs.length > 0 && active ? (
        <div className="mt-5 border-t border-zinc-800 pt-4">
          <SegmentedTabs
            label="Review detail"
            value={active}
            onChange={setPicked}
            items={tabs.map((t) => ({
              key: t.key,
              label: t.label,
              badge:
                t.badge !== undefined ? (
                  <span className="tabular-nums text-zinc-500">{t.badge}</span>
                ) : undefined,
            }))}
          />
          <div
            role="tabpanel"
            className="mt-3 max-h-[min(22rem,50vh)] overflow-y-auto overscroll-contain pr-1"
          >
            {active === "scores" ? (
              <dl className="grid gap-x-8 gap-y-4 @2xl:grid-cols-2">
                {scoreNotes.map(([key, label]) => (
                  <div key={key}>
                    <dt className="text-sm text-zinc-200">
                      {label}{" "}
                      <span className="tabular-nums text-zinc-500">{review.scores[key].score}</span>
                    </dt>
                    <dd className="mt-0.5 select-text text-sm leading-relaxed text-zinc-400">
                      {review.scores[key].rationale}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {active === "moments" ? (
              <ul className="grid gap-x-8 gap-y-4 @2xl:grid-cols-2">
                {review.moments.map((m) => {
                  const body = (
                    <>
                      <span className="flex items-center gap-2 text-xs text-zinc-500">
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            MOMENT_TONE[m.kind] ?? "bg-zinc-500",
                          )}
                        />
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
            ) : null}

            {active === "code" ? (
              <ol className="grid gap-x-8 gap-y-3 text-sm @2xl:grid-cols-2">
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
            ) : null}

            {active === "next" ? (
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-300">
                {review.next_steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
