import { cn } from "@lare/ui";
import type { RefObject } from "react";
import { EmptyState } from "@/components/ui/States";
import type { ClipInfo, StudioEdit, StudioProjectInfo } from "@/lib/recorder";

export function StudioPreview({
  previewSrc,
  cameraSrc,
  micSrc,
  activeClip,
  clips,
  clipIndex,
  videoRef,
  cameraRef,
  micRef,
  edit,
  info,
  onCameraError,
  onMicError,
}: {
  previewSrc: string | null;
  cameraSrc: string | null;
  micSrc: string | null;
  activeClip: ClipInfo | undefined;
  clips: ClipInfo[];
  clipIndex: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraRef: RefObject<HTMLVideoElement | null>;
  micRef: RefObject<HTMLAudioElement | null>;
  edit: StudioEdit;
  info: StudioProjectInfo;
  onCameraError: () => void;
  onMicError: () => void;
}) {
  if (!previewSrc) {
    return (
      <EmptyState
        title="No display track found"
        description="The project folder is missing display.mp4."
      />
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg bg-black">
      <video
        key={activeClip?.displayPath}
        ref={videoRef}
        src={previewSrc}
        controls
        muted={!!micSrc}
        className="aspect-video w-full"
      />
      {clips.length > 1 ? (
        <span className="pointer-events-none absolute top-2 left-2 rounded bg-zinc-950/70 px-1.5 py-0.5 text-[10px] text-zinc-300">
          Take {clipIndex + 1} of {clips.length}
        </span>
      ) : null}
      {cameraSrc && !edit.camera.hide ? (
        <video
          ref={cameraRef}
          src={cameraSrc}
          muted
          playsInline
          preload="auto"
          aria-hidden
          onError={onCameraError}
          className={cn(
            "pointer-events-none absolute object-cover border-2 border-zinc-700/80 bg-zinc-950",
            edit.camera.keepAspect ? "aspect-video" : "aspect-square",
            edit.camera.mirror && "-scale-x-100",
            edit.camera.position.startsWith("top") ? "top-3" : "bottom-14",
            edit.camera.position.endsWith("left") ? "left-3" : "right-3",
          )}
          style={{
            width: `${Math.round(edit.camera.size * 0.6)}%`,
            borderRadius: `${edit.camera.rounding / 2}%`,
          }}
        />
      ) : !edit.camera.hide && info.cameraPath === null ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute flex items-center justify-center border-2 border-zinc-700 bg-zinc-900/80 px-2 text-center text-[10px] text-zinc-400",
            edit.camera.position.startsWith("top") ? "top-3" : "bottom-14",
            edit.camera.position.endsWith("left") ? "left-3" : "right-3",
          )}
          style={{ width: "22%", aspectRatio: "1" }}
        >
          No camera track — turn on facecam before recording
        </div>
      ) : null}
      {micSrc ? (
        // biome-ignore lint/a11y/useMediaCaption: user's own mic track, mixed under the display player
        <audio ref={micRef} src={micSrc} preload="auto" onError={onMicError} />
      ) : null}
    </div>
  );
}
