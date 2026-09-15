/**
 * When a recording stays on this device. A take is kept until its cloud video has finished
 * processing, so it can be previewed straight away, then removed. Pure so it can be unit tested.
 */

export interface LocalCopyMeta {
  recordingId: string;
  /** `videos.id` the recording was uploaded as. */
  videoId: string | null;
  /** The cloud confirmed it has every byte. */
  uploaded: boolean;
}

export interface LocalRecording {
  recordingId: string;
  outputMp4: string | null;
}

/** The file to play for `videoId` on this device while its cloud copy is not ready yet. */
export function localFileFor(
  videoId: string,
  status: string | null | undefined,
  metas: readonly LocalCopyMeta[],
  recordings: readonly LocalRecording[],
): string | null {
  if (status === "ready") return null;
  const ids = new Set(metas.filter((m) => m.videoId === videoId).map((m) => m.recordingId));
  return recordings.find((r) => ids.has(r.recordingId) && r.outputMp4)?.outputMp4 ?? null;
}

/**
 * Recordings safe to delete: uploaded, and their video is `ready` or no longer exists (removed
 * from the draft). Anything still uploading, processing or failed keeps its source for a retry.
 * `statuses` must come from a successful lookup of every uploaded video id.
 */
export function copiesToRemove(
  metas: readonly LocalCopyMeta[],
  statuses: Readonly<Record<string, string>>,
): string[] {
  return metas
    .filter((m) => m.uploaded && m.videoId !== null)
    .filter((m) => {
      const status = statuses[m.videoId as string];
      return status === undefined || status === "ready";
    })
    .map((m) => m.recordingId);
}
