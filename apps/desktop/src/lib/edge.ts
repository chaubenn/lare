/**
 * The Edge Functions and storage buckets the desktop app talks to, one typed call per function.
 * The request bodies are the functions' contract (`supabase/functions/<name>/index.ts`); the same
 * functions serve the website and older desktop builds.
 */

import type { TusCredentials } from "./recorder";
import { invokeFunction, supabase } from "./supabase";

/** Private buckets read or written here. Post images and avatars are named in `@lare/shared`. */
export const BUCKETS = {
  /** Video posters, `{userId}/{videoId}.jpg`. */
  thumbnails: "thumbnails",
  /** Monaco edit logs the extension uploads at session end. */
  sessionData: "session-data",
} as const;

/** Response of `bunny-create-upload`: the new `videos` row and where to send its bytes. */
export interface CreateUploadResponse {
  videoId: string;
  bunnyVideoId: string;
  libraryId: number;
  tus: TusCredentials;
}

/** Response of `bunny-playback-token`. */
export interface PlaybackToken {
  embedUrl: string;
  token: string;
  /** When the token stops being accepted, in epoch seconds. */
  expires: number;
}

/**
 * `bunny-finalize-recording` answers 409 until Bunny confirms it received the upload (or when the
 * row's status moved under it), which a retry a moment later gets past.
 */
const FINALIZE_ATTEMPTS = 5;
const FINALIZE_BACKOFF_MS = 1000;

export const edge = {
  /**
   * Register a video and get its upload target. `sessionId` is sent only when given: `null` says
   * "no session", leaving it out says nothing.
   */
  createUpload: (video: { title: string; sessionId?: string | null }) =>
    invokeFunction<CreateUploadResponse>("bunny-create-upload", {
      mode: "instant",
      title: video.title,
      ...(video.sessionId !== undefined ? { sessionId: video.sessionId } : {}),
      captureSource: "desktop",
      mimeType: "video/mp4",
    }),

  /** Confirm every byte arrived. Throws the function's own error once the retries run out. */
  async finalizeRecording(video: {
    videoId: string;
    sizeBytes: number;
    durationMs: number;
  }): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      // Not `invokeFunction`: the retry depends on the response status, which it hides.
      const { error } = await supabase.functions.invoke("bunny-finalize-recording", {
        body: video,
      });
      if (!error) return;
      const status = (error as { context?: Response }).context?.status;
      if (status !== 409 || attempt >= FINALIZE_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, FINALIZE_BACKOFF_MS * (attempt + 1)));
    }
  },

  /** Attach English WebVTT captions to an uploaded video. */
  captions: (videoId: string, vtt: string) =>
    invokeFunction<unknown>("bunny-captions", { videoId, vtt, lang: "en" }),

  /** Delete a video from Bunny and its `videos` row; posts pointing at it lose the video. */
  deleteVideo: (videoId: string) => invokeFunction<unknown>("video-delete", { videoId }),

  playbackToken: (videoId: string) =>
    invokeFunction<PlaybackToken>("bunny-playback-token", { videoId }),

  /** Generate the AI review of a session; `force` replaces an existing one. */
  aiReview: (sessionId: string, force: boolean) =>
    invokeFunction<unknown>("ai-review", force ? { sessionId, force: true } : { sessionId }),
};
