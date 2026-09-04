/**
 * Facecam preview (`?window=camera`): a draggable, always-on-top circle showing the webcam.
 * In instant mode it is captured as part of the screen; in studio mode it is a preview only.
 * The camera is opened with getUserMedia so it works without any Rust plumbing.
 */

import { cn } from "@lare/ui";
import { useEffect, useRef, useState } from "react";
import { recorder } from "@/lib/recorder";

export function CameraWindow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mirror, setMirror] = useState(true);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        const settings = await recorder.settings().catch(() => null);
        const constraints: MediaTrackConstraints = {
          width: { ideal: 640 },
          height: { ideal: 640 },
          facingMode: "user",
        };
        if (settings?.cameraId) constraints.deviceId = { ideal: settings.cameraId };
        stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (stream) for (const t of stream.getTracks()) t.stop();
    };
  }, []);

  return (
    <div className="flex h-full w-full items-center justify-center p-1">
      <div
        data-tauri-drag-region
        className="relative size-full overflow-hidden rounded-full border-2 border-zinc-800 bg-zinc-900 shadow-2xl"
        title="Drag to move"
      >
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          className={cn("size-full object-cover", mirror && "-scale-x-100")}
        />
        <button
          type="button"
          onClick={() => setMirror((m) => !m)}
          title={mirror ? "Un-mirror" : "Mirror"}
          aria-label={mirror ? "Un-mirror camera" : "Mirror camera"}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-zinc-950/70 px-2 py-0.5 text-[10px] text-zinc-300 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"
        >
          {mirror ? "mirrored" : "normal"}
        </button>
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[11px] text-rose-300">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
