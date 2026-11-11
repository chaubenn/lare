/**
 * In-memory registry of long-running recording jobs (upload, transcription, interview
 * processing). Pages subscribe with `useJobs()`; the pipeline updates entries as it progresses.
 */

import { useSyncExternalStore } from "react";
import { newJobId } from "@/lib/recorder";

export type JobKind = "publish" | "transcribe" | "interview";
export type JobStage =
  | "queued"
  | "create"
  | "upload"
  | "transcribe"
  | "captions"
  | "attach"
  | "done"
  | "error";

export interface Job {
  id: string;
  kind: JobKind;
  label: string;
  stage: JobStage;
  /** 0-100 for the current stage when known. */
  percent: number | null;
  detail: string | null;
  error: string | null;
  recordingId: string | null;
  postId: string | null;
  sessionId: string | null;
  /** Set once a `videos` row exists. */
  videoId: string | null;
  startedAt: number;
  updatedAt: number;
}

type Listener = () => void;

let jobs: Job[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function upsertJob(job: Job): void {
  const idx = jobs.findIndex((j) => j.id === job.id);
  const next = [...jobs];
  if (idx >= 0) next[idx] = job;
  else next.unshift(job);
  jobs = next;
  emit();
}

export function updateJob(id: string, patch: Partial<Omit<Job, "id">>): void {
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return;
  const next = [...jobs];
  next[idx] = { ...jobs[idx], ...patch, updatedAt: Date.now() } as Job;
  jobs = next;
  emit();
}

export function removeJob(id: string): void {
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}

export function createJob(
  kind: JobKind,
  label: string,
  refs: Partial<Pick<Job, "recordingId" | "postId" | "sessionId" | "videoId">> = {},
): Job {
  const job: Job = {
    // The id is what the Rust side stamps on this job's progress events.
    id: newJobId(kind),
    kind,
    label,
    stage: "queued",
    percent: null,
    detail: null,
    error: null,
    recordingId: refs.recordingId ?? null,
    postId: refs.postId ?? null,
    sessionId: refs.sessionId ?? null,
    videoId: refs.videoId ?? null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  upsertJob(job);
  return job;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current jobs outside React, e.g. to check nothing is uploading before the app relaunches. */
export function getJobs(): Job[] {
  return jobs;
}

export function useJobs(): Job[] {
  return useSyncExternalStore(
    subscribe,
    () => jobs,
    () => jobs,
  );
}

export function isActive(job: Job): boolean {
  return job.stage !== "done" && job.stage !== "error";
}

export const STAGE_LABEL: Record<JobStage, string> = {
  queued: "Queued",
  create: "Creating video",
  upload: "Uploading",
  transcribe: "Transcribing",
  captions: "Adding captions",
  attach: "Attaching to post",
  done: "Done",
  error: "Failed",
};
