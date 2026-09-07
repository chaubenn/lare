/**
 * Compact progress list for background jobs (uploads, renders, transcriptions), shown above the
 * status footer while anything is running or recently finished.
 */

import { cn } from "@lare/ui";
import { Progress } from "@lare/ui/primitives";
import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { clearFinishedJobs, isActive, removeJob, STAGE_LABEL, useJobs } from "./jobs";

export function JobsTray() {
  const jobs = useJobs();
  if (jobs.length === 0) return null;
  const finished = jobs.filter((j) => !isActive(j)).length;
  return (
    <aside
      aria-label="Background jobs"
      className="lare-material-regular border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)]"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-1.5">
        {jobs.slice(0, 4).map((job) => {
          const active = isActive(job);
          return (
            <div key={job.id} className="flex items-center gap-2">
              {job.stage === "error" ? (
                <CircleAlert className="size-3.5 shrink-0 text-[var(--lare-danger)]" aria-hidden />
              ) : job.stage === "done" ? (
                <CircleCheck
                  className="size-3.5 shrink-0 text-[var(--lare-status-run)]"
                  aria-hidden
                />
              ) : (
                <LoaderCircle
                  className="size-3.5 shrink-0 animate-spin text-[var(--lare-info)]"
                  aria-hidden
                />
              )}
              <span className="shrink-0 font-medium text-[var(--text)]">{job.label}</span>
              <span className="truncate text-[var(--text-tertiary)]">
                {job.detail ?? STAGE_LABEL[job.stage]}
              </span>
              {active && job.percent !== null ? (
                <Progress
                  value={job.percent}
                  label={`${job.label} progress`}
                  className="ml-auto h-1.5 w-32 shrink-0"
                />
              ) : null}
              {job.postId && job.stage === "done" ? (
                <Link
                  to={`/drafts/${job.postId}`}
                  className={cn(
                    "shrink-0 text-[var(--lare-status-run)] hover:underline",
                    job.percent !== null && "ml-2",
                  )}
                >
                  Open draft
                </Link>
              ) : null}
              {!active ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-7 shrink-0"
                  aria-label="Dismiss"
                  tooltip="Dismiss"
                  tooltipAlign="end"
                  onClick={() => removeJob(job.id)}
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              ) : null}
            </div>
          );
        })}
        {finished > 1 ? (
          <button
            type="button"
            onClick={clearFinishedJobs}
            className="lare-micro self-end text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            Clear finished
          </button>
        ) : null}
      </div>
    </aside>
  );
}
