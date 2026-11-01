import { cn } from "@lare/ui";
import { Emblem } from "@lare/ui/brand";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthProvider";
import { inTauri } from "@/lib/tauri";
import {
  checkOnLaunch,
  dismissUpdate,
  installUpdate,
  type UpdateState,
  useUpdateState,
} from "@/lib/updater";
import "./splash.css";

/** Slow idle spin while the app loads, in degrees per second. */
const IDLE_DEG_PER_SEC = 55;
/** The idle spin plays at least this long, so a fast start doesn't flash the animation. */
const MIN_IDLE_MS = 500;
const SPIN_MS = 900;
/** Whole turns added by the speed-up, on top of whatever is needed to land upright. */
const SPIN_EXTRA_TURNS = 1;
const REVEAL_MS = 500;
const SHINE_MS = 600;
const EXIT_MS = 300;

type Phase = "idle" | "spin" | "reveal" | "shine" | "exit" | "done";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/**
 * The launch screen: the logo turns slowly while the app restores your session, then, once it is
 * ready, speeds up and eases to a stop upright, the name wipes in beside it from left to right, and
 * a highlight sweeps across the logo before the whole thing fades away. The app is already mounted
 * underneath, so nothing waits on the fade.
 *
 * Every launch also checks for an update first. When there is one, the splash stays up, shows the
 * download and installs it, and Lare relaunches into the new version.
 */
export function Splash() {
  const { session, profileLoading } = useAuth();
  const gate = useLaunchUpdate();
  const appReady = session !== undefined && !profileLoading && gate === "clear";
  const [phase, setPhase] = useState<Phase>("idle");
  const [minIdleElapsed, setMinIdleElapsed] = useState(false);
  const spinner = useRef<HTMLDivElement>(null);
  // Angle and speed live outside React state: they change every frame.
  const motion = useRef({ angle: 0, speed: IDLE_DEG_PER_SEC, spinStart: 0 });

  useEffect(() => {
    const id = setTimeout(() => setMinIdleElapsed(true), MIN_IDLE_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (phase === "idle" && appReady && minIdleElapsed) {
      setPhase(prefersReducedMotion() ? "exit" : "spin");
    }
  }, [phase, appReady, minIdleElapsed]);

  // Drive the rotation: constant slow turn, then one accelerate-and-settle move that ends upright.
  useEffect(() => {
    if (phase !== "idle" && phase !== "spin") return;
    const m = motion.current;
    const spinFrom = m.angle;
    const spinSpeed = m.speed;
    const settled = spinFrom + (spinSpeed * SPIN_MS) / 2000;
    // A whole number of turns from the start, so the logo comes to rest the right way up.
    const target = Math.ceil((settled + SPIN_EXTRA_TURNS * 360) / 360) * 360;
    const extra = target - spinFrom - (spinSpeed * SPIN_MS) / 2000;
    let last = performance.now();
    m.spinStart = last;
    let frame = 0;

    const tick = (now: number) => {
      if (phase === "idle") {
        m.angle += (IDLE_DEG_PER_SEC * (now - last)) / 1000;
        m.speed = IDLE_DEG_PER_SEC;
        last = now;
      } else {
        const p = Math.min((now - m.spinStart) / SPIN_MS, 1);
        // The idle speed carries on and tapers to zero while an ease-in-out adds the burst, so
        // the speed never jumps when the spin begins and is zero when it ends.
        m.angle =
          spinFrom + ((spinSpeed * SPIN_MS) / 1000) * (p - (p * p) / 2) + extra * easeInOutCubic(p);
        if (p >= 1) {
          m.angle = target;
          if (spinner.current) spinner.current.style.transform = "rotate(0deg)";
          setPhase("reveal");
          return;
        }
      }
      if (spinner.current) spinner.current.style.transform = `rotate(${m.angle}deg)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    const next: Partial<Record<Phase, [Phase, number]>> = {
      reveal: ["shine", REVEAL_MS],
      shine: ["exit", SHINE_MS],
      exit: ["done", EXIT_MS],
    };
    const step = next[phase];
    if (!step) return;
    const id = setTimeout(() => setPhase(step[0]), step[1]);
    return () => clearTimeout(id);
  }, [phase]);

  // The splash covers the app, so it must never be a wait: any key or click goes straight to the
  // fade-out, whichever step it is on. (It cannot be skipped before the app is ready; then there
  // is nothing underneath yet.)
  useEffect(() => {
    if (phase === "exit" || phase === "done") return;
    const skip = () => {
      if (appReady) setPhase("exit");
    };
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [phase, appReady]);

  if (phase === "done") return null;

  const named = phase === "reveal" || phase === "shine" || phase === "exit";
  // The status line sits under the logo only while it says something: the update check, then the
  // download. It leaves with the spin, so it never competes with the name.
  const showStatus = phase === "idle" && gate !== "clear";
  return (
    <div
      className={cn("lare-splash", phase === "exit" && "lare-splash-exit")}
      role="status"
      aria-label="Loading Lare"
      style={{ "--splash-exit": `${EXIT_MS}ms` } as React.CSSProperties}
    >
      {/* The splash covers the title bar, so it carries the drag handle itself. */}
      <div data-tauri-drag-region className="h-8 w-full shrink-0" />
      <div className="lare-splash-stage">
        <div className={cn("lare-splash-lockup", named && "lare-splash-named")}>
          <div ref={spinner} className="lare-splash-spinner">
            <Emblem
              className={cn("lare-splash-emblem", phase === "shine" && "lare-splash-shine")}
            />
          </div>
          <div className="lare-splash-name">
            <span>Lare</span>
          </div>
        </div>
        {showStatus ? <UpdateStatus gate={gate} /> : null}
      </div>
    </div>
  );
}

type Gate = "checking" | "updating" | "clear";

/**
 * Whether the launch update check lets the app open. "checking" until GitHub answers; "updating"
 * while a newer release downloads and installs (the app relaunches at the end, so it never turns
 * "clear" unless the install fails and the user carries on); "clear" otherwise, including when the
 * check itself failed.
 */
function useLaunchUpdate(): Gate {
  const [gate, setGate] = useState<Gate>(inTauri ? "checking" : "clear");
  const state = useUpdateState();
  useEffect(() => {
    if (!inTauri) return;
    let active = true;
    void checkOnLaunch().then((result) => {
      if (!active) return;
      if (result.status === "available") return setGate("updating");
      // A failed check is not worth a notice: the hourly check will try again.
      if (result.status === "error") dismissUpdate();
      setGate("clear");
    });
    return () => {
      active = false;
    };
  }, []);
  // "Continue without updating" after a failed install dismisses the error, which is the way out.
  useEffect(() => {
    if (gate === "updating" && state.status === "idle") setGate("clear");
  }, [gate, state.status]);
  return gate;
}

/** The line under the spinning logo: the check, then the download with its bar, then the install. */
function UpdateStatus({ gate }: { gate: Exclude<Gate, "clear"> }) {
  const state = useUpdateState();
  if (gate === "checking") {
    return (
      <div className="lare-splash-status lare-splash-status-delayed" aria-live="polite">
        <p className="lare-splash-status-text">Checking for updates…</p>
      </div>
    );
  }
  return (
    <div className="lare-splash-status" aria-live="polite">
      <p className="lare-splash-status-title">{updateTitle(state)}</p>
      {state.status === "error" ? (
        <>
          <p className="lare-splash-status-text lare-splash-status-error">{state.message}</p>
          <div className="lare-splash-status-actions">
            <Button variant="primary" size="sm" onClick={() => void installUpdate()}>
              Try again
            </Button>
            <Button size="sm" onClick={dismissUpdate}>
              Continue without updating
            </Button>
          </div>
        </>
      ) : (
        <>
          <ProgressBar
            value={
              state.status === "downloading"
                ? state.progress
                : state.status === "installing"
                  ? 1
                  : null
            }
          />
          <p className="lare-splash-status-text">{updateDetail(state)}</p>
        </>
      )}
    </div>
  );
}

function updateTitle(state: UpdateState): string {
  if (state.status === "error") return "The update did not install";
  const version = "version" in state ? ` v${state.version}` : "";
  return `Updating to Lare${version}`;
}

function updateDetail(state: UpdateState): string {
  if (state.status === "installing") return "Installing. Lare will restart in a moment.";
  if (state.status === "downloading" && state.progress !== null)
    return `Downloading… ${Math.round(state.progress * 100)}%`;
  return "Downloading…";
}

/** Determinate when the download size is known, otherwise a sliding band. */
function ProgressBar({ value }: { value: number | null }) {
  return (
    <div
      className="lare-splash-progress"
      role="progressbar"
      aria-label="Update progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      <div
        className={cn(
          "lare-splash-progress-fill",
          value === null && "lare-splash-progress-indeterminate",
        )}
        style={value === null ? undefined : { transform: `scaleX(${value})` }}
      />
    </div>
  );
}
