/**
 * The always-on-top recorder pill (`?window=recorder`). Shows the live timer and lets the user
 * pause/resume, stop or discard. State comes from `recording:state` events; the initial state is
 * fetched on mount so the pill is correct even if it opened after the recording started.
 */

import { formatDuration } from "@lare/shared";
import { cn } from "@lare/ui";
import { Emblem } from "@lare/ui/brand";
import { EyeOff, GripVertical, Pause, Play, Trash2 } from "@lare/ui/icons";
import { useCallback, useEffect, useState } from "react";
import { type RecorderStatus, recorder } from "@/lib/recorder";
import { DEFAULT_PILL_SHORTCUT, describeAccelerator } from "@/lib/shortcuts";
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

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/**
 * The keys that hide this pill, as the user has set them (null when they turned the shortcut off).
 * Read again at the start of each take: the window is reused, and the setting can change between.
 */
function useHideShortcut(state: RecorderStatus["state"]): string | null {
  const [accelerator, setAccelerator] = useState<string | null>(DEFAULT_PILL_SHORTCUT);
  useEffect(() => {
    if (state !== "starting") return;
    let active = true;
    recorder
      .settings()
      .then((s) => {
        if (!active) return;
        const saved = s.pillShortcut;
        setAccelerator(saved === "" ? null : (saved ?? DEFAULT_PILL_SHORTCUT));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [state]);
  return accelerator;
}

/**
 * Window position uses `data-tauri-drag-region` (native Tauri drag). `useDraggable` would
 * fight that and risk breaking recording, so snap/rubber-band stay with the OS drag.
 *
 * The window is only as tall as the pill (a taller transparent window would swallow clicks meant
 * for the page behind it), so there is no room for a tooltip above it. Hovering a control swaps
 * the pill's second line for a hint instead.
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
  const hideShortcut = useHideShortcut(state);
  const caps = hideShortcut ? describeAccelerator(hideShortcut, isMac) : [];

  const live = state === "recording" || paused;
  const keys = caps.join(isMac ? "" : "+");
  const [hint, setHint] = useState<string | null>(null);
  const hintProps = (text: string) => ({
    onMouseEnter: () => setHint(text),
    onMouseLeave: () => setHint(null),
    onFocus: () => setHint(text),
    onBlur: () => setHint(null),
  });

  const label = error
    ? error
    : state === "starting"
      ? "Starting"
      : state === "stopping"
        ? "Saving"
        : paused
          ? "Paused"
          : isInterview
            ? "Mock interview"
            : "Recording";

  return (
    <div className="flex h-full w-full items-center justify-center p-2.5">
      {/* Decorative children ignore the pointer so a press anywhere off a button lands on the drag
          region itself: Tauri only drags from the element that carries the attribute. */}
      <div
        data-tauri-drag-region
        role="toolbar"
        aria-label="Recording controls"
        onMouseLeave={() => setHint(null)}
        className={cn(
          "flex h-[52px] w-full cursor-grab items-center gap-2.5 rounded-full border pr-2 pl-2 active:cursor-grabbing",
          "bg-[color-mix(in_oklab,var(--lare-ink-2)_92%,transparent)] backdrop-blur-xl",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_6px_20px_rgb(0_0_0/0.45),0_0_0_0.5px_rgb(0_0_0/0.8)]",
          error
            ? "border-[color-mix(in_oklab,var(--lare-status-stop)_55%,transparent)]"
            : "border-white/[0.08]",
        )}
      >
        <span
          data-tauri-drag-region
          className="flex h-9 w-4 shrink-0 items-center justify-center text-[var(--lare-muted)] transition-colors hover:text-[var(--lare-soft)]"
          {...hintProps("Drag to move")}
        >
          <GripVertical className="pointer-events-none size-4" aria-hidden />
        </span>
        <Emblem className="pointer-events-none size-[18px] shrink-0" />
        <span className="pointer-events-none h-6 w-px shrink-0 bg-white/[0.08]" aria-hidden />
        <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2.5">
          <StatusDot state={state} error={Boolean(error)} />
          <div className="min-w-0 flex-1 leading-none">
            <div className="font-mono text-[15px] font-medium tabular-nums tracking-tight text-[var(--lare-bone)]">
              {formatDuration(elapsed)}
            </div>
            <div className="mt-1 truncate text-[11px] font-medium" aria-live="polite">
              {hint && !error ? (
                <span className="text-[var(--lare-soft)]" title={hint}>
                  {hint}
                </span>
              ) : (
                <span
                  className={cn(
                    "text-[10.5px] uppercase tracking-[0.08em]",
                    error ? "text-[var(--lare-status-stop)]" : "text-[var(--lare-muted)]",
                  )}
                >
                  {label}
                </span>
              )}
            </div>
          </div>
        </div>
        {isInterview ? (
          <span className="pointer-events-none shrink-0 rounded-full bg-white/[0.05] px-3 py-1.5 text-xs text-[var(--lare-soft)]">
            End from the extension
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-0.5">
            <PillButton
              label={paused ? "Resume" : "Pause"}
              disabled={busy || !live}
              onClick={() => void run(() => (paused ? recorder.resume() : recorder.pause()))}
              {...hintProps(paused ? "Resume recording" : "Pause recording")}
            >
              {paused ? (
                <Play className="size-4 fill-current" aria-hidden />
              ) : (
                <Pause className="size-4 fill-current" aria-hidden />
              )}
            </PillButton>
            <button
              type="button"
              aria-label="End and save"
              disabled={busy || !live}
              onClick={() => void run(() => recorder.stop())}
              {...hintProps("End and save the recording")}
              className={cn(
                "lare-press mx-1 inline-flex h-9 shrink-0 items-center gap-2 rounded-full pr-3.5 pl-3 text-[13px] font-semibold text-white",
                "bg-[color-mix(in_oklab,var(--lare-status-stop)_82%,black)] shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]",
                "transition-colors hover:bg-[var(--lare-status-stop)] disabled:cursor-not-allowed disabled:opacity-40",
              )}
            >
              <span className="size-2.5 rounded-[3px] bg-current" aria-hidden />
              End
            </button>
            <PillButton
              label="Discard"
              danger
              disabled={busy || state === "stopping"}
              onClick={() => void run(() => recorder.cancel())}
              {...hintProps("Discard this take")}
            >
              <Trash2 className="size-4" aria-hidden />
            </PillButton>
          </div>
        )}
        {keys ? (
          <PillButton
            label={`Hide (${keys} shows it again)`}
            onClick={() => {
              setHint(null);
              void run(() => recorder.tuckRecorderWindow());
            }}
            {...hintProps(`Hide · ${keys} to show`)}
          >
            <EyeOff className="size-4" aria-hidden />
          </PillButton>
        ) : null}
      </div>
    </div>
  );
}

/** Live red with a halo while recording, steady amber while paused, a soft grey pulse in between. */
function StatusDot({ state, error }: { state: RecorderStatus["state"]; error: boolean }) {
  const color =
    error || state === "recording"
      ? "bg-[var(--lare-status-stop)]"
      : state === "paused"
        ? "bg-[var(--lare-status-pause)]"
        : "bg-[var(--lare-muted)]";
  return (
    <span className="relative flex size-2.5 shrink-0" aria-hidden>
      {state === "recording" && !error ? (
        <span
          className={cn("absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping", color)}
        />
      ) : null}
      <span
        className={cn(
          "relative size-2.5 rounded-full",
          color,
          (state === "starting" || state === "stopping") && "motion-safe:animate-pulse",
          state === "recording" && !error && "shadow-[0_0_8px_var(--lare-status-stop)]",
        )}
      />
    </span>
  );
}

function PillButton({
  label,
  danger,
  disabled,
  onClick,
  children,
  ...hover
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
} & Pick<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur"
>) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      {...hover}
      className={cn(
        "lare-press inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--lare-soft)] transition-colors",
        "hover:bg-white/[0.08] hover:text-[var(--lare-bone)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        danger && "hover:text-[var(--lare-status-stop)]",
      )}
    >
      {children}
    </button>
  );
}
