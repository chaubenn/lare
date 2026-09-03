import type { EditLog, TranscriptSegment } from "@lare/shared";
import type { SessionProblem, Transcript, Video } from "@lare/supabase-types";
import type { QueryData } from "@supabase/supabase-js";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { fetchEditLog } from "./editLog";
import { parseTranscriptSegments } from "./media";

function sessionsQuery(userId: string) {
  return supabase
    .from("sessions")
    .select("*, session_problems(id, slug, title, difficulty), posts(id, status)")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(100);
}

export type SessionRow = QueryData<ReturnType<typeof sessionsQuery>>[number];

export function useSessions() {
  const { userId } = useUser();
  return useQuery({
    queryKey: ["sessions", userId],
    queryFn: async () => {
      const { data, error } = await sessionsQuery(userId);
      if (error) throw error;
      return data;
    },
  });
}

/* ------------------------------------------------------------------------------------------- */
/* Session review page: everything is keyed under ["session", id, ...].                        */
/* ------------------------------------------------------------------------------------------- */

export const sessionKey = (id: string) => ["session", id] as const;
export const sessionPostKey = (id: string) => ["session", id, "post"] as const;
export const sessionTranscriptKey = (id: string) => ["session", id, "transcript"] as const;
export const sessionVideoKey = (id: string) => ["session", id, "video"] as const;
export const sessionEditLogKey = (id: string, problemId: string) =>
  ["session", id, "edit-log", problemId] as const;

const SESSION_DETAIL_SELECT =
  "*, session_problems(*, submissions(*)), session_events(t, type)" as const;

function sessionQuery(id: string) {
  return supabase.from("sessions").select(SESSION_DETAIL_SELECT).eq("id", id).maybeSingle();
}

/** A session with its problems and their submissions. */
export type SessionDetail = NonNullable<QueryData<ReturnType<typeof sessionQuery>>>;
export type SessionDetailProblem = SessionDetail["session_problems"][number];

export function useSession(id: string) {
  return useQuery({
    queryKey: sessionKey(id),
    enabled: id.length > 0,
    queryFn: async () => {
      const { data, error } = await sessionQuery(id);
      if (error) throw error;
      return data;
    },
  });
}

const SESSION_POST_SELECT = "id, status, title, video_id, include_ai_insights" as const;

function sessionPostQuery(sessionId: string) {
  return supabase
    .from("posts")
    .select(SESSION_POST_SELECT)
    .eq("session_id", sessionId)
    .maybeSingle();
}

/** The draft/published post the extension created for a session (one per session). */
export type SessionPost = NonNullable<QueryData<ReturnType<typeof sessionPostQuery>>>;

export function useSessionPost(sessionId: string) {
  return useQuery({
    queryKey: sessionPostKey(sessionId),
    enabled: sessionId.length > 0,
    queryFn: async () => {
      const { data, error } = await sessionPostQuery(sessionId);
      if (error) throw error;
      return data;
    },
  });
}

export interface SessionTranscript {
  row: Transcript;
  /** Validated, sorted, non-empty segments (ms relative to media start). */
  segments: TranscriptSegment[];
}

/** Whisper transcript for a session (null when the mic was off / transcription has not run). */
export function useSessionTranscript(sessionId: string) {
  return useQuery({
    queryKey: sessionTranscriptKey(sessionId),
    enabled: sessionId.length > 0,
    queryFn: async (): Promise<SessionTranscript | null> => {
      const { data, error } = await supabase
        .from("transcripts")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error) throw error;
      return data ? { row: data, segments: parseTranscriptSegments(data.segments) } : null;
    },
  });
}

/**
 * Newest `videos` row for a session. Used when the post does not point at a video (e.g. the
 * interview pipeline uploaded but did not get to attach it). Pass `enabled: false` to skip.
 */
export function useLatestSessionVideo(sessionId: string, enabled = true) {
  return useQuery({
    queryKey: sessionVideoKey(sessionId),
    enabled: enabled && sessionId.length > 0,
    queryFn: async (): Promise<Video | null> => {
      const { data, error } = await supabase
        .from("videos")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * One query per problem, in the same order as `problems`. Problems without an `edits_path`
 * get a disabled query (`data` stays undefined). Logs are immutable, so they never go stale.
 */
export function useEditLogs(
  sessionId: string,
  problems: readonly Pick<SessionProblem, "id" | "edits_path">[],
) {
  return useQueries({
    queries: problems.map((p) => ({
      queryKey: sessionEditLogKey(sessionId, p.id),
      enabled: !!p.edits_path,
      staleTime: Number.POSITIVE_INFINITY,
      queryFn: (): Promise<EditLog> => fetchEditLog(p.edits_path ?? ""),
    })),
  });
}
