/**
 * The always-on-top recorder pill (`?window=recorder`). Shows the live timer and lets the user
 * pause/resume, stop or discard. State comes from `recording:state` events; the initial state is
 * fetched on mount so the pill is correct even if it opened after the recording started.
 */

import { cn } from "@lare/ui";
import { Pause, Play, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type RecorderStatus, recorder } from "@/lib/recorder";
import { useTauriEvent } from "@/lib/tauri";

function useElapsed(status: RecorderStatus | null): number {
  const [now, setNow] = useState(() => Date.now());
  const running = status?.state === "recording";
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  if (!status?.startedAt) return 0;
  // Pauses are not subtracted here (the pill is a coarse indicator); the exported video keeps
  // only the recorded portions.
  return Math.max(0, (status.state === "recording" ? now : Date.now()) - status.startedAt);
}

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function RecorderPillWindow() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsed(status);

  useEffect(() => {
    recorder
      .status()
      .then(setStatus)
      .catch((e: unknown) => setError(String(e)));
  }, []);
  useTauriEvent("recording:state", (payload) => {
    setStatus(payload);
    if (payload.state === "idle" || payload.state === "error") {
      // The Rust side closes this window; nothing else to do.
    }
  });

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
            state === "recording" && "animate-pulse bg-rose-500",
            paused && "bg-amber-400",
            (state === "starting" || state === "stopping") && "animate-pulse bg-zinc-400",
          )}
          aria-hidden
        />
        <div data-tauri-drag-region className="min-w-0 flex-1 leading-tight">
          <div className="font-mono text-sm tabular-nums">{fmt(elapsed)}</div>
          <div className="truncate text-[10px] uppercase tracking-wider text-zinc-400">
            {error
              ? error
              : state === "starting"
                ? "Starting…"
                : state === "stopping"
                  ? "Finishing…"
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
