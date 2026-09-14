/**
 * The always-on-top recorder pill (`?window=recorder`). Shows the live timer and lets the user
 * pause/resume, stop or discard. State comes from `recording:state` events; the initial state is
 * fetched on mount so the pill is correct even if it opened after the recording started.
 */

import { formatDuration } from "@lare/shared";
import { cn } from "@lare/ui";
import { Pause, Play, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type RecorderStatus, recorder } from "@/lib/recorder";
import { useTauriEvent } from "@/lib/tauri";

/**
 * How much video exists, ticking. Rust reports `recordedMs` with every state payload — wall clock
 * less every paused stretch — so the pill shows the length of the file the user will get rather
 * than how long ago they pressed record. Between payloads it extrapolates from `since`, the
 * moment the payload arrived, and while paused it simply holds.
 */
function useElapsed(status: RecorderStatus | null, since: number): number {
  const [now, setNow] = useState(() => Date.now());
  const running = status?.state === "recording";
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
    // `since` is deliberately not a dependency: a payload only arrives on a state change, and
    // every change that matters here also flips `running`.
  }, [running]);
  const base = status?.recordedMs ?? 0;
  return running ? base + Math.max(0, now - since) : base;
}

/**
 * Window position uses `data-tauri-drag-region` (native Tauri drag). `useDraggable` would
 * fight that and risk breaking recording, so snap/rubber-band stay with the OS drag.
 */

export function RecorderPillWindow() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  // When the current status arrived: `recordedMs` is a snapshot, so the timer needs its epoch.
  const [statusAt, setStatusAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsed(status, statusAt);

  const applyStatus = useCallback((next: RecorderStatus) => {
    setStatus(next);
    setStatusAt(Date.now());
    // This window is reused across takes, so a message from the last one has to be cleared.
    if (next.state === "starting" || next.state === "recording") setError(null);
  }, []);

  useEffect(() => {
    recorder
      .status()
      .then(applyStatus)
      .catch((e: unknown) => setError(String(e)));
  }, [applyStatus]);
  // The Rust side hides this window once the recording is over — the webview stays alive, since
  // tearing it down under an in-flight `recording_stop` used to take the whole app with it.
  useTauriEvent("recording:state", applyStatus);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state ?? "starting";
  const paused = state === "paused";
  const isInterview = status?.purpose === "interview";

  return (
    <div className="flex h-full w-full items-center justify-center p-1.5">
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-[52px] w-full items-center gap-2 rounded-full border px-3 shadow-2xl backdrop-blur",
          "border-zinc-700/80 bg-zinc-900/95 text-zinc-100",
          error && "border-rose-500/60",
        )}
      >
        <span
          className={cn(
            "size-3 shrink-0 rounded-full",
            state === "recording" && "animate-pulse bg-[var(--lare-status-stop)]",
            paused && "bg-[var(--lare-status-pause)]",
            (state === "starting" || state === "stopping") && "animate-pulse bg-zinc-400",
          )}
          aria-hidden
        />
        <div data-tauri-drag-region className="min-w-0 flex-1 leading-tight">
          <div className="font-mono text-sm tabular-nums">{formatDuration(elapsed)}</div>
          <div className="truncate text-[10px] uppercase tracking-wider text-zinc-400">
            {error
              ? error
              : state === "starting"
                ? "Starting…"
                : state === "stopping"
                  ? status?.mode === "instant"
                    ? "Muxing…"
                    : "Finishing…"
                  : paused
                    ? "Paused"
                    : isInterview
                      ? "Mock interview"
                      : status?.mode === "studio"
                        ? "Studio recording"
                        : "Recording"}
          </div>
        </div>
        {isInterview ? (
          <span className="text-[10px] text-zinc-500">End from the extension</span>
        ) : (
          <>
            <PillButton
              label={paused ? "Resume" : "Pause"}
              disabled={busy || (state !== "recording" && state !== "paused")}
              onClick={() => void run(() => (paused ? recorder.resume() : recorder.pause()))}
            >
              {paused ? (
                <Play className="size-4" aria-hidden />
              ) : (
                <Pause className="size-4" aria-hidden />
              )}
            </PillButton>
            <PillButton
              label="Stop and save"
              accent
              disabled={busy || (state !== "recording" && state !== "paused")}
              onClick={() => void run(() => recorder.stop())}
            >
              <Square className="size-4 fill-current" aria-hidden />
            </PillButton>
            <PillButton
              label="Discard"
              disabled={busy || state === "stopping"}
              onClick={() => void run(() => recorder.cancel())}
            >
              <X className="size-4" aria-hidden />
            </PillButton>
          </>
        )}
      </div>
    </div>
  );
}

function PillButton({
  label,
  accent,
  disabled,
  onClick,
  children,
}: {
  label: string;
  accent?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        accent
          ? "bg-rose-500 text-white hover:bg-rose-400"
          : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700",
      )}
    >
      {children}
    </button>
  );
}
