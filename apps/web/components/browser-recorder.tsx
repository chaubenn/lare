"use client";

import { type CaptureSession, preferredMimeType, startCapture } from "@lare/capture";
import { Button, Card } from "@lare/ui/primitives";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function BrowserRecorder({
  title,
  sessionId,
  onComplete,
  onBusy,
}: {
  title: string;
  sessionId: string | null;
  onComplete: (videoId: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const capture = useRef<CaptureSession | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const mixer = useRef<AudioContext | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const finishing = useRef(false);
  const mounted = useRef(false);
  const [state, setState] = useState<
    "idle" | "starting" | "recording" | "uploading" | "failed" | "done"
  >("idle");
  const [source, setSource] = useState<"screen" | "camera">("screen");
  const [mic, setMic] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ uploadedBytes: 0, recordedBytes: 0 });
  const busy = !["idle", "done"].includes(state);

  function releaseTracks() {
    for (const stream of streams.current) for (const track of stream.getTracks()) track.stop();
    streams.current = [];
    void mixer.current?.close();
    mixer.current = null;
    if (preview.current) preview.current.srcObject = null;
  }

  useEffect(() => {
    if (!busy) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) {
        event.preventDefault();
        event.stopPropagation();
        setError(
          "Finish uploading or explicitly discard this recording before leaving. Keep this tab open to preserve buffered video.",
        );
      }
    };
    const submit = (event: SubmitEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setError("Finish or discard the recording before signing out or submitting another action.");
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    document.addEventListener("submit", submit, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
      document.removeEventListener("submit", submit, true);
    };
  }, [busy]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Browser back/unmount cannot guarantee delivery, but must always release camera and mic.
      void capture.current?.stop().catch(() => {});
      for (const stream of streams.current) for (const track of stream.getTracks()) track.stop();
      void mixer.current?.close();
    };
  }, []);

  async function finish(retry = false) {
    if (!capture.current || finishing.current) return;
    finishing.current = true;
    setState("uploading");
    setError(null);
    const result = retry ? capture.current.retry() : capture.current.stop();
    releaseTracks();
    try {
      const video = await result;
      capture.current = null;
      setState("done");
      onComplete(video.videoId);
      onBusy(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Upload failed. Keep this tab open and retry.",
      );
      setState("failed");
    } finally {
      finishing.current = false;
    }
  }

  async function start() {
    setError(null);
    setState("starting");
    setProgress({ uploadedBytes: 0, recordedBytes: 0 });
    onBusy(true);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices)
        throw new Error("Recording needs a supported browser on HTTPS (or localhost).");
      const mimeType = preferredMimeType();
      const display =
        source === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getUserMedia({ video: true, audio: mic });
      streams.current.push(display);
      if (!mounted.current) throw new Error("Recording page was closed.");
      let stream = display;
      if (source === "screen" && mic) {
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
        streams.current.push(microphone);
        if (!mounted.current) throw new Error("Recording page was closed.");
        const context = new AudioContext();
        mixer.current = context;
        await context.resume();
        const destination = context.createMediaStreamDestination();
        if (display.getAudioTracks().length)
          context.createMediaStreamSource(display).connect(destination);
        context.createMediaStreamSource(microphone).connect(destination);
        stream = new MediaStream([
          ...display.getVideoTracks(),
          ...destination.stream.getAudioTracks(),
        ]);
        streams.current.push(stream);
      }
      if (preview.current) preview.current.srcObject = stream;
      const supabase = createClient();
      capture.current = await startCapture({
        stream,
        mimeType,
        createUpload: async ({ mimeType }) => {
          const { data, error } = await supabase.functions.invoke("bunny-create-upload", {
            body: {
              mode: "instant",
              title: title || "Web recording",
              ...(sessionId ? { sessionId } : {}),
              captureSource: "web",
              mimeType,
            },
          });
          if (error) throw error;
          if (!data?.videoId || !data?.tus)
            throw new Error("The upload service returned an invalid recording target.");
          return data;
        },
        finalizeUpload: async (body) => {
          const { error } = await supabase.functions.invoke("bunny-finalize-recording", { body });
          if (error) throw error;
        },
        onProgress: setProgress,
        onError: (cause) =>
          setError(`${cause.message} Stop to finish or retry the upload; keep this tab open.`),
      });
      if (!mounted.current) {
        void capture.current.stop().catch(() => {});
        throw new Error("Recording page was closed. The upload may be incomplete.");
      }
      display.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          void finish();
        },
        { once: true },
      );
      setState("recording");
      if (display.getVideoTracks()[0]?.readyState === "ended") void finish();
    } catch (cause) {
      releaseTracks();
      setError(cause instanceof Error ? cause.message : "Could not start recording.");
      setState("idle");
      onBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-medium">
        Record {sessionId ? "a summary" : "a general video"} in your browser
      </h3>
      <p className="text-sm text-[var(--text-secondary)]">
        Choose a screen or camera and optional microphone. Screen audio depends on your browser and
        chosen source. Video uploads while recording; keep this tab open until upload finishes. No
        transcription runs here.
      </p>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>
          Source{" "}
          <select
            className="rounded bg-[var(--surface-raised)] p-2"
            value={source}
            disabled={busy}
            onChange={(e) => setSource(e.target.value as "screen" | "camera")}
          >
            <option value="screen">Screen / window / tab</option>
            <option value="camera">Camera</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={mic}
            disabled={busy}
            onChange={(e) => setMic(e.target.checked)}
          />
          Microphone
        </label>
      </div>
      <video
        ref={preview}
        autoPlay
        muted
        playsInline
        aria-label="Recording preview"
        className={busy ? "aspect-video w-full rounded-lg bg-black" : "hidden"}
      />
      <div role="status" className="text-sm">
        {state === "recording"
          ? "Recording in progress"
          : state === "uploading"
            ? "Finishing upload. Do not close this tab."
            : state === "done"
              ? "Uploaded and attached. Playback may still be encoding."
              : state === "starting"
                ? "Preparing recording..."
                : null}
        {busy && (
          <p>
            {(progress.uploadedBytes / 1048576).toFixed(1)} /{" "}
            {(progress.recordedBytes / 1048576).toFixed(1)} MB uploaded
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {!busy && (
          <Button type="button" onClick={() => void start()}>
            Start recording
          </Button>
        )}
        {state === "recording" && (
          <Button type="button" onClick={() => void finish()}>
            Stop &amp; upload
          </Button>
        )}
        {state === "failed" && (
          <>
            <Button type="button" onClick={() => void finish(true)}>
              Retry upload
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                if (
                  !window.confirm(
                    "Discard buffered video? This cannot be undone. The unfinished cloud upload will not be attached.",
                  )
                )
                  return;
                try {
                  await capture.current?.discard();
                  capture.current = null;
                  releaseTracks();
                  setState("idle");
                  setError(null);
                  onBusy(false);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Could not discard recording.");
                }
              }}
            >
              Discard
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
