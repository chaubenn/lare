/**
 * Local copies of recordings: played in place of a cloud video until it has processed, then
 * removed once the cloud copy is `ready` (or the video was deleted). See `localCopyRules.ts`.
 */

import type { Video } from "@lare/supabase-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useUser } from "@/features/auth/AuthProvider";
import { recorder } from "@/lib/recorder";
import { supabase } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";
import { recordingsKey } from "./hooks";
import { copiesToRemove, localFileFor } from "./localCopyRules";
import { deleteRecordingMeta, getAllRecordingMeta } from "./recordingStore";

export const localCopiesKey = ["local-copies"] as const;

/** Sweep interval for copies whose ready event was missed (app closed, socket dropped). */
const SWEEP_MS = 5 * 60_000;

/** A playable URL for this device's copy of `videoId`, while the cloud copy is not ready. */
export function useLocalVideoSrc(
  videoId: string | null | undefined,
  status: Video["status"] | null | undefined,
): string | null {
  const notReady = status !== "ready";
  const query = useQuery({
    queryKey: [...localCopiesKey, videoId],
    enabled: inTauri && !!videoId && notReady,
    queryFn: async () => {
      const [metas, recordings] = await Promise.all([getAllRecordingMeta(), recorder.list()]);
      const path = localFileFor(videoId as string, status, Object.values(metas), recordings);
      if (!path || !(await recorder.pathExists(path))) return null;
      // Not `convertFileSrc`: WebKit cannot get through a fragmented MP4 over `asset://`, which is
      // what a recording is until the cloud copy exists. See src-tauri/src/preview.rs.
      return recorder.previewUrl(path);
    },
  });
  return notReady ? (query.data ?? null) : null;
}

/**
 * Ask again where this device's copy of `videoId` is. What the preview plays is a URL for a file
 * that the cleanup sweep can delete underneath it, so a preview that has stopped being fed has to
 * be able to re-check rather than reload a source that no longer points at anything.
 */
export function useRecheckLocalVideo(videoId: string | null | undefined): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...localCopiesKey, videoId] });
  }, [queryClient, videoId]);
}

/** Delete local recordings whose cloud video is ready or gone. Returns how many were removed. */
export async function removeProcessedCopies(): Promise<number> {
  const metas = Object.values(await getAllRecordingMeta()).filter((m) => m.uploaded && m.videoId);
  if (metas.length === 0) return 0;
  const ids = [...new Set(metas.map((m) => m.videoId as string))];
  const { data, error } = await supabase.from("videos").select("id, status").in("id", ids);
  // Without an answer nothing is known to be processed, so nothing is removed.
  if (error || !data) return 0;
  const statuses = Object.fromEntries(data.map((v) => [v.id, v.status]));
  let removed = 0;
  for (const recordingId of copiesToRemove(metas, statuses)) {
    try {
      await recorder.delete(recordingId);
      await deleteRecordingMeta(recordingId);
      removed += 1;
    } catch (e) {
      console.warn("Could not remove a processed local recording", e);
    }
  }
  return removed;
}

/** Keep local copies until their videos process: on launch, on each ready event, and on a timer. */
export function useLocalCopyCleanup(): void {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!inTauri) return;
    const run = () =>
      void removeProcessedCopies().then((removed) => {
        if (removed === 0) return;
        void queryClient.invalidateQueries({ queryKey: localCopiesKey });
        void queryClient.invalidateQueries({ queryKey: recordingsKey });
      });
    run();
    const timer = setInterval(run, SWEEP_MS);
    const channel = supabase
      .channel(`local-copies:${userId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "videos", filter: `user_id=eq.${userId}` },
        (payload) => {
          if ((payload.new as { status?: string }).status === "ready") run();
        },
      )
      .subscribe();
    return () => {
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
