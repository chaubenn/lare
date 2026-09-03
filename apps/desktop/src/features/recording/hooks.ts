/** React hooks around the recorder commands: live status, permissions, devices, video rows. */

import type { Video } from "@lare/supabase-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  type CompletedRecording,
  type Permissions,
  type RecorderStatus,
  recorder,
} from "@/lib/recorder";
import { supabase } from "@/lib/supabase";
import { inTauri, useTauriEvent } from "@/lib/tauri";
import { getAllRecordingMeta } from "./recordingStore";

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

export const permissionsKey = ["recorder", "permissions"] as const;
export const devicesKey = ["recorder", "devices"] as const;
export const settingsKey = ["recorder", "settings"] as const;
export const recordingsKey = ["recorder", "recordings"] as const;
export const whisperModelsKey = ["recorder", "whisper-models"] as const;

export function usePermissions() {
  return useQuery({
    queryKey: permissionsKey,
    enabled: inTauri,
    queryFn: (): Promise<Permissions> => recorder.checkPermissions(),
    refetchOnWindowFocus: true,
  });
}

export function useDevices() {
  return useQuery({
    queryKey: devicesKey,
    enabled: inTauri,
    queryFn: () => recorder.listDevices(),
    staleTime: 30_000,
  });
}

export function useRecorderSettings() {
  return useQuery({
    queryKey: settingsKey,
    enabled: inTauri,
    queryFn: () => recorder.settings(),
  });
}

export function useWhisperModels() {
  return useQuery({
    queryKey: whisperModelsKey,
    enabled: inTauri,
    queryFn: () => recorder.whisperModels(),
  });
}

export interface RecordingWithMeta extends CompletedRecording {
  videoId: string | null;
  uploaded: boolean;
  transcribed: boolean;
  exportPath: string | null;
  error: string | null;
}

/** Completed recordings on disk merged with local pipeline bookkeeping. */
export function useRecordings() {
  return useQuery({
    queryKey: recordingsKey,
    enabled: inTauri,
    queryFn: async (): Promise<RecordingWithMeta[]> => {
      const [list, meta] = await Promise.all([recorder.list(), getAllRecordingMeta()]);
      return list.map((r) => {
        const m = meta[r.recordingId];
        return {
          ...r,
          videoId: m?.videoId ?? null,
          uploaded: m?.uploaded ?? false,
          transcribed: m?.transcribed ?? false,
          exportPath: m?.exportPath ?? null,
          error: m?.error ?? null,
        };
      });
    },
  });
}

export const videoKey = (id: string) => ["video", id] as const;

/** One `videos` row, updated live as Bunny's webhook flips its status. */
export function useVideo(videoId: string | null | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: videoKey(videoId ?? ""),
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
    const channel = supabase
      .channel(`video-${videoId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "videos", filter: `id=eq.${videoId}` },
        (payload) => {
          queryClient.setQueryData(videoKey(videoId), payload.new as Video);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [videoId, queryClient]);
  return query;
}
