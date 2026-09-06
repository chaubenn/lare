/**
 * Post-recording pipelines. They orchestrate Rust jobs (thumbnail, export, upload, transcription)
 * with Supabase writes, report progress to the job registry and persist checkpoints in the
 * recording store so an interrupted run can be resumed from the Recordings page.
 *
 *  - publishVideo():        MP4 -> Bunny (create row, upload, thumbnail) -> optionally attach to a post
 *  - processInterview():    studio project -> transcript, rendered MP4, upload, captions, attach
 *  - exportAndPublish():    studio project + edit -> rendered MP4 -> publishVideo()
 */

import type { Database, Json } from "@lare/supabase-types";
import type { PostgrestError } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  type CompletedRecording,
  type CreateUploadResponse,
  DEFAULT_EDIT,
  newJobId,
  type RecorderEvents,
  recorder,
  type StudioEdit,
} from "@/lib/recorder";
import { errorMessage, invokeFunction, supabase } from "@/lib/supabase";
import { createJob, type Job, type JobStage, updateJob } from "./jobs";
import { patchRecordingMeta } from "./recordingStore";

type VideoKind = Database["public"]["Enums"]["video_kind"];

/**
 * Which of a post's two video slots a render belongs to. `main` is the demo video of a practice
 * post and the full take of an interview (`video_id` + `video_kind`); `demo` is the short summary
 * clip an author records about the session, which plays before the full take (`demo_video_id`).
 */
export type VideoSlot = "main" | "demo";

function throwIf(error: PostgrestError | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Subscribe to a progress event for one job id; returns an unlisten function. */
async function onProgress<K extends keyof RecorderEvents>(
  event: K,
  jobId: string,
  handler: (payload: RecorderEvents[K]) => void,
): Promise<() => void> {
  return listen<RecorderEvents[K]>(event, (e) => {
    if ((e.payload as { jobId?: string }).jobId === jobId) handler(e.payload);
  });
}

function stage(job: Job, s: JobStage, detail: string | null = null, percent: number | null = null) {
  updateJob(job.id, { stage: s, detail, percent });
}

export interface PublishVideoOptions {
  job: Job;
  userId: string;
  filePath: string;
  mode: "instant" | "studio";
  title: string;
  sessionId?: string | null;
  /** Draft post to attach the video to. */
  postId?: string | null;
  /** Which slot on that post to fill. Defaults to `main`. */
  slot?: VideoSlot;
  videoKind?: VideoKind;
  /** WebVTT captions to attach on Bunny once uploaded. */
  vtt?: string | null;
  recordingId?: string | null;
}

/**
 * Upload a finished MP4 to Bunny Stream and record it in `videos`. Resolves with the `videos.id`.
 * Safe to call again after a failure: the TUS upload resumes from the server offset.
 */
export async function publishVideo(opts: PublishVideoOptions): Promise<string> {
  const { job, userId, filePath } = opts;
  const rid = opts.recordingId ?? null;

  stage(job, "create", "Registering the video");
  const info = await recorder.mediaInfo(filePath);
  const created = await invokeFunction<CreateUploadResponse>("bunny-create-upload", {
    mode: opts.mode,
    title: opts.title,
    sessionId: opts.sessionId ?? null,
  });
  updateJob(job.id, { videoId: created.videoId });
  if (rid) await patchRecordingMeta(rid, { videoId: created.videoId, error: null });

  throwIf(
    (
      await supabase
        .from("videos")
        .update({
          status: "uploading",
          duration_ms: info.durationMs,
          width: info.width,
          height: info.height,
        })
        .eq("id", created.videoId)
    ).error,
    "videos update",
  );

  // Thumbnail in parallel with the TUS upload — it should not block sending bytes.
  stage(job, "upload", "Uploading to Bunny", 0);
  const thumbPromise = (async (): Promise<string | null> => {
    try {
      const at = Math.min(1000, Math.max(0, (info.durationMs ?? 2000) / 2));
      const jpg = await recorder.makeThumbnail({ videoPath: filePath, atMs: at, maxWidth: 800 });
      const bytes = await recorder.readFileBytes(jpg);
      const objectPath = `${userId}/${created.videoId}.jpg`;
      const { error } = await supabase.storage
        .from("thumbnails")
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
    const result = await recorder.upload({ jobId: job.id, path: filePath, tus: created.tus });
    sizeBytes = result.sizeBytes;
  } finally {
    unlisten();
  }
  const thumbnailPath = await thumbPromise;

  throwIf(
    (
      await supabase
        .from("videos")
        .update({ status: "uploaded", size_bytes: sizeBytes, thumbnail_path: thumbnailPath })
        .eq("id", created.videoId)
    ).error,
    "videos update",
  );
  if (rid) await patchRecordingMeta(rid, { uploaded: true, error: null });

  if (opts.vtt) {
    stage(job, "captions", "Attaching captions");
    try {
      await invokeFunction("bunny-captions", {
        videoId: created.videoId,
        vtt: opts.vtt,
        lang: "en",
      });
    } catch (e) {
      console.warn("captions failed", e);
    }
  }

  if (opts.postId) {
    stage(job, "attach", "Attaching to the post");
    // `video_kind` describes the main video only — a summary clip is always the whole take.
    const patch =
      opts.slot === "demo"
        ? { demo_video_id: created.videoId }
        : { video_id: created.videoId, video_kind: opts.videoKind ?? "full" };
    throwIf(
      (await supabase.from("posts").update(patch).eq("id", opts.postId)).error,
      "posts update",
    );
  }

  stage(job, "done", "Uploaded — Bunny is encoding (this is slower than Loom)");
  return created.videoId;
}

/** Find the draft/published post that belongs to a session (the extension creates it). */
export async function postForSession(
  sessionId: string,
): Promise<{ id: string; video_id: string | null } | null> {
  const { data } = await supabase
    .from("posts")
    .select("id, video_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  return data ?? null;
}

export interface ExportOptions {
  job: Job;
  projectPath: string;
  edit?: StudioEdit;
  recordingId?: string | null;
}

/** Render a studio project with `edit`; returns the MP4 path. */
export async function renderStudio(opts: ExportOptions): Promise<string> {
  const { job } = opts;
  stage(job, "export", "Rendering", 0);
  const unlisten = await onProgress("export:progress", job.id, (p) => {
    const percent = p.total > 0 ? Math.round((p.frame / p.total) * 100) : null;
    updateJob(job.id, { percent, detail: `Rendering ${percent ?? 0}%` });
  });
  try {
    const result = await recorder.exportStudio({
      jobId: job.id,
      projectPath: opts.projectPath,
      edit: opts.edit ?? DEFAULT_EDIT,
      quality: "social",
      fps: 30,
      maxEdge: 1920,
    });
    if (opts.recordingId) await patchRecordingMeta(opts.recordingId, { exportPath: result.output });
    return result.output;
  } finally {
    unlisten();
  }
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
    if (opts.recordingId) await patchRecordingMeta(opts.recordingId, { transcribed: true });
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
  resume?: { transcribed?: boolean; exportPath?: string | null; videoId?: string | null };
}

/**
 * Everything that happens after a mock interview recording stops: align the session with media
 * time, render the studio project (facecam PiP if recorded), transcribe, upload, attach captions
 * and the video to the session's draft post.
 *
 * The facecam is optional, and so is everything downstream of the render: an interview recorded
 * with the facecam unchecked has no camera track, and a project that will not render for any
 * reason must not also cost the author their transcript — which is what the AI review is built
 * from. So the transcript is taken from the render when there is one and from the raw mic track
 * when there is not, and it is saved before a failed render is reported.
 */
export async function processInterview(opts: InterviewOptions): Promise<void> {
  const { recording, userId } = opts;
  const sessionId = recording.sessionId;
  const job = createJob(newJobId("interview"), "interview", "Processing mock interview", {
    recordingId: recording.recordingId,
    sessionId,
  });
  try {
    if (!sessionId) throw new Error("This recording is not linked to a session.");

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

    // Render first: the exported MP4 carries the full mic track across every pause/resume clip,
    // and its clock is the video's clock, so the transcript lines up with playback and captions.
    let output = opts.resume?.exportPath ?? null;
    let renderError: string | null = null;
    if (!output || !(await recorder.pathExists(output))) {
      // Hide the camera whenever no camera track was written, not just when the facecam flag was
      // off: a facecam that failed to open leaves the same project a facecam-off take does.
      const info = await recorder.studioProjectInfo(recording.projectPath).catch(() => null);
      const hideCamera = !recording.facecam || !info?.cameraPath;
      try {
        output = await renderStudio({
          job,
          projectPath: recording.projectPath,
          edit: { ...DEFAULT_EDIT, camera: { ...DEFAULT_EDIT.camera, hide: hideCamera } },
          recordingId: recording.recordingId,
        });
      } catch (e) {
        renderError = errorMessage(e);
        output = null;
      }
    }

    // Prefer the render (one clock for video, captions and transcript); fall back to the raw mic
    // track, which is recorded independently of the camera. The fallback only covers the first
    // clip of a paused recording, so it is a floor, not a replacement.
    const transcribeInput = output ?? recording.micTrack;
    let vtt: string | null = null;
    if (!opts.resume?.transcribed && transcribeInput) {
      try {
        vtt = await transcribeSession({
          job,
          sessionId,
          input: transcribeInput,
          recordingId: recording.recordingId,
        });
      } catch (e) {
        // A missing transcript must not block the video: record and carry on.
        console.warn("transcription failed", e);
        updateJob(job.id, { detail: `Transcription failed: ${errorMessage(e)}` });
      }
    }

    // The transcript is saved by now, so the AI review is available either way; only the video
    // is lost. Retry the render from Recordings.
    if (!output) {
      throw new Error(
        `Rendering the interview video failed: ${renderError ?? "no rendered file"}.${
          vtt ? " The transcript was saved, so the AI review still works." : ""
        }`,
      );
    }

    const post = await postForSession(sessionId);
    await publishVideo({
      job,
      userId,
      filePath: output,
      mode: "studio",
      title: "Mock interview",
      sessionId,
      postId: post && !post.video_id ? post.id : null,
      videoKind: "full",
      vtt,
      recordingId: recording.recordingId,
    });
    await opts.queryClient?.invalidateQueries();
  } catch (e) {
    const message = errorMessage(e);
    updateJob(job.id, { stage: "error", error: message, detail: message });
    await patchRecordingMeta(recording.recordingId, { error: message });
    throw e;
  }
}

export interface DemoPublishOptions {
  recording: CompletedRecording;
  userId: string;
  postId: string | null;
  /** Which video slot on the post to fill. Defaults to `main`. */
  slot?: VideoSlot;
  title: string;
  queryClient?: QueryClient;
}

/** Instant demo: upload `outputMp4` and attach it to the draft. */
export async function publishInstantDemo(opts: DemoPublishOptions): Promise<string> {
  const { recording } = opts;
  const job = createJob(newJobId("publish"), "publish", "Publishing demo video", {
    recordingId: recording.recordingId,
    postId: opts.postId,
  });
  try {
    if (!recording.outputMp4) throw new Error("The recording has no MP4 output.");
    const videoId = await publishVideo({
      job,
      userId: opts.userId,
      filePath: recording.outputMp4,
      mode: "instant",
      title: opts.title,
      postId: opts.postId,
      slot: opts.slot,
      videoKind: "full",
      recordingId: recording.recordingId,
    });
    await opts.queryClient?.invalidateQueries();
    return videoId;
  } catch (e) {
    const message = errorMessage(e);
    updateJob(job.id, { stage: "error", error: message, detail: message });
    await patchRecordingMeta(recording.recordingId, { error: message });
    throw e;
  }
}

export interface StudioPublishOptions {
  recording: Pick<CompletedRecording, "recordingId" | "projectPath" | "sessionId">;
  edit: StudioEdit;
  userId: string;
  postId: string | null;
  /** Which video slot on the post to fill. Defaults to `main`. */
  slot?: VideoSlot;
  title: string;
  videoKind?: VideoKind;
  vtt?: string | null;
  queryClient?: QueryClient;
}

/** Studio: render with the user's edit, then upload and attach. */
export async function exportAndPublish(opts: StudioPublishOptions): Promise<string> {
  const { recording } = opts;
  const job = createJob(newJobId("export"), "export", "Rendering and publishing", {
    recordingId: recording.recordingId,
    postId: opts.postId,
    sessionId: recording.sessionId,
  });
  try {
    const output = await renderStudio({
      job,
      projectPath: recording.projectPath,
      edit: opts.edit,
      recordingId: recording.recordingId,
    });
    const videoId = await publishVideo({
      job,
      userId: opts.userId,
      filePath: output,
      mode: "studio",
      title: opts.title,
      sessionId: recording.sessionId,
      postId: opts.postId,
      slot: opts.slot,
      videoKind: opts.videoKind ?? "full",
      vtt: opts.vtt ?? null,
      recordingId: recording.recordingId,
    });
    await opts.queryClient?.invalidateQueries();
    return videoId;
  } catch (e) {
    const message = errorMessage(e);
    updateJob(job.id, { stage: "error", error: message, detail: message });
    await patchRecordingMeta(recording.recordingId, { error: message });
    throw e;
  }
}
