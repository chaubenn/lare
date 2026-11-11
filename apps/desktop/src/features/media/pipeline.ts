/**
 * What happens to a recording: starting a take for a post, and the pipelines that run once a take
 * is on disk. The pipelines orchestrate Rust jobs (thumbnail, upload, transcription) with Supabase
 * writes, report progress to the job registry and persist checkpoints in the recording store so an
 * interrupted run can be resumed.
 *
 *  - startSlotRecording():  register an upload target, start the recorder, remember the slot
 *  - publishInstantDemo():  demo or summary MP4 -> Bunny, attached to its post
 *  - processInterview():    interview MP4 -> transcript, upload, captions, attached to its draft
 *  - transcribeSession():   transcribe a take again (see `recovery.ts`)
 */

import type { Json } from "@lare/supabase-types";
import type { PostgrestError } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import { BUCKETS, type CreateUploadResponse, edge } from "@/lib/edge";
import { errorMessage } from "@/lib/errors";
import { type CompletedRecording, type RecorderEvents, recorder } from "@/lib/recorder";
import { supabase } from "@/lib/supabase";
import { onTauriEvent } from "@/lib/tauri";
import { createJob, type Job, type JobKind, type JobStage, updateJob } from "./jobs";
import { getRecordingMeta, patchRecordingMeta } from "./recordingStore";
import type { VideoSlot } from "./types";
import { reusableUpload } from "./uploadRules";

function throwIf(error: PostgrestError | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Subscribe to a progress event for one job id; returns an unlisten function. */
function onProgress<K extends "upload:progress" | "transcribe:progress">(
  event: K,
  jobId: string,
  handler: (payload: RecorderEvents[K]) => void,
): Promise<() => void> {
  return onTauriEvent(event, (payload) => {
    if (payload.jobId === jobId) handler(payload);
  });
}

export function stage(
  job: Job,
  s: JobStage,
  detail: string | null = null,
  percent: number | null = null,
) {
  updateJob(job.id, { stage: s, detail, percent });
}

/**
 * Run `work` as one job in the registry. A failure is recorded on the job and against the
 * recording (in `failureField`, which is what offers the retry later), then rethrown.
 */
export async function runJob<T>(
  job: {
    kind: JobKind;
    label: string;
    recordingId: string;
    postId?: string | null;
    sessionId?: string | null;
    failureField: "error" | "transcribeError";
  },
  work: (job: Job) => Promise<T>,
): Promise<T> {
  const entry = createJob(job.kind, job.label, {
    recordingId: job.recordingId,
    postId: job.postId,
    sessionId: job.sessionId,
  });
  try {
    return await work(entry);
  } catch (e) {
    const message = errorMessage(e);
    updateJob(entry.id, { stage: "error", error: message, detail: message });
    await patchRecordingMeta(job.recordingId, { [job.failureField]: message });
    throw e;
  }
}

/** What a slot's video is called on Bunny, where a title is required. */
export function slotTitle(slot: VideoSlot): string {
  return slot === "demo" ? "Summary video" : "Demo video";
}

/**
 * Start recording a take for one of a post's video slots. The upload target is registered first,
 * so the take can be played from the draft before any byte is sent; if the recorder then fails to
 * start, the `videos` row that was just created is deleted again.
 *
 * The recorder only knows which post a take belongs to, so the slot is written to the recording
 * store here and read back when the take finishes (`useRecordingEvents`).
 */
export async function startSlotRecording(take: {
  postId: string;
  slot: VideoSlot;
  facecam: boolean;
  mic: boolean;
}): Promise<void> {
  const upload = await edge.createUpload({ title: slotTitle(take.slot) });
  try {
    const uploadUrl = await recorder.prepareUpload(upload.tus);
    const state = await recorder.start({
      mode: "instant",
      postId: take.postId,
      facecam: take.facecam,
      mic: take.mic,
    });
    if (state.recordingId)
      await patchRecordingMeta(state.recordingId, {
        slot: take.slot,
        upload,
        uploadUrl,
        videoId: upload.videoId,
      });
  } catch (error) {
    await edge.deleteVideo(upload.videoId).catch(() => undefined);
    throw error;
  }
}

interface RegisteredVideo {
  created: CreateUploadResponse;
  /** Upload URL of an earlier attempt at the same target, to resume. */
  resumeUrl: string | undefined;
}

/**
 * The `videos` row and Bunny upload target for a recording: the one already on record for it when
 * it is still usable (a live capture or an earlier attempt), otherwise a new one. Recording the
 * video id against the take is what lets the local preview play before any byte is uploaded.
 */
async function registerVideo(opts: {
  job: Job;
  filePath: string;
  title: string;
  sessionId?: string | null;
  recordingId: string;
}): Promise<RegisteredVideo> {
  const { job, filePath, recordingId } = opts;
  stage(job, "create", "Registering the video");
  const meta = await getRecordingMeta(recordingId);
  const reusable = reusableUpload(meta, filePath, Date.now());
  const created =
    reusable ?? (await edge.createUpload({ title: opts.title, sessionId: opts.sessionId ?? null }));
  updateJob(job.id, { videoId: created.videoId });
  await patchRecordingMeta(recordingId, {
    videoId: created.videoId,
    upload: created,
    uploadUrl: reusable ? meta?.uploadUrl : undefined,
    uploadPath: filePath,
    uploaded: false,
    error: null,
  });
  // An expired target was replaced: the old row never got bytes, so it must not linger on a draft.
  if (!reusable && meta?.videoId && meta.videoId !== created.videoId && !meta.uploaded)
    void edge.deleteVideo(meta.videoId).catch(() => undefined);
  return { created, resumeUrl: reusable ? meta?.uploadUrl : undefined };
}

async function attachVideo(postId: string, slot: VideoSlot, videoId: string): Promise<void> {
  // `video_kind` describes the main video only; a summary clip is always the whole take.
  const patch =
    slot === "demo"
      ? { demo_video_id: videoId }
      : { video_id: videoId, video_kind: "full" as const };
  throwIf((await supabase.from("posts").update(patch).eq("id", postId)).error, "posts update");
}

interface PublishVideoOptions {
  job: Job;
  userId: string;
  filePath: string;
  /**
   * The video's row and upload target when the caller registered it already; otherwise the title
   * to register it under.
   */
  video: RegisteredVideo | { title: string };
  /** Draft post to attach the video to, and which of its slots to fill. */
  attachTo?: { postId: string; slot: VideoSlot } | null;
  /** WebVTT captions to attach on Bunny once uploaded. */
  vtt?: string | null;
  recordingId: string;
  /** Called once the video is on the post, before the upload, so the UI can show the preview. */
  onAttached?: () => Promise<unknown> | undefined;
}

/**
 * Upload a finished MP4 to Bunny Stream and record it in `videos`. Resolves with the `videos.id`.
 * Safe to run again after a failure: the TUS upload resumes from the server offset.
 *
 * The video is attached to the post before the upload starts, so the draft shows the local copy
 * straight away; the post stays pending (visible only to its author) until Bunny has processed it.
 */
async function publishVideo(opts: PublishVideoOptions): Promise<string> {
  const { job, userId, filePath } = opts;

  const info = await recorder.mediaInfo(filePath);
  const { created, resumeUrl } =
    "created" in opts.video
      ? opts.video
      : await registerVideo({
          job,
          filePath,
          title: opts.video.title,
          recordingId: opts.recordingId,
        });
  if (opts.attachTo) {
    stage(job, "attach", "Attaching to the post");
    await attachVideo(opts.attachTo.postId, opts.attachTo.slot, created.videoId);
    await opts.onAttached?.();
  }

  // Provisional values from the local file so the draft can lay the video out while it uploads;
  // Bunny's values replace them once it is ready. The status is the server's (0033).
  throwIf(
    (
      await supabase
        .from("videos")
        .update({
          duration_ms: info.durationMs,
          width: info.width,
          height: info.height,
        })
        .eq("id", created.videoId)
    ).error,
    "videos update",
  );

  // Thumbnail in parallel with the TUS upload: it should not block sending bytes.
  stage(job, "upload", "Uploading to Bunny", 0);
  const thumbPromise = (async (): Promise<string | null> => {
    try {
      const at = Math.min(1000, Math.max(0, (info.durationMs ?? 2000) / 2));
      const jpg = await recorder.makeThumbnail({ videoPath: filePath, atMs: at, maxWidth: 800 });
      const bytes = await recorder.readFileBytes(jpg);
      const objectPath = `${userId}/${created.videoId}.jpg`;
      const { error } = await supabase.storage
        .from(BUCKETS.thumbnails)
        .upload(objectPath, bytes, { contentType: "image/jpeg", upsert: true });
      return error ? null : objectPath;
    } catch (e) {
      console.warn("thumbnail failed", e);
      return null;
    }
  })();

  const unlisten = await onProgress("upload:progress", job.id, (p) => {
    const percent = p.total > 0 ? Math.round((p.uploaded / p.total) * 100) : null;
    updateJob(job.id, { percent, detail: `Uploading ${percent ?? 0}%` });
  });
  let sizeBytes: number;
  try {
    const result = await recorder.upload({
      jobId: job.id,
      path: filePath,
      tus: created.tus,
      resumeUrl,
    });
    sizeBytes = result.sizeBytes;
  } finally {
    unlisten();
  }
  const thumbnailPath = await thumbPromise;

  // A TUS offset is not a cloud receipt. Never discard the source on a failed finalization.
  await edge.finalizeRecording({
    videoId: created.videoId,
    sizeBytes,
    durationMs: info.durationMs ?? 0,
  });

  throwIf(
    (
      await supabase
        .from("videos")
        .update({ size_bytes: sizeBytes, thumbnail_path: thumbnailPath })
        .eq("id", created.videoId)
    ).error,
    "videos update",
  );

  if (opts.vtt) {
    stage(job, "captions", "Attaching captions");
    try {
      await edge.captions(created.videoId, opts.vtt);
    } catch (e) {
      console.warn("captions failed", e);
    }
  }

  // The take stays on this device as a preview until Bunny has processed it; `localCopies.ts`
  // removes it once the video is ready.
  await patchRecordingMeta(opts.recordingId, { uploaded: true, error: null });
  stage(job, "done", "Upload confirmed; playback becomes available as Bunny encodes");
  return created.videoId;
}

/**
 * The draft/published post that belongs to a session (the extension creates it). A failed lookup
 * reads the same as "no post yet".
 */
async function postForSession(
  sessionId: string,
): Promise<{ id: string; video_id: string | null } | null> {
  const { data } = await supabase
    .from("posts")
    .select("id, video_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  return data ?? null;
}

export interface TranscribeOptions {
  job: Job;
  sessionId: string;
  input: string;
  recordingId?: string | null;
}

/** Transcribe a media file with whisper and upsert `transcripts`; returns the WebVTT text. */
export async function transcribeSession(opts: TranscribeOptions): Promise<string> {
  const { job } = opts;
  stage(job, "transcribe", "Preparing speech model", 0);
  const unlisten = await onProgress("transcribe:progress", job.id, (p) => {
    if (p.stage === "download") {
      const percent = p.total ? Math.round((p.received / p.total) * 100) : null;
      updateJob(job.id, { percent, detail: `Downloading speech model ${percent ?? 0}%` });
    } else if (p.stage === "decoding") {
      updateJob(job.id, { percent: null, detail: "Decoding audio" });
    } else {
      updateJob(job.id, { percent: p.percent, detail: `Transcribing ${p.percent}%` });
    }
  });
  try {
    const result = await recorder.transcribe({ jobId: job.id, input: opts.input });
    throwIf(
      (
        await supabase.from("transcripts").upsert(
          {
            session_id: opts.sessionId,
            model: `whisper.cpp ${result.model}`,
            language: "en",
            segments: result.segments as unknown as Json,
          },
          { onConflict: "session_id" },
        )
      ).error,
      "transcripts upsert",
    );
    if (opts.recordingId)
      await patchRecordingMeta(opts.recordingId, { transcribed: true, transcribeError: null });
    return result.vtt;
  } finally {
    unlisten();
  }
}

export interface InterviewOptions {
  recording: CompletedRecording;
  userId: string;
  queryClient?: QueryClient;
  /** Skip steps already completed in an earlier attempt. */
  resume?: { transcribed?: boolean };
}

/**
 * Everything that happens after a mock interview recording stops: align the session with media
 * time, transcribe the recording, upload it, attach captions and the video to the session's post.
 *
 * The recording is an instant MP4 (screen, microphone, and the camera bubble when it was on), so
 * there is nothing to render. A failed transcription does not cost the author the video: the
 * session is marked ungraded and the upload carries on.
 */
export function processInterview(opts: InterviewOptions): Promise<void> {
  const { recording, userId } = opts;
  const sessionId = recording.sessionId;
  return runJob(
    {
      kind: "interview",
      label: "Processing mock interview",
      recordingId: recording.recordingId,
      sessionId,
      failureField: "error",
    },
    async (job) => {
      if (!sessionId) throw new Error("This recording is not linked to a session.");
      const output = recording.outputMp4;
      if (!output) throw new Error("The interview recording has no video file.");

      // Media time zero for transcript/edit alignment (owner update, RLS).
      throwIf(
        (
          await supabase
            .from("sessions")
            .update({
              recording_started_at: new Date(recording.startedAt).toISOString(),
              recording_id: recording.recordingId,
            })
            .eq("id", sessionId)
        ).error,
        "sessions update",
      );

      // Register the video and put it on the draft first: the recording is already on disk, so the
      // author can watch it while it is transcribed and uploaded.
      const registered = await registerVideo({
        job,
        filePath: output,
        title: "Mock interview",
        sessionId,
        recordingId: recording.recordingId,
      });
      const videoId = registered.created.videoId;
      // The extension creates the draft when the interview ends, which can land just after this.
      const attachToDraft = async (): Promise<boolean> => {
        const post = await postForSession(sessionId);
        if (!post || (post.video_id && post.video_id !== videoId)) return false;
        if (!post.video_id) await attachVideo(post.id, "main", videoId);
        return true;
      };
      const attached = await attachToDraft();
      // Keyless on purpose: the draft, the session page, the lists and the video row all show it.
      if (attached) await opts.queryClient?.invalidateQueries();

      // The author chose "video only" in the extension: no transcript, so no AI review either.
      const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .select("graded")
        .eq("id", sessionId)
        .maybeSingle();
      throwIf(sessionError, "sessions select");
      const graded = session?.graded ?? true;

      let vtt: string | null = null;
      if (graded && !opts.resume?.transcribed) {
        try {
          vtt = await transcribeSession({
            job,
            sessionId,
            input: output,
            recordingId: recording.recordingId,
          });
        } catch (e) {
          // A missing transcript must not block the video: mark the interview ungraded and carry
          // on. The failure is remembered so the session page can offer to transcribe it again.
          console.warn("transcription failed", e);
          updateJob(job.id, { detail: `Transcription failed: ${errorMessage(e)}` });
          await patchRecordingMeta(recording.recordingId, { transcribeError: errorMessage(e) });
          await supabase.from("sessions").update({ graded: false }).eq("id", sessionId);
        }
      }

      await publishVideo({
        job,
        userId,
        filePath: output,
        // Registered above. Asking again here would mint a second `videos` row whenever the
        // recording store failed to keep the first, leaving the draft on a row with no bytes.
        video: registered,
        vtt,
        recordingId: recording.recordingId,
      });
      if (!attached) await attachToDraft();
      await opts.queryClient?.invalidateQueries();
    },
  );
}

export interface DemoPublishOptions {
  recording: CompletedRecording;
  userId: string;
  postId: string | null;
  /** Which video slot on the post to fill. */
  slot: VideoSlot;
  title: string;
  queryClient?: QueryClient;
}

/** Instant demo: upload `outputMp4` and attach it to the draft. */
export function publishInstantDemo(opts: DemoPublishOptions): Promise<string> {
  const { recording } = opts;
  return runJob(
    {
      kind: "publish",
      label: "Publishing demo video",
      recordingId: recording.recordingId,
      postId: opts.postId,
      failureField: "error",
    },
    async (job) => {
      if (!recording.outputMp4) throw new Error("The recording has no MP4 output.");
      const videoId = await publishVideo({
        job,
        userId: opts.userId,
        filePath: recording.outputMp4,
        video: { title: opts.title },
        attachTo: opts.postId ? { postId: opts.postId, slot: opts.slot } : null,
        recordingId: recording.recordingId,
        onAttached: () => opts.queryClient?.invalidateQueries(),
      });
      await opts.queryClient?.invalidateQueries();
      return videoId;
    },
  );
}
