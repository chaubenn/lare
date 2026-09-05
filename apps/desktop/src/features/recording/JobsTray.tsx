/**
 * Compact progress list for background jobs (uploads, renders, transcriptions), shown above the
 * status footer while anything is running or recently finished.
 */

import { cn } from "@lare/ui";
import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";
import { Link } from "react-router";
import { Tooltip } from "@/components/ui/Tooltip";
import { clearFinishedJobs, isActive, removeJob, STAGE_LABEL, useJobs } from "./jobs";

export function JobsTray() {
  const jobs = useJobs();
  if (jobs.length === 0) return null;
  const finished = jobs.filter((j) => !isActive(j)).length;
  return (
    <aside
      aria-label="Background jobs"
      className="border-t border-zinc-800/80 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-300"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-1.5">
        {jobs.slice(0, 4).map((job) => {
          const active = isActive(job);
          return (
            <div key={job.id} className="flex items-center gap-2">
              {job.stage === "error" ? (
                <CircleAlert className="size-3.5 shrink-0 text-rose-400" aria-hidden />
              ) : job.stage === "done" ? (
                <CircleCheck className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
              ) : (
                <LoaderCircle className="size-3.5 shrink-0 animate-spin text-sky-400" aria-hidden />
              )}
              <span className="shrink-0 font-medium text-zinc-200">{job.label}</span>
              <span className="truncate text-zinc-500">{job.detail ?? STAGE_LABEL[job.stage]}</span>
              {active && job.percent !== null ? (
                <span className="ml-auto h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-zinc-800">
                  <span
                    className="block h-full rounded-full bg-sky-500 transition-[width]"
                    style={{ width: `${Math.min(100, Math.max(0, job.percent))}%` }}
                  />
                </span>
              ) : null}
              {job.postId && job.stage === "done" ? (
                <Link
                  to={`/drafts/${job.postId}`}
                  className={cn(
                    "shrink-0 text-emerald-400 hover:underline",
                    job.percent !== null && "ml-2",
                  )}
                >
                  Open draft
                </Link>
              ) : null}
              {!active ? (
                <Tooltip label="Dismiss" align="end" className="ml-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => removeJob(job.id)}
                    aria-label="Dismiss"
                    className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          );
        })}
        {finished > 1 ? (
          <button
            type="button"
            onClick={clearFinishedJobs}
            className="self-end text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            Clear finished
          </button>
        ) : null}
      </div>
    </aside>
  );
}
