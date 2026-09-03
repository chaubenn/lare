import type { AiReview } from "@lare/shared";
import { formatDuration } from "@lare/shared";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, SectionTitle } from "@/components/ui/Card";

const SCORE_LABELS: Record<keyof AiReview["scores"], string> = {
  communication: "Communication",
  problem_solving: "Problem solving",
  code_quality: "Code quality",
  speed: "Speed",
  correctness: "Correctness",
};

function scoreTone(score: number): "emerald" | "amber" | "rose" {
  if (score >= 75) return "emerald";
  if (score >= 50) return "amber";
  return "rose";
}

export function AiReviewSection({ review }: { review: AiReview }) {
  const entries = Object.entries(SCORE_LABELS) as Array<[keyof AiReview["scores"], string]>;
  return (
    <Card>
      <SectionTitle
        action={
          <Badge tone={scoreTone(review.overall)}>
            <Sparkles className="size-3" aria-hidden />
            {review.overall}/100
          </Badge>
        }
      >
        AI interview review
      </SectionTitle>
      <p className="select-text text-sm leading-relaxed text-zinc-300">{review.summary}</p>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {entries.map(([key, label]) => {
          const s = review.scores[key];
          return (
            <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <dt className="flex items-center justify-between text-xs text-zinc-400">
                <span>{label}</span>
                <Badge tone={scoreTone(s.score)}>{s.score}</Badge>
              </dt>
              <dd className="mt-1 text-xs leading-relaxed text-zinc-400">{s.rationale}</dd>
            </div>
          );
        })}
      </dl>

      {review.moments.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-zinc-400">Moments</h3>
          <ul className="mt-2 space-y-2">
            {review.moments.map((m) => (
              <li
                key={`${m.t_ms}-${m.kind}-${m.quote.slice(0, 24)}`}
                className="rounded-lg border border-zinc-800 p-3 text-sm"
              >
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="font-mono">{formatDuration(m.t_ms)}</span>
                  <Badge tone={m.kind === "good" ? "emerald" : m.kind === "issue" ? "rose" : "sky"}>
                    {m.kind}
                  </Badge>
                  <span>{m.source}</span>
                </div>
                <blockquote className="mt-1 border-l-2 border-zinc-700 pl-2 text-xs italic text-zinc-400">
                  {m.quote}
                </blockquote>
                <p className="mt-1 text-zinc-300">{m.comment}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.code_iterations.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-zinc-400">Code iterations</h3>
          <ol className="mt-2 space-y-1.5 text-sm">
            {review.code_iterations.map((it) => (
              <li key={`${it.t_ms}-${it.label}`} className="flex gap-3">
                <span className="w-14 shrink-0 font-mono text-xs text-zinc-500">
                  {formatDuration(it.t_ms)}
                </span>
                <div>
                  <span className="text-zinc-200">{it.label}</span>
                  {it.complexity ? (
                    <span className="ml-2 font-mono text-xs text-zinc-500">{it.complexity}</span>
                  ) : null}
                  <p className="text-xs text-zinc-400">{it.assessment}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {review.next_steps.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-zinc-400">Next steps</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
            {review.next_steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
