import { cn } from "@lare/ui";
import { Emblem } from "@lare/ui/brand";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import "./splash.css";

/** Slow idle spin while the app loads, in degrees per second. */
const IDLE_DEG_PER_SEC = 55;
/** The idle spin plays at least this long, so a fast start doesn't flash the animation. */
const MIN_IDLE_MS = 700;
const SPIN_MS = 1500;
/** Whole turns added by the speed-up, on top of whatever is needed to land upright. */
const SPIN_EXTRA_TURNS = 2;
const REVEAL_MS = 800;
const SHINE_MS = 1000;
const EXIT_MS = 400;

type Phase = "idle" | "spin" | "reveal" | "shine" | "exit" | "done";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/**
 * The launch screen: the logo turns slowly while the app restores your session, then, once it is
 * ready, speeds up and eases to a stop upright, the name wipes in beside it from left to right, and
 * a highlight sweeps across the logo before the whole thing fades away. The app is already mounted
 * underneath, so nothing waits on the fade.
 */
export function Splash() {
  const { session, profileLoading } = useAuth();
  const appReady = session !== undefined && !profileLoading;
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

  if (phase === "done") return null;

  const named = phase === "reveal" || phase === "shine" || phase === "exit";
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
      </div>
    </div>
  );
}
