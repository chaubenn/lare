/**
 * The always-on-top recorder pill (`?window=recorder`). Shows the live timer and lets the user
 * pause/resume, stop, discard or hide it. Mock interviews get the same controls: the desktop tells
 * the extension, which keeps the interview timer it owns in step. State comes from
 * `recording:state` events; the initial state is fetched on mount so the pill is correct even if it
 * opened after the recording started.
 */

import { formatDuration } from "@lare/shared";
import { cn } from "@lare/ui";
import { Emblem } from "@lare/ui/brand";
import { Camera, EyeOff, GripVertical, Pause, Play, Trash2 } from "@lare/ui/icons";
import { useCallback, useEffect, useState } from "react";
import { type RecorderStatus, recorder } from "@/lib/recorder";
import { DEFAULT_PILL_SHORTCUT, describeAccelerator, isMac } from "@/lib/shortcuts";
import { useTauriEvent } from "@/lib/tauri";
import { ShortcutCaps, OverlayTooltip as Tooltip, useOverlayTooltips } from "./overlayTooltips";

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

/** How long the discard question waits for an answer before the pill goes back to normal. */
const DISCARD_CONFIRM_MS = 5000;

/**
 * The pill is moved with `data-tauri-drag-region`, the OS's own window drag.
 *
 * The window is taller than the pill: the strip above it is room for tooltips, and Rust lets
 * clicks through it while the pointer is not on the pill itself.
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
  const { pointed, shown, target } = useOverlayTooltips("recorder:pointer");
  // The user hid the facecam from its own toolbar; the pill offers it back.
  const [cameraTucked, setCameraTucked] = useState(false);
  useTauriEvent("camera:tucked", setCameraTucked);
  const noun = isInterview ? "interview" : "recording";

  // Discarding throws the take away for good, so the bin asks once more in place: the pill is
  // too small for a dialog, and a stray click on it should not cost a whole recording.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const canDiscard = !busy && state !== "stopping";
  useEffect(() => {
    if (!confirmingDiscard) return;
    if (!canDiscard) {
      setConfirmingDiscard(false);
      return;
    }
    const timer = window.setTimeout(() => setConfirmingDiscard(false), DISCARD_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirmingDiscard, canDiscard]);

  const label = error
    ? error
    : confirmingDiscard
      ? `Discard ${noun}?`
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
    <div className="flex h-full w-full flex-col justify-end">
      <div className="flex h-[72px] w-full shrink-0 items-center justify-center p-2.5">
        {/* Decorative children ignore the pointer so a press anywhere off a button lands on the drag
          region itself: Tauri only drags from the element that carries the attribute. */}
        <div
          data-tauri-drag-region
          role="toolbar"
          aria-label="Recording controls"
          className={cn(
            "flex h-[52px] w-full cursor-grab items-center gap-2.5 rounded-full border pr-2 pl-2 active:cursor-grabbing",
            "bg-[color-mix(in_oklab,var(--lare-ink-2)_92%,transparent)] backdrop-blur-xl",
            "shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_6px_20px_rgb(0_0_0/0.45),0_0_0_0.5px_rgb(0_0_0/0.8)]",
            error
              ? "border-[color-mix(in_oklab,var(--lare-status-stop)_55%,transparent)]"
              : "border-white/[0.08]",
          )}
        >
          <span data-tauri-drag-region className="relative flex shrink-0" {...target("drag")}>
            <span
              data-tauri-drag-region
              className={cn(
                "flex h-9 w-4 items-center justify-center text-[var(--lare-muted)] transition-colors hover:text-[var(--lare-soft)]",
                pointed === "drag" && "text-[var(--lare-soft)]",
              )}
            >
              <GripVertical className="pointer-events-none size-4" aria-hidden />
            </span>
            <Tooltip show={shown === "drag"} align="start">
              Drag to move
            </Tooltip>
          </span>
          <Emblem className="pointer-events-none size-[18px] shrink-0" />
          <span className="pointer-events-none h-6 w-px shrink-0 bg-white/[0.08]" aria-hidden />
          <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2.5">
            <StatusDot state={state} error={Boolean(error)} />
            <div className="min-w-0 flex-1 leading-none">
              <div className="font-mono text-[15px] font-medium tabular-nums tracking-tight text-[var(--lare-bone)]">
                {formatDuration(elapsed)}
              </div>
              <div
                className={cn(
                  "mt-1 truncate text-[10.5px] font-medium uppercase tracking-[0.08em]",
                  error || confirmingDiscard
                    ? "text-[var(--lare-status-stop)]"
                    : "text-[var(--lare-muted)]",
                )}
                aria-live="polite"
              >
                {label}
              </div>
            </div>
          </div>
          {confirmingDiscard ? (
            <div className="flex shrink-0 items-center gap-1">
              <span className="relative flex" {...target("keep")}>
                <button
                  type="button"
                  aria-label={`Keep ${noun}`}
                  onClick={() => setConfirmingDiscard(false)}
                  className={cn(
                    "lare-press inline-flex h-9 shrink-0 items-center rounded-full px-3 text-[13px] font-semibold text-[var(--lare-soft)] transition-colors",
                    "hover:bg-white/[0.08] hover:text-[var(--lare-bone)]",
                    pointed === "keep" && "bg-white/[0.08] text-[var(--lare-bone)]",
                  )}
                >
                  Keep
                </button>
                <Tooltip show={shown === "keep"}>Keep {noun}</Tooltip>
              </span>
              <span className="relative flex" {...target("confirm-discard")}>
                <button
                  type="button"
                  aria-label={`Discard ${noun} for good`}
                  disabled={!canDiscard}
                  onClick={() =>
                    void run(async () => {
                      setConfirmingDiscard(false);
                      await recorder.cancel();
                    })
                  }
                  className={cn(
                    "lare-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full pr-3.5 pl-3 text-[13px] font-semibold text-white",
                    "bg-[color-mix(in_oklab,var(--lare-status-stop)_82%,black)] shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]",
                    "transition-colors hover:bg-[var(--lare-status-stop)] disabled:cursor-not-allowed disabled:opacity-40",
                    pointed === "confirm-discard" && canDiscard && "bg-[var(--lare-status-stop)]",
                  )}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Discard
                </button>
                <Tooltip show={shown === "confirm-discard"} align="end">
                  Throw this {noun} away
                </Tooltip>
              </span>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-0.5">
              <span className="relative flex" {...target("pause")}>
                <PillButton
                  label={paused ? "Resume" : "Pause"}
                  hot={pointed === "pause"}
                  disabled={busy || !live}
                  onClick={() => void run(() => (paused ? recorder.resume() : recorder.pause()))}
                >
                  {paused ? (
                    <Play className="size-4 fill-current" aria-hidden />
                  ) : (
                    <Pause className="size-4 fill-current" aria-hidden />
                  )}
                </PillButton>
                <Tooltip show={shown === "pause"}>
                  {paused ? `Resume ${noun}` : `Pause ${noun}`}
                </Tooltip>
              </span>
              <span className="relative mx-1 flex" {...target("end")}>
                <button
                  type="button"
                  aria-label="End and save"
                  disabled={busy || !live}
                  onClick={() => void run(() => recorder.stop())}
                  className={cn(
                    "lare-press inline-flex h-9 shrink-0 items-center gap-2 rounded-full pr-3.5 pl-3 text-[13px] font-semibold text-white",
                    "bg-[color-mix(in_oklab,var(--lare-status-stop)_82%,black)] shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]",
                    "transition-colors hover:bg-[var(--lare-status-stop)] disabled:cursor-not-allowed disabled:opacity-40",
                    pointed === "end" && !(busy || !live) && "bg-[var(--lare-status-stop)]",
                  )}
                >
                  <span className="size-2.5 rounded-[3px] bg-current" aria-hidden />
                  End
                </button>
                <Tooltip show={shown === "end"}>End &amp; save {noun}</Tooltip>
              </span>
              <span className="relative flex" {...target("discard")}>
                <PillButton
                  label="Discard"
                  danger
                  hot={pointed === "discard"}
                  disabled={!canDiscard}
                  onClick={() => setConfirmingDiscard(true)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </PillButton>
                <Tooltip show={shown === "discard"}>Discard {noun}</Tooltip>
              </span>
            </div>
          )}
          {cameraTucked ? (
            <span className="relative flex" {...target("camera")}>
              <PillButton
                label="Show facecam"
                hot={pointed === "camera"}
                onClick={() => void run(() => recorder.showCameraWindow())}
              >
                <Camera className="size-4" aria-hidden />
              </PillButton>
              <Tooltip show={shown === "camera"} align={keys ? "center" : "end"}>
                Show facecam
              </Tooltip>
            </span>
          ) : null}
          {keys ? (
            <span className="relative flex" {...target("hide")}>
              <PillButton
                label={`Hide (${keys} toggles it)`}
                hot={pointed === "hide"}
                onClick={() => void run(() => recorder.tuckRecorderWindow())}
              >
                <EyeOff className="size-4" aria-hidden />
              </PillButton>
              <Tooltip show={shown === "hide"} align="end">
                Hide
                {hideShortcut ? <ShortcutCaps accelerator={hideShortcut} /> : null}
              </Tooltip>
            </span>
          ) : null}
        </div>
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
  hot,
  disabled,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  /** The pointer is on it: macOS gets no CSS hover in the pill (see `overlayTooltips.tsx`). */
  hot?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "lare-press inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--lare-soft)] transition-colors",
        "hover:bg-white/[0.08] hover:text-[var(--lare-bone)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        danger && "hover:text-[var(--lare-status-stop)]",
        hot && !disabled && "bg-white/[0.08] text-[var(--lare-bone)]",
        hot && !disabled && danger && "text-[var(--lare-status-stop)]",
      )}
    >
      {children}
    </button>
  );
}
