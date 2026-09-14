/**
 * In-memory registry of long-running recording jobs (upload, export, transcription, interview
 * processing). Pages subscribe with `useJobs()`; the pipeline updates entries as it progresses.
 */

import { useSyncExternalStore } from "react";

export type JobKind = "publish" | "export" | "transcribe" | "interview";
export type JobStage =
  | "queued"
  | "thumbnail"
  | "create"
  | "upload"
  | "export"
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

export function upsertJob(job: Job): void {
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

export function clearFinishedJobs(): void {
  jobs = jobs.filter((j) => j.stage !== "done" && j.stage !== "error");
  emit();
}

export function createJob(
  id: string,
  kind: JobKind,
  label: string,
  refs: Partial<Pick<Job, "recordingId" | "postId" | "sessionId" | "videoId">> = {},
): Job {
  const job: Job = {
    id,
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
  thumbnail: "Making thumbnail",
  create: "Creating video",
  upload: "Uploading",
  export: "Rendering",
  transcribe: "Transcribing",
  captions: "Adding captions",
  attach: "Attaching to post",
  done: "Done",
  error: "Failed",
};
