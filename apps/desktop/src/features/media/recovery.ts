/**
 * Interview recordings whose pipeline never finished, and the actions that finish or drop them.
 *
 * `processInterview` only starts from the `recording:completed` event. A take recovered after a
 * crash or force-quit never gets that event, and a run that failed part-way (offline, an expired
 * upload) leaves its take on disk with nothing to restart it. Both show up here, from the
 * recordings on this device plus the local bookkeeping in `recordingStore.ts`.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import { edge } from "@/lib/edge";
import { queryKeys, refresh } from "@/lib/queryKeys";
import { recorder } from "@/lib/recorder";
import { supabase } from "@/lib/supabase";
import { type RecordingWithMeta, useRecordings } from "./hooks";
import { isActive, useJobs } from "./jobs";
import { processInterview, runJob, stage, transcribeSession } from "./pipeline";
import { deleteRecordingMeta, getRecordingMeta, patchRecordingMeta } from "./recordingStore";

/** Recording ids a running job is working on, so a take mid-pipeline is not offered twice. */
function useBusyRecordings(): Set<string> {
  const jobs = useJobs();
  return new Set(
    jobs.filter(isActive).flatMap((job) => (job.recordingId ? [job.recordingId] : [])),
  );
}

/**
 * Interview takes on this device that never finished uploading, newest first. Pass a session id
 * to only get that session's.
 */
export function useUnfinishedInterviews(sessionId?: string) {
  const recordings = useRecordings();
  const busy = useBusyRecordings();
  const list = (recordings.data ?? []).filter(
    (r) =>
      r.purpose === "interview" &&
      r.outputMp4 !== null &&
      !r.uploaded &&
      !busy.has(r.recordingId) &&
      (sessionId === undefined || r.sessionId === sessionId),
  );
  return { list, isPending: recordings.isPending };
}

/**
 * This session's take whose transcription failed, while the file to transcribe is still here.
 * `null` when there is none (or it is being worked on).
 */
export function useFailedTranscription(sessionId: string): RecordingWithMeta | null {
  const recordings = useRecordings();
  const busy = useBusyRecordings();
  return (
    (recordings.data ?? []).find(
      (r) =>
        r.purpose === "interview" &&
        r.sessionId === sessionId &&
        r.outputMp4 !== null &&
        r.transcribeError !== null &&
        !busy.has(r.recordingId),
    ) ?? null
  );
}

/** Retry, Discard, Retry transcription and Keep as video only, bound to the signed-in user. */
export function useRecoveryActions() {
  const { userId } = useUser();
  const queryClient = useQueryClient();

  /** Pick the interview pipeline up where it stopped: steps already done are skipped. */
  const retryUpload = async (recording: RecordingWithMeta) => {
    const meta = await getRecordingMeta(recording.recordingId);
    try {
      await processInterview({
        recording,
        userId,
        queryClient,
        resume: { transcribed: meta?.transcribed ?? false },
      });
    } finally {
      void refresh.recordings(queryClient);
    }
  };

  /**
   * Delete the take from this device. Its `videos` row never got every byte, so it goes too,
   * rather than leaving a draft pointing at a video that will never play.
   */
  const discard = async (recording: RecordingWithMeta) => {
    if (recording.videoId && !recording.uploaded)
      await edge.deleteVideo(recording.videoId).catch(() => undefined);
    await recorder.delete(recording.recordingId);
    await deleteRecordingMeta(recording.recordingId);
    void refresh.recordings(queryClient);
    void queryClient.invalidateQueries({ queryKey: queryKeys.session.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.draft.all });
  };

  /**
   * Transcribe the local take again. On success the session becomes gradable, and the captions
   * go on the video when it is already uploaded.
   */
  const retryTranscription = async (recording: RecordingWithMeta) => {
    const sessionId = recording.sessionId;
    const input = recording.outputMp4;
    if (!sessionId || !input) throw new Error("This recording has no session or video file.");
    const videoId = recording.uploaded ? recording.videoId : null;
    try {
      await runJob(
        {
          kind: "transcribe",
          label: "Transcribing interview",
          recordingId: recording.recordingId,
          sessionId,
          failureField: "transcribeError",
        },
        async (job) => {
          const vtt = await transcribeSession({
            job,
            sessionId,
            input,
            recordingId: recording.recordingId,
          });
          const { error } = await supabase
            .from("sessions")
            .update({ graded: true })
            .eq("id", sessionId);
          if (error) throw new Error(`sessions update: ${error.message}`);
          if (videoId) {
            stage(job, "captions", "Attaching captions");
            try {
              await edge.captions(videoId, vtt);
            } catch (e) {
              // Captions are a nicety; the transcript is what grading needs.
              console.warn("captions failed", e);
            }
          }
          stage(job, "done", "Transcript saved. You can generate the AI review now.");
        },
      );
    } finally {
      void refresh.recordings(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.session.of(sessionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviewReview(sessionId) });
    }
  };

  /** Stop offering to transcribe; the take can then be cleaned up like any other. */
  const keepVideoOnly = async (recording: RecordingWithMeta) => {
    await patchRecordingMeta(recording.recordingId, { transcribeError: null });
    void refresh.recordings(queryClient);
  };

  return { retryUpload, discard, retryTranscription, keepVideoOnly };
}
