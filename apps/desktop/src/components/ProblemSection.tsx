import { formatDurationHuman, problemUrl } from "@lare/shared";
import type { SessionProblem, Submission } from "@lare/supabase-types";
import { DifficultyBadge } from "@lare/ui";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { ProblemDescription } from "@/components/ProblemDescription";
import { SubmissionCard } from "@/components/SubmissionCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { parseTopicTags, sortSubmissions } from "@/lib/json";
import { openExternal } from "@/lib/open";

export type ProblemWithSubmissions = SessionProblem & { submissions: Submission[] };

export function ProblemSection({
  problem,
  defaultShowCode = false,
}: {
  problem: ProblemWithSubmissions;
  defaultShowCode?: boolean;
}) {
  const tags = useMemo(() => parseTopicTags(problem.topic_tags), [problem.topic_tags]);
  const submissions = useMemo(() => sortSubmissions(problem.submissions), [problem.submissions]);
  const url = problem.url || problemUrl(problem.slug);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-zinc-100">
            {problem.frontend_id ? (
              <span className="text-zinc-500">{problem.frontend_id}.</span>
            ) : null}
            <span className="select-text">{problem.title}</span>
            <DifficultyBadge difficulty={problem.difficulty} />
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {problem.active_ms > 0 ? (
              <span>{formatDurationHuman(problem.active_ms)} active</span>
            ) : null}
            <span>
              {submissions.length} submission{submissions.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<ExternalLink className="size-3.5" aria-hidden />}
          onClick={() => void openExternal(url)}
        >
          LeetCode
        </Button>
      </div>

      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t.slug}>{t.name}</Badge>
          ))}
        </div>
      ) : null}

      {problem.description_html ? (
        <div className="mt-3">
          <ProblemDescription html={problem.description_html} />
        </div>
      ) : null}

      {submissions.length > 0 ? (
        <div className="mt-3 space-y-3">
          {submissions.map((s) => (
            <SubmissionCard key={s.id} submission={s} defaultShowCode={defaultShowCode} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">No submissions were captured for this problem.</p>
      )}
    </section>
  );
}
