import { type CreateUploadResponse, DeferredTusUpload } from "#tus";

export { type CreateUploadResponse, DeferredTusUpload, type TusCredentials } from "#tus";

export interface CaptureProgress {
  uploadedBytes: number;
  recordedBytes: number;
}
export interface CaptureResult {
  videoId: string;
  uploadUrl: string;
  sizeBytes: number;
  durationMs: number;
}
export interface CaptureOptions {
  stream: MediaStream;
  createUpload: (input: { mimeType: string }) => Promise<CreateUploadResponse>;
  finalizeUpload: (input: {
    videoId: string;
    sizeBytes: number;
    durationMs: number;
  }) => Promise<void>;
  mimeType?: string;
  /** Video bitrate for MediaRecorder. Its default suits a webcam, not screen text. */
  videoBitsPerSecond?: number;
  timesliceMs?: number;
  /** Limits pending disk writes and memory fallback. Exceeding this stops capture, never drops silently. */
  maxMemoryBytes?: number;
  onProgress?: (progress: CaptureProgress) => void;
  onError?: (error: Error) => void;
  /** Every recorded chunk, in order, for a caller that keeps its own local copy (e.g. a preview). */
  onChunk?: (chunk: Blob) => void;
}
export interface CaptureSession {
  videoId: string;
  mimeType: string;
  pause(): void;
  resume(): void;
  stop(): Promise<CaptureResult>;
  retry(): Promise<CaptureResult>;
  /** Explicitly deletes retained local chunks. Caller separately deletes the cloud video if desired. */
  discard(): Promise<void>;
}

export function preferredMimeType(): string {
  if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder is unavailable");
  const mime = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ].find((value) => MediaRecorder.isTypeSupported(value));
  if (!mime) throw new Error("No supported recording format");
  return mime;
}

/** Caller owns track lifetimes. Keep the document alive until stop/retry succeeds. */
export async function startCapture(options: CaptureOptions): Promise<CaptureSession> {
  const timesliceMs = options.timesliceMs ?? 2000;
  const maxMemoryBytes = options.maxMemoryBytes ?? 128 * 1024 * 1024;
  if (
    !Number.isSafeInteger(timesliceMs) ||
    timesliceMs <= 0 ||
    !Number.isSafeInteger(maxMemoryBytes) ||
    maxMemoryBytes <= 0
  ) {
    throw new Error("Capture timeslice and memory limit must be positive integers");
  }
  const mimeType = options.mimeType ?? preferredMimeType();
  const recorder = new MediaRecorder(options.stream, {
    mimeType,
    ...(options.videoBitsPerSecond ? { videoBitsPerSecond: options.videoBitsPerSecond } : {}),
  });
  const credentials = await options.createUpload({ mimeType });
  credentials.tus.metadata.filetype = mimeType;
  const tus = await DeferredTusUpload.create(credentials.tus);
  let directory: FileSystemDirectoryHandle | undefined;
  let root: FileSystemDirectoryHandle | undefined;
  const directoryName = `lare-capture-${credentials.videoId}-${crypto.randomUUID()}`;
  try {
    root = await navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle(directoryName, { create: true });
  } catch {
    /* OPFS is not available in every browser/privacy mode. */
  }
  const queue: { start: number; size: number; name: string; blob?: Blob }[] = [];
  let recordedBytes = 0;
  let memoryBytes = 0;
  let writes = Promise.resolve();
  let pumping: Promise<void> | undefined;
  let uploadError: Error | undefined;
  let captureError: Error | undefined;
  let discarded = false;
  let stopped = false;
  let stopPromise: Promise<CaptureResult> | undefined;
  let durationMs = 0;
  let pausedAt: number | undefined;
  let pausedMs = 0;
  const started = performance.now();
  let resolveStopped: () => void = () => {};
  const recorderStopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const report = (error: unknown): Error => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    try {
      options.onError?.(normalized);
    } catch {
      /* Observers cannot interrupt capture. */
    }
    return normalized;
  };
  const progress = () => {
    try {
      options.onProgress?.({ uploadedBytes: tus.offset, recordedBytes });
    } catch {
      /* Observer only. */
    }
  };
  const pump = (): Promise<void> => {
    if (pumping) return pumping;
    pumping = (async () => {
      while (queue.length && !discarded) {
        const chunk = queue[0];
        if (!chunk) break;
        let blob = chunk.blob;
        if (!blob) {
          if (!directory) throw new Error("Capture spill directory is missing");
          blob = await (await directory.getFileHandle(chunk.name)).getFile();
        }
        await tus.append(blob, chunk.start);
        if (chunk.blob) memoryBytes -= chunk.size;
        else if (directory) await directory.removeEntry(chunk.name);
        queue.shift();
        progress();
      }
    })().finally(() => {
      pumping = undefined;
    });
    return pumping;
  };
  recorder.ondataavailable = (event) => {
    if (!event.data.size || discarded) return;
    const blob = event.data;
    options.onChunk?.(blob);
    const start = recordedBytes;
    recordedBytes += blob.size;
    memoryBytes += blob.size;
    if (memoryBytes > maxMemoryBytes && !captureError) {
      captureError = report(
        new Error(
          "Capture spill buffer exhausted; recording stopped. Retained data can be discarded, not published as complete.",
        ),
      );
      if (recorder.state !== "inactive") recorder.stop();
    }
    writes = writes
      .then(async () => {
        const chunk = {
          start,
          size: blob.size,
          name: String(start),
          blob: undefined as Blob | undefined,
        };
        if (directory) {
          try {
            const file = await directory.getFileHandle(chunk.name, { create: true });
            const writer = await file.createWritable();
            try {
              await writer.write(blob);
              await writer.close();
            } catch (error) {
              await writer.abort().catch(() => {});
              throw error;
            }
            memoryBytes -= blob.size;
          } catch (error) {
            // Keep the failed write in memory and stop before storage pressure loses more frames.
            chunk.blob = blob;
            captureError ??= report(error);
            if (recorder.state !== "inactive") recorder.stop();
          }
        } else chunk.blob = blob;
        queue.push(chunk);
        progress();
        if (!discarded)
          void pump()
            .then(() => {
              uploadError = undefined;
            })
            .catch((error) => {
              if (!uploadError) uploadError = report(error);
            });
      })
      .catch((error) => {
        captureError ??= report(error);
        if (recorder.state !== "inactive") recorder.stop();
      });
  };
  recorder.onerror = () => {
    captureError ??= report(new Error("MediaRecorder failed; recording may be incomplete"));
    if (recorder.state !== "inactive") recorder.stop();
  };
  recorder.onstop = () => {
    const now = performance.now();
    durationMs = Math.max(
      0,
      Math.round(now - started - pausedMs - (pausedAt === undefined ? 0 : now - pausedAt)),
    );
    stopped = true;
    resolveStopped();
  };
  async function finish(): Promise<CaptureResult> {
    if (discarded) throw new Error("Capture was discarded");
    if (recorder.state !== "inactive") recorder.stop();
    await recorderStopped;
    await writes;
    await pumping?.catch(() => {});
    if (captureError) throw captureError;
    uploadError = undefined;
    await pump();
    if (discarded) throw new Error("Capture was discarded");
    if (!recordedBytes) throw new Error("Recording contains no media bytes");
    await tus.append(new Blob([]), recordedBytes, recordedBytes);
    const result = {
      videoId: credentials.videoId,
      uploadUrl: tus.url,
      sizeBytes: recordedBytes,
      durationMs,
    };
    for (let attempt = 0; ; attempt++) {
      if (discarded) throw new Error("Capture was discarded");
      try {
        await options.finalizeUpload(result);
        break;
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    if (directory && root) await root.removeEntry(directoryName, { recursive: true });
    directory = undefined;
    return result;
  }
  recorder.start(timesliceMs);
  return {
    videoId: credentials.videoId,
    mimeType,
    pause() {
      if (recorder.state !== "recording") return;
      recorder.pause();
      pausedAt = performance.now();
    },
    resume() {
      if (recorder.state !== "paused") return;
      recorder.resume();
      if (pausedAt !== undefined) pausedMs += performance.now() - pausedAt;
      pausedAt = undefined;
    },
    stop() {
      stopPromise ??= finish();
      return stopPromise;
    },
    retry() {
      if (!stopped) return Promise.reject(new Error("Stop recording before retrying"));
      stopPromise = (stopPromise ?? Promise.resolve(undefined))
        .catch(() => undefined)
        .then(() => finish());
      return stopPromise;
    },
    async discard() {
      discarded = true;
      if (recorder.state !== "inactive") recorder.stop();
      await recorderStopped;
      await writes;
      await pumping?.catch(() => {});
      await stopPromise?.catch(() => {});
      if (directory && root) await root.removeEntry(directoryName, { recursive: true });
      queue.length = 0;
    },
  };
}
