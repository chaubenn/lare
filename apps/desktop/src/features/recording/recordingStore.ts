/**
 * Persistent (per-machine) bookkeeping for recordings: which ones have been uploaded,
 * transcribed, or discarded. Lives in the Tauri store plugin so it survives restarts and lets
 * the Recordings page resume interrupted pipelines.
 */

import { load, type Store } from "@tauri-apps/plugin-store";
import { inTauri } from "@/lib/tauri";

export interface RecordingMeta {
  recordingId: string;
  /** `videos.id` once the upload pipeline created a row. */
  videoId: string | null;
  uploaded: boolean;
  transcribed: boolean;
  /** Rendered MP4 for studio projects (path), if exported. */
  exportPath: string | null;
  /** Last pipeline error, cleared on success. */
  error: string | null;
  updatedAt: number;
}

let storePromise: Promise<Store> | null = null;

function store(): Promise<Store> {
  if (!inTauri) return Promise.reject(new Error("store unavailable outside Tauri"));
  if (!storePromise) storePromise = load("recordings.json", { autoSave: true, defaults: {} });
  return storePromise;
}

export async function getRecordingMeta(recordingId: string): Promise<RecordingMeta | null> {
  try {
    const s = await store();
    return (await s.get<RecordingMeta>(recordingId)) ?? null;
  } catch {
    return null;
  }
}

export async function getAllRecordingMeta(): Promise<Record<string, RecordingMeta>> {
  try {
    const s = await store();
    const out: Record<string, RecordingMeta> = {};
    for (const [k, v] of await s.entries<RecordingMeta>()) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export async function patchRecordingMeta(
  recordingId: string,
  patch: Partial<Omit<RecordingMeta, "recordingId">>,
): Promise<RecordingMeta> {
  const prev = (await getRecordingMeta(recordingId)) ?? {
    recordingId,
    videoId: null,
    uploaded: false,
    transcribed: false,
    exportPath: null,
    error: null,
    updatedAt: 0,
  };
  const next: RecordingMeta = { ...prev, ...patch, recordingId, updatedAt: Date.now() };
  try {
    const s = await store();
    await s.set(recordingId, next);
  } catch {
    // Best effort: the pipeline still works without persistence.
  }
  return next;
}

export async function forgetRecording(recordingId: string): Promise<void> {
  try {
    const s = await store();
    await s.delete(recordingId);
  } catch {
    // ignore
  }
}
