/**
 * Toasts for what the recorder does in the background. Each is a watcher rather than a call at the
 * point the event happens, so a job that ends down any of the pipeline's several paths still
 * produces exactly one notice, and a permission that is denied on every poll produces one that
 * keeps being replaced.
 */

import { useEffect, useRef } from "react";
import { notify } from "@/lib/notices";
import { routes } from "@/lib/routes";
import { usePermissions } from "./hooks";
import { isActive, type Job, removeJob, useJobs } from "./jobs";

/**
 * A finished job is worth telling you about; its progress is on the page while it runs.
 *
 * The notice carries the outcome, so the job itself is retired once reported; otherwise finished
 * jobs would pile up in the store for the life of the session. Nothing else reads a finished job:
 * every other consumer filters on `isActive`. The reported set guards the gap between the two.
 */
export function useJobNotices(): void {
  const jobs = useJobs();
  const reported = useRef(new Set<string>());
  useEffect(() => {
    for (const job of jobs) {
      if (isActive(job) || reported.current.has(job.id)) continue;
      reported.current.add(job.id);
      notify(jobNotice(job));
      removeJob(job.id);
    }
  }, [jobs]);
}

function jobNotice(job: Job) {
  if (job.stage === "error") {
    return {
      title: `${job.label} failed`,
      description: job.error ?? undefined,
      variant: "error" as const,
      href: job.postId ? routes.draft(job.postId) : undefined,
    };
  }
  return {
    title: `${job.label} finished`,
    description: job.detail ?? undefined,
    variant: "success" as const,
    href: job.postId ? routes.draft(job.postId) : undefined,
  };
}

const PERMISSION_LABEL = {
  screenRecording: "Screen recording",
  camera: "Camera",
  microphone: "Microphone",
} as const;

/**
 * One notice per capability macOS is withholding. Keyed, because the permission query refetches and
 * would otherwise report the same denial every time; and only for capture permissions, since those
 * are the ones that stop a recording rather than merely degrade it.
 */
export function usePermissionNotices(): void {
  const permissions = usePermissions();
  const data = permissions.data;
  useEffect(() => {
    if (!data) return;
    for (const [key, label] of Object.entries(PERMISSION_LABEL)) {
      const status = data[key as keyof typeof PERMISSION_LABEL];
      if (status !== "denied") continue;
      notify({
        key: `permission:${key}`,
        title: `${label} is blocked`,
        description: "Recording needs it. Settings → Recording has the fix.",
        variant: "error",
        href: routes.settings,
      });
    }
  }, [data]);
}
