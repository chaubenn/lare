import { formatDurationHuman, problemUrl } from "@lare/shared";
import type { SessionProblem, Submission } from "@lare/supabase-types";
import { cn, DifficultyBadge } from "@lare/ui";
import { Check, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { ProblemDescription } from "@/components/ProblemDescription";
import { SubmissionCard } from "@/components/SubmissionCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { parseTopicTags } from "@/lib/json";
import { openExternal } from "@/lib/open";
import { defaultSubmissionIndex, submissionsInAttemptOrder } from "@/lib/submissions";

export type ProblemWithSubmissions = SessionProblem & { submissions: Submission[] };

/** One problem from a session: what it asked, its topic tags, and the attempts made at it. */
export function ProblemSection({
  problem,
  defaultShowCode = false,
}: {
  problem: ProblemWithSubmissions;
  defaultShowCode?: boolean;
}) {
  const tags = useMemo(() => parseTopicTags(problem.topic_tags), [problem.topic_tags]);
  const url = problem.url || problemUrl(problem.slug);
  const ordered = useMemo(
    () => submissionsInAttemptOrder(problem.submissions),
    [problem.submissions],
  );
  const [picked, setPicked] = useState<string | null>(null);
  // Falling back rather than storing the resolved id keeps the pick honest when
  // submissions refetch and the one that was selected is no longer there.
  const active = ordered.find((s) => s.id === picked) ?? ordered[defaultSubmissionIndex(ordered)];

  return (
    // One containment layer only: the submission card below is the card. A problem is
    // a titled region on the page ground, held by a hairline rather than a second box.
    <section className="border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-[var(--text)]">
            {problem.frontend_id ? (
              <span className="text-[var(--text-tertiary)]">{problem.frontend_id}.</span>
            ) : null}
            <span className="select-text">{problem.title}</span>
            <DifficultyBadge difficulty={problem.difficulty} />
          </h3>
          {/* The attempt picker rides this line rather than claiming a row of its own —
              three small chips never needed the full width they used to take. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-tertiary)]">
            {problem.active_ms > 0 ? (
              <span>{formatDurationHuman(problem.active_ms)} active</span>
            ) : null}
            {ordered.length > 1 ? (
              <SubmissionPicker ordered={ordered} activeId={active?.id} onPick={setPicked} />
            ) : (
              <span>
                {ordered.length} submission{ordered.length === 1 ? "" : "s"}
              </span>
            )}
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

      {active ? (
        <div
          className="mt-3"
          role="tabpanel"
          aria-label={`Submission ${ordered.indexOf(active) + 1}`}
        >
          <SubmissionCard submission={active} defaultShowCode={defaultShowCode} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">
          No submissions were captured for this problem.
        </p>
      )}
    </section>
  );
}

/**
 * One attempt at a time, chosen from a row of small chips. Every accepted run carries a
 * pair of runtime/memory distribution charts, so showing them all at once buries whatever
 * follows the problem — but the chooser itself should cost no vertical space at all.
 */
function SubmissionPicker({
  ordered,
  activeId,
  onPick,
}: {
  ordered: Submission[];
  activeId: string | undefined;
  onPick: (id: string) => void;
}) {
  return (
    <span role="tablist" aria-label="Submissions" className="inline-flex items-center gap-0.5">
      {ordered.map((submission, i) => {
        const selected = submission.id === activeId;
        return (
          <button
            key={submission.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onPick(submission.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-[var(--lare-r-1)] px-1.5 py-0.5 tabular-nums transition-colors duration-[var(--duration-quick)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)]",
              selected
                ? "bg-[color-mix(in_oklab,var(--text)_14%,transparent)] text-[var(--text)]"
                : "hover:text-[var(--text)]",
            )}
          >
            #{i + 1}
            {submission.accepted ? (
              <Check className="size-3 text-[var(--lare-status-run)]" aria-label="Accepted" />
            ) : null}
          </button>
        );
      })}
    </span>
  );
}
