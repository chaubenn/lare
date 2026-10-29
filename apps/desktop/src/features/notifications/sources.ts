/**
 * The things that used to speak for themselves, now reporting to the notice centre: background
 * jobs, the updater, and OS capture permissions.
 *
 * Mounted once by the app shell. Each source is a watcher rather than a call at the point the event
 * happens, so a job that ends down any of the pipeline's several paths still produces exactly one
 * notice, and a permission that is denied on every poll produces one that keeps being replaced.
 */

import { useEffect, useRef } from "react";
import { usePermissions } from "@/features/media/hooks";
import { isActive, type Job, removeJob, useJobs } from "@/features/media/jobs";
import { inTauri } from "@/lib/tauri";
import { checkForUpdate, dismissUpdate, useUpdateState } from "@/lib/updater";
import { notify } from "./notices";

/** Delay before the launch check so it never competes with the first paint / auth round-trip. */
const LAUNCH_CHECK_DELAY_MS = 3_000;
/**
 * Re-check interval. People leave Lare open for days; a launch-only check would never notice a
 * release published after startup, so poll while running too.
 */
const RECHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A finished job is worth telling you about; its progress is on the page while it runs.
 *
 * The notice carries the outcome, so the job itself is retired once reported — otherwise finished
 * jobs would pile up in the store for the life of the session. Nothing else reads a finished job:
 * every other consumer filters on `isActive`. The reported set guards the gap between the two.
 */
function useJobNotices() {
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
      href: job.postId ? `/drafts/${job.postId}` : undefined,
    };
  }
  return {
    title: `${job.label} finished`,
    description: job.detail ?? undefined,
    variant: "success" as const,
    href: job.postId ? `/drafts/${job.postId}` : undefined,
  };
}

/**
 * Checks GitHub Releases on launch and then hourly, and posts a notice when a newer Lare exists.
 * Settings is where it is installed from, so that is where the notice points. Errors from
 * background checks stay silent — Settings shows them on a manual check.
 */
function useUpdateNotices() {
  const state = useUpdateState();

  useEffect(() => {
    if (!inTauri) return;
    let timer = setTimeout(run, LAUNCH_CHECK_DELAY_MS);
    function run() {
      void checkForUpdate().then((result) => {
        if (result.status === "error") dismissUpdate();
      });
      timer = setTimeout(run, RECHECK_INTERVAL_MS);
    }
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (state.status !== "available") return;
    notify({
      key: `update:${state.version}`,
      title: `Lare v${state.version} is available`,
      description: "Install it from Settings.",
      href: "/settings",
    });
  }, [state]);
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
function usePermissionNotices() {
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
        href: "/settings",
      });
    }
  }, [data]);
}

/** Mount once, in the shell. */
export function useNoticeSources(): void {
  useJobNotices();
  useUpdateNotices();
  usePermissionNotices();
}
