import type { EditLog, TranscriptSegment } from "@lare/shared";
import type { SessionProblem, Transcript, Video } from "@lare/supabase-types";
import type { QueryData } from "@supabase/supabase-js";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { type KeysetCursor, keysetFilter, nextCursor } from "@/lib/keyset";
import { whileOnline } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";
import { fetchEditLog } from "./editLog";
import { parseTranscriptSegments } from "./media";

const SESSIONS_PAGE_SIZE = 50;

function sessionsQuery(userId: string, cursor?: KeysetCursor) {
  let query = supabase
    .from("sessions")
    .select("*, session_problems(id, slug, title, difficulty), posts(id, status)")
    .eq("user_id", userId);
  if (cursor) query = query.or(keysetFilter("started_at", cursor));
  return query
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(SESSIONS_PAGE_SIZE);
}

export type SessionRow = QueryData<ReturnType<typeof sessionsQuery>>[number];

/** Newest first, a page at a time; `data` is every page loaded so far, flattened. */
export function useSessions() {
  const { userId } = useUser();
  return useInfiniteQuery({
    queryKey: queryKeys.sessions.of(userId),
    initialPageParam: undefined as KeysetCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await sessionsQuery(userId, pageParam);
      if (error) throw error;
      return { items: data, next: nextCursor(data, SESSIONS_PAGE_SIZE, (row) => row.started_at) };
    },
    getNextPageParam: (lastPage) => lastPage.next,
    select: (data) => data.pages.flatMap((page) => page.items),
  });
}

const SESSION_DETAIL_SELECT =
  "*, session_problems(*, submissions(*)), session_events(t, type)" as const;

function sessionQuery(id: string, userId: string) {
  return supabase
    .from("sessions")
    .select(SESSION_DETAIL_SELECT)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
}

/** A session with its problems and their submissions. */
export type SessionDetail = NonNullable<QueryData<ReturnType<typeof sessionQuery>>>;

export function useSession(id: string) {
  const { userId } = useUser();
  return useQuery({
    queryKey: queryKeys.session.detail(id, userId),
    enabled: id.length > 0,
    refetchInterval: (query) => (query.state.data?.status === "active" ? 3000 : false),
    queryFn: async () => {
      const { data, error } = await sessionQuery(id, userId);
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

export function useSessionPost(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.session.post(sessionId),
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
    queryKey: queryKeys.session.transcript(sessionId),
    enabled: sessionId.length > 0,
    refetchInterval: whileOnline(5000),
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
    queryKey: queryKeys.session.video(sessionId),
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
      queryKey: queryKeys.session.editLog(sessionId, p.id),
      enabled: !!p.edits_path,
      staleTime: Number.POSITIVE_INFINITY,
      queryFn: (): Promise<EditLog> => fetchEditLog(p.edits_path ?? ""),
    })),
  });
}

/** The viewer's own AI review criteria, or null when they have not written any (the default applies). */
export function useReviewCriteria() {
  const { userId } = useUser();
  return useQuery({
    queryKey: queryKeys.reviewCriteria.of(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("review_criteria")
        .select("criteria")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data?.criteria ?? null;
    },
  });
}

export function useSaveReviewCriteria() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (criteria: string) => {
      const { error } = await supabase
        .from("review_criteria")
        .upsert({ user_id: userId, criteria });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviewCriteria.all }),
  });
}

/** Drop the viewer's criteria so reviews go back to the built-in default. */
export function useResetReviewCriteria() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("review_criteria").delete().eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviewCriteria.all }),
  });
}
