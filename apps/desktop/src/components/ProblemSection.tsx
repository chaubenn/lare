import { formatDurationHuman, problemUrl } from "@lare/shared";
import type { SessionProblem, Submission } from "@lare/supabase-types";
import { DifficultyBadge } from "@lare/ui";
import { Check, ExternalLink } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ProblemDescription } from "@/components/ProblemDescription";
import { SubmissionCard } from "@/components/SubmissionCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { type SegmentedTab, SegmentedTabs } from "@/components/ui/SegmentedTabs";
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
  const submissions = problem.submissions;
  const url = problem.url || problemUrl(problem.slug);

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
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-tertiary)]">
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
        <Submissions submissions={submissions} defaultShowCode={defaultShowCode} />
      ) : (
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">
          No submissions were captured for this problem.
        </p>
      )}
    </section>
  );
}

/**
 * One attempt at a time. Every accepted run carries a pair of runtime/memory
 * distribution charts, so stacking them buries whatever follows the problem.
 */
function Submissions({
  submissions,
  defaultShowCode,
}: {
  submissions: Submission[];
  defaultShowCode: boolean;
}) {
  const panelId = useId();
  const ordered = useMemo(() => submissionsInAttemptOrder(submissions), [submissions]);
  const [picked, setPicked] = useState<string | null>(null);
  // Falling back rather than storing the resolved id keeps the pick honest when
  // submissions refetch and the one that was selected is no longer there.
  const active = ordered.find((s) => s.id === picked) ?? ordered[defaultSubmissionIndex(ordered)];
  if (!active) return null;

  if (ordered.length === 1) {
    return (
      <div className="mt-3">
        <SubmissionCard submission={active} defaultShowCode={defaultShowCode} />
      </div>
    );
  }

  const tabs: Array<SegmentedTab<string>> = ordered.map((submission, i) => ({
    key: submission.id,
    label: `#${i + 1}`,
    badge: submission.accepted ? (
      <Check className="size-3 text-[var(--lare-status-run)]" aria-label="Accepted" />
    ) : null,
  }));

  return (
    <div className="mt-3">
      <SegmentedTabs
        items={tabs}
        value={active.id}
        onChange={setPicked}
        label="Submissions"
        className="mb-3"
      />
      <div id={panelId} role="tabpanel" aria-label={`Submission ${ordered.indexOf(active) + 1}`}>
        <SubmissionCard submission={active} defaultShowCode={defaultShowCode} />
      </div>
    </div>
  );
}
