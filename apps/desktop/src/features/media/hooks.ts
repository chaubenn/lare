/** React hooks around the recorder commands: live status, permissions, devices, video rows. */

import type { Video } from "@lare/supabase-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "@/lib/queryKeys";
import {
  type CompletedRecording,
  type Permissions,
  type RecorderStatus,
  recorder,
} from "@/lib/recorder";
import { supabase, uniqueChannel } from "@/lib/supabase";
import { inTauri, useTauriEvent } from "@/lib/tauri";
import { getAllRecordingMeta } from "./recordingStore";
import type { VideoSlot } from "./types";

const IDLE: RecorderStatus = {
  state: "idle",
  recordingId: null,
  sessionId: null,
  purpose: null,
  mode: null,
  startedAt: null,
  projectPath: null,
  postId: null,
  message: null,
  recordedMs: null,
};

/** Current recorder state, kept fresh by `recording:state` events. */
export function useRecorderStatus(): RecorderStatus {
  const [status, setStatus] = useState<RecorderStatus>(IDLE);
  useEffect(() => {
    if (!inTauri) return;
    recorder
      .status()
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  useTauriEvent("recording:state", setStatus);
  return status;
}

export function usePermissions() {
  return useQuery({
    queryKey: queryKeys.recorder.permissions,
    enabled: inTauri,
    queryFn: (): Promise<Permissions> => recorder.checkPermissions(),
    refetchOnWindowFocus: true,
  });
}

export function useDevices() {
  return useQuery({
    queryKey: queryKeys.recorder.devices,
    enabled: inTauri,
    queryFn: () => recorder.listDevices(),
    staleTime: 30_000,
  });
}

export function useRecorderSettings() {
  return useQuery({
    queryKey: queryKeys.recorder.settings,
    enabled: inTauri,
    queryFn: () => recorder.settings(),
  });
}

export function useWhisperModels() {
  return useQuery({
    queryKey: queryKeys.recorder.whisperModels,
    enabled: inTauri,
    queryFn: () => recorder.whisperModels(),
  });
}

export interface RecordingWithMeta extends CompletedRecording {
  /** Which video slot of `postId` this take fills. */
  slot: VideoSlot;
  videoId: string | null;
  uploaded: boolean;
  transcribed: boolean;
  /** Why the last transcription failed, while it can still be retried. */
  transcribeError: string | null;
  error: string | null;
}

/** Completed recordings on disk merged with local pipeline bookkeeping. */
export function useRecordings() {
  return useQuery({
    queryKey: queryKeys.recorder.recordings,
    enabled: inTauri,
    queryFn: async (): Promise<RecordingWithMeta[]> => {
      const [list, meta] = await Promise.all([recorder.list(), getAllRecordingMeta()]);
      return list.map((r) => {
        const m = meta[r.recordingId];
        return {
          ...r,
          slot: m?.slot ?? "main",
          videoId: m?.videoId ?? null,
          uploaded: m?.uploaded ?? false,
          transcribed: m?.transcribed ?? false,
          transcribeError: m?.transcribeError ?? null,
          error: m?.error ?? null,
        };
      });
    },
  });
}

/** One `videos` row, updated live as Bunny's webhook flips its status. */
export function useVideo(videoId: string | null | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.video(videoId ?? ""),
    enabled: !!videoId,
    queryFn: async (): Promise<Video | null> => {
      const { data, error } = await supabase
        .from("videos")
        .select("*")
        .eq("id", videoId ?? "")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    // Poll as a fallback in case the realtime channel is unavailable.
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status && status !== "ready" && status !== "failed" ? 15_000 : false;
    },
  });
  useEffect(() => {
    if (!videoId) return;
    const channel = uniqueChannel(`video-${videoId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "videos", filter: `id=eq.${videoId}` },
        (payload) => {
          queryClient.setQueryData(queryKeys.video(videoId), payload.new as Video);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [videoId, queryClient]);
  return query;
}
