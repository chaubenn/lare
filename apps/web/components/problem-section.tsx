import {
  excerptFromHtml,
  formatDurationHuman,
  LANGUAGE_LABELS,
  LEETCODE_STATUS,
  problemUrl,
} from "@lare/shared";
import type { SessionProblem, Submission } from "@lare/supabase-types";
import { Check, Clock, ExternalLink, X } from "lucide-react";
import { parseTopicTags, toDistribution } from "@/lib/parse";
import { sortSubmissions } from "@/lib/post-utils";
import { sanitizeHtml } from "@/lib/sanitize";
import { cardClass } from "@/lib/styles";
import { TimeAgo } from "./time-ago";
import { CodeBlock, DifficultyBadge, SubmissionStats } from "./ui";

export type ProblemWithSubmissions = SessionProblem & { submissions: Submission[] };

export function ProblemSection({
  problem,
  index,
}: {
  problem: ProblemWithSubmissions;
  index: number;
}) {
  const tags = parseTopicTags(problem.topic_tags);
  const submissions = sortSubmissions(problem.submissions);
  const description = problem.description_html ? sanitizeHtml(problem.description_html) : null;
  const summary = excerptFromHtml(problem.description_html, 140);

  return (
    <section className={`${cardClass} p-4 sm:p-5`} aria-labelledby={`problem-${problem.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-zinc-500">#{index + 1}</span>
            <h3 id={`problem-${problem.id}`} className="text-base font-semibold text-zinc-50">
              {problem.frontend_id ? `${problem.frontend_id}. ` : ""}
              {problem.title}
            </h3>
            <DifficultyBadge difficulty={problem.difficulty} />
          </div>
          {tags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li
                  key={tag.slug}
                  className="rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400"
                >
                  {tag.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {problem.active_ms > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              {formatDurationHuman(problem.active_ms)}
            </span>
          )}
          <a
            href={problemUrl(problem.slug)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-zinc-300 hover:text-zinc-100"
          >
            LeetCode
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </header>

      {description && (
        <details className="group mt-4 rounded-xl border border-zinc-800/80 bg-zinc-950/40">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm text-zinc-400 marker:content-none hover:text-zinc-200">
            <span className="mr-2 inline-block text-zinc-600 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span className="group-open:hidden">{summary || "Problem description"}</span>
            <span className="hidden group-open:inline">Problem description</span>
          </summary>
          <div
            className="leetcode-html border-t border-zinc-800/80 px-4 py-3"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised with DOMPurify in sanitizeHtml()
            dangerouslySetInnerHTML={{ __html: description }}
          />
        </details>
      )}

      <div className="mt-4 space-y-3">
        {submissions.length === 0 ? (
          <p className="text-sm text-zinc-500">No submissions were captured for this problem.</p>
        ) : (
          submissions.map((submission, i) => (
            <SubmissionCard key={submission.id} submission={submission} expanded={i === 0} />
          ))
        )}
      </div>
    </section>
  );
}

function statusLabel(s: Submission): string {
  if (s.status_display) return s.status_display;
  if (s.accepted) return "Accepted";
  return (s.status_code !== null && LEETCODE_STATUS[s.status_code]) || "Unknown";
}

function langLabel(s: Submission): string | null {
  if (s.lang && LANGUAGE_LABELS[s.lang]) return LANGUAGE_LABELS[s.lang] ?? null;
  return s.lang_verbose ?? s.lang;
}

function SubmissionCard({ submission, expanded }: { submission: Submission; expanded: boolean }) {
  const runtimeDist = toDistribution(submission.runtime_distribution);
  const memoryDist = toDistribution(submission.memory_distribution);
  const showStats =
    submission.accepted || submission.runtime_ms !== null || submission.memory_mb !== null;
  const lang = langLabel(submission);
  const tests =
    submission.total_testcases !== null && submission.total_correct !== null
      ? `${submission.total_correct} / ${submission.total_testcases} test cases passed`
      : null;

  return (
    <article className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span
          className={`inline-flex items-center gap-1 font-semibold ${
            submission.accepted ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {submission.accepted ? <Check className="size-4" /> : <X className="size-4" />}
          {statusLabel(submission)}
        </span>
        {lang && <span className="text-xs text-zinc-400">{lang}</span>}
        {!submission.accepted && tests && <span className="text-xs text-zinc-500">{tests}</span>}
        <TimeAgo iso={submission.submitted_at} className="ml-auto text-xs text-zinc-500" />
      </header>

      {showStats && (
        <SubmissionStats
          className="mt-3"
          runtimeMs={submission.runtime_ms}
          runtimeDisplay={submission.runtime_display}
          runtimePercentile={submission.runtime_percentile}
          memoryMb={submission.memory_mb}
          memoryDisplay={submission.memory_display}
          memoryPercentile={submission.memory_percentile}
          runtimeDistribution={runtimeDist}
          memoryDistribution={memoryDist}
        />
      )}

      {submission.code &&
        (expanded ? (
          <CodeBlock className="mt-3" code={submission.code} lang={submission.lang} />
        ) : (
          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-xs text-zinc-400 hover:text-zinc-200">
              <span className="group-open:hidden">Show code</span>
              <span className="hidden group-open:inline">Hide code</span>
            </summary>
            <CodeBlock className="mt-2" code={submission.code} lang={submission.lang} />
          </details>
        ))}
    </article>
  );
}
