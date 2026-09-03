import { LANGUAGE_LABELS } from "@lare/shared";
import type { Submission } from "@lare/supabase-types";
import { CodeBlock, SubmissionStats } from "@lare/ui";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format";
import { parseDistributionJson } from "@/lib/json";

export function languageLabel(lang: string | null, verbose?: string | null): string {
  if (verbose) return verbose;
  if (!lang) return "Unknown";
  return LANGUAGE_LABELS[lang] ?? lang;
}

export function SubmissionCard({
  submission,
  defaultShowCode = false,
}: {
  submission: Submission;
  defaultShowCode?: boolean;
}) {
  const [showCode, setShowCode] = useState(defaultShowCode);
  const status = submission.status_display ?? (submission.accepted ? "Accepted" : "Unknown");
  const testcases =
    submission.total_correct !== null && submission.total_testcases !== null
      ? `${submission.total_correct}/${submission.total_testcases} testcases`
      : null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <Badge tone={submission.accepted ? "emerald" : "rose"}>{status}</Badge>
        <span>{languageLabel(submission.lang, submission.lang_verbose)}</span>
        <span aria-hidden>·</span>
        <span>{formatDateTime(submission.submitted_at)}</span>
        {testcases ? (
          <>
            <span aria-hidden>·</span>
            <span>{testcases}</span>
          </>
        ) : null}
        {submission.code ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setShowCode((v) => !v)}
            aria-expanded={showCode}
          >
            {showCode ? "Hide code" : "Show code"}
          </Button>
        ) : null}
      </div>

      {submission.accepted ? (
        <SubmissionStats
          className="mt-3"
          runtimeMs={submission.runtime_ms}
          runtimeDisplay={submission.runtime_display}
          runtimePercentile={submission.runtime_percentile}
          memoryMb={submission.memory_mb}
          memoryDisplay={submission.memory_display}
          memoryPercentile={submission.memory_percentile}
          runtimeDistribution={parseDistributionJson(submission.runtime_distribution)}
          memoryDistribution={parseDistributionJson(submission.memory_distribution)}
        />
      ) : null}

      {showCode && submission.code ? (
        <div className="mt-3 select-text">
          <CodeBlock code={submission.code} lang={submission.lang} />
        </div>
      ) : null}
    </div>
  );
}
