/**
 * Persistent (per-machine) bookkeeping for recordings: which video each became, and whether it
 * has been uploaded or transcribed. Lives in the Tauri store plugin so it survives restarts, lets
 * interrupted pipelines resume, and tells `localCopies.ts` when a take can be removed.
 */

import { load, type Store } from "@tauri-apps/plugin-store";
import type { CreateUploadResponse } from "@/lib/recorder";
import { inTauri } from "@/lib/tauri";
import type { VideoSlot } from "./pipeline";

export interface RecordingMeta {
  recordingId: string;
  /**
   * Which video slot of `postId` this recording is destined for. Only the app knows — the
   * recorder manifest carries the post, not the slot — so it is remembered here and read again
   * when the recording finishes.
   */
  slot: VideoSlot;
  /** `videos.id` once the upload pipeline created a row. */
  videoId: string | null;
  upload?: CreateUploadResponse;
  uploadPath?: string;
  uploadUrl?: string;
  uploaded: boolean;
  transcribed: boolean;
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

export async function deleteRecordingMeta(recordingId: string): Promise<void> {
  try {
    const s = await store();
    await s.delete(recordingId);
    await s.save();
  } catch {
    // Best effort: a stale entry only points at a recording that is no longer on disk.
  }
}

export async function patchRecordingMeta(
  recordingId: string,
  patch: Partial<Omit<RecordingMeta, "recordingId">>,
): Promise<RecordingMeta> {
  const prev = (await getRecordingMeta(recordingId)) ?? {
    recordingId,
    slot: "main" as VideoSlot,
    videoId: null,
    uploaded: false,
    transcribed: false,
    error: null,
    updatedAt: 0,
  };
  // Entries written before `slot` existed have none; they are all main-slot recordings.
  const next: RecordingMeta = {
    ...prev,
    ...patch,
    recordingId,
    slot: patch.slot ?? prev.slot ?? "main",
    updatedAt: Date.now(),
  };
  try {
    const s = await store();
    await s.set(recordingId, next);
    await s.save();
  } catch {
    // Best effort: the pipeline still works without persistence.
  }
  return next;
}
