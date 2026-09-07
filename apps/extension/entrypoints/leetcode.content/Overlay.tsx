import { activeMs, formatDuration, type RecordingState, timerStatus } from "@lare/shared";
import { Emblem } from "@lare/ui/brand";
import { useDraggable } from "@lare/ui/gesture";
import { SPRING } from "@lare/ui/motion";
import { AnimatePresence, m } from "motion/react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PageController } from "@/src/pageController";

const HUD_KEY = "lare:hud-pos";
const HUD_INSET = 16;

type Anchor = { x: number; y: number };

function defaultPos(el: HTMLElement): Anchor {
  return {
    x: Math.max(HUD_INSET, window.innerWidth - el.offsetWidth - HUD_INSET),
    y: Math.max(HUD_INSET, window.innerHeight - el.offsetHeight - HUD_INSET),
  };
}

function corners(el: HTMLElement): Anchor[] {
  const maxX = Math.max(HUD_INSET, window.innerWidth - el.offsetWidth - HUD_INSET);
  const maxY = Math.max(HUD_INSET, window.innerHeight - el.offsetHeight - HUD_INSET);
  return [
    { x: HUD_INSET, y: HUD_INSET },
    { x: maxX, y: HUD_INSET },
    { x: HUD_INSET, y: maxY },
    { x: maxX, y: maxY },
  ];
}

function nearestCorner(pos: Anchor, el: HTMLElement): Anchor {
  const snaps = corners(el);
  let best = snaps[0] ?? pos;
  let bestD = Number.POSITIVE_INFINITY;
  for (const a of snaps) {
    const d = (a.x - pos.x) ** 2 + (a.y - pos.y) ** 2;
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

function clampToViewport(pos: Anchor, el: HTMLElement): Anchor {
  const maxX = Math.max(HUD_INSET, window.innerWidth - el.offsetWidth - HUD_INSET);
  const maxY = Math.max(HUD_INSET, window.innerHeight - el.offsetHeight - HUD_INSET);
  return {
    x: Math.min(maxX, Math.max(HUD_INSET, pos.x)),
    y: Math.min(maxY, Math.max(HUD_INSET, pos.y)),
  };
}

function useHudPosition(ref: RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<Anchor | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    void chrome.storage.local.get(HUD_KEY).then((raw) => {
      if (cancelled || !ref.current) return;
      const saved = raw[HUD_KEY] as Anchor | undefined;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        setPos(clampToViewport(saved, ref.current));
      } else {
        setPos(defaultPos(ref.current));
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ref]);

  useEffect(() => {
    const onResize = () => {
      const el = ref.current;
      if (!el) return;
      setPos((p) => (p ? nearestCorner(p, el) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ref]);

  const el = ref.current;
  const snapTo = el ? corners(el) : [];
  const bounds = el
    ? {
        minX: 8,
        minY: 8,
        maxX: Math.max(8, window.innerWidth - el.offsetWidth - 8),
        maxY: Math.max(8, window.innerHeight - el.offsetHeight - 8),
      }
    : undefined;

  useDraggable(ref, {
    position: pos ?? { x: 0, y: 0 },
    onMove: setPos,
    onRelease: (next) => {
      setPos(next);
      void chrome.storage.local.set({ [HUD_KEY]: next });
    },
    bounds,
    snapTo,
    disabled: !ready,
  });

  return { pos, ready };
}

function kindLabel(kind: "practice" | "interview", scope: "session" | "problem"): string {
  if (kind === "interview") return "Interview";
  return scope === "session" ? "Session" : "Problem";
}

function stageCopy(
  state: RecordingState,
  message?: string | null,
): { title: string; detail: string } {
  switch (state) {
    case "starting":
      return { title: "Starting recording…", detail: "Waiting for the desktop app." };
    case "stopping":
      return { title: "Stopping recording…", detail: "Saving the take." };
    case "error":
      return { title: "Recording failed", detail: message ?? "The desktop app reported an error." };
    case "paused":
      return { title: "Recording paused", detail: "Resume from the timer." };
    case "recording":
      return { title: "Recording", detail: "Screen and mic are live." };
    default:
      return { title: "Ready", detail: "" };
  }
}

function statusLabel(
  status: ReturnType<typeof timerStatus>,
  kind: "practice" | "interview",
): string {
  if (status === "paused") return "Paused";
  if (kind === "interview") return "Recording";
  return "Session running";
}

export function Overlay({ controller }: { controller: PageController }) {
  const page = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const session = page.snapshot?.state.session ?? null;
  const auth = page.snapshot?.auth ?? null;
  const recording = page.snapshot?.recording ?? null;
  const [open, setOpen] = useState(false);
  const [facecam, setFacecam] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const { pos, ready } = useHudPosition(rootRef);

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (open && !session) void controller.probeApp();
  }, [open, session, controller]);

  const sessionId = session?.sessionId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the trigger, not a value used inside
  useEffect(() => {
    setOpen(false);
    setConfirmEnd(false);
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const fab = fabRef.current;
    const first = menu?.querySelector<HTMLElement>("button:not(:disabled), input");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      fab?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const path = e.composedPath();
      if (menu && path.includes(menu)) return;
      if (fab && path.includes(fab)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);

  useEffect(() => {
    if (!confirmEnd) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setConfirmEnd(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirmEnd]);

  const status = session ? timerStatus(session.events) : "idle";
  const elapsed = session ? activeMs(session.events, Date.now()) : 0;
  const appConnected = page.snapshot?.appConnected ?? false;
  const onProblemPage = page.problem !== null;
  const showStage =
    !session &&
    recording !== null &&
    (recording.state === "starting" ||
      recording.state === "stopping" ||
      recording.state === "error");
  const problemDisabledId = "lare-reason-problem";
  const interviewDisabledId = "lare-reason-interview";
  const interviewReason = appConnected
    ? ""
    : "Open the Lare desktop app to record a mock interview";

  const startInterview = useCallback(() => {
    setOpen(false);
    void controller.start("interview", "problem", facecam);
  }, [controller, facecam]);

  const submissionCount = session
    ? session.problems.reduce((n, p) => n + p.submissions.length, 0)
    : 0;

  return (
    <div
      className="lare-root"
      ref={rootRef}
      data-placed={ready ? "1" : undefined}
      style={ready && pos ? { left: pos.x, top: pos.y } : undefined}
    >
      <div className="lare-toasts" aria-live="polite" aria-relevant="additions">
        {page.toasts.map((t) => (
          <div key={t.id} className={`lare-toast lare-toast--${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>

      {session ? (
        <div
          className={`lare-pill lare-pill--active ${status === "paused" ? "is-paused" : ""}`}
          data-testid="lare-pill"
        >
          <span
            className={`lare-dot ${session.kind === "interview" ? "lare-dot--rec" : ""}`}
            role="img"
            aria-label={statusLabel(status, session.kind)}
          />
          <span className="lare-kind" data-testid="lare-kind">
            {kindLabel(session.kind, session.scope)}
          </span>
          <span className="lare-time" data-testid="lare-time" role="timer">
            {formatDuration(elapsed)}
          </span>
          {session.problems.length > 0 && (
            <span className="lare-meta">
              {session.problems.length} problem{session.problems.length === 1 ? "" : "s"}
              {" · "}
              {submissionCount} submission{submissionCount === 1 ? "" : "s"}
            </span>
          )}
          {status === "running" ? (
            <button
              type="button"
              className="lare-btn"
              onClick={() => void controller.pause()}
              disabled={page.busy}
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              className="lare-btn"
              onClick={() => void controller.resume()}
              disabled={page.busy}
            >
              Resume
            </button>
          )}
          <div className="lare-end-wrap">
            <button
              type="button"
              className="lare-btn lare-btn--primary"
              onClick={() => setConfirmEnd(true)}
              disabled={page.busy}
              aria-expanded={confirmEnd}
              aria-haspopup="dialog"
            >
              End
            </button>
            {confirmEnd && (
              <div className="lare-confirm-sheet" role="dialog" aria-label="End session">
                <p>End and save this session?</p>
                <button
                  type="button"
                  className="lare-btn lare-btn--danger"
                  disabled={page.busy}
                  onClick={() => {
                    setConfirmEnd(false);
                    void controller.end();
                  }}
                >
                  Confirm end
                </button>
                <button type="button" className="lare-btn" onClick={() => setConfirmEnd(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : showStage ? (
        <div className="lare-stage" role="status" aria-live="polite">
          {recording.state !== "error" && <span className="lare-spinner" aria-hidden />}
          <div className="lare-stage-copy">
            <strong>{stageCopy(recording.state, recording.message).title}</strong>
            <span>{stageCopy(recording.state, recording.message).detail}</span>
          </div>
          {recording.state === "starting" && (
            <button
              type="button"
              className="lare-btn"
              onClick={() => void controller.cancelStart()}
            >
              Cancel
            </button>
          )}
          {recording.state === "error" && (
            <button
              type="button"
              className="lare-btn"
              onClick={() => void controller.cancelStart()}
            >
              Dismiss
            </button>
          )}
        </div>
      ) : (
        <div className="lare-launcher">
          <AnimatePresence>
            {open && (
              <m.div
                ref={menuRef}
                className="lare-menu"
                data-testid="lare-menu"
                role="menu"
                aria-label="Lare"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={SPRING.ui}
                style={{ transformOrigin: "bottom right" }}
              >
                {!auth ? (
                  <>
                    <div className="lare-menu-title">Sign in to Lare</div>
                    <button
                      type="button"
                      className="lare-menu-item"
                      onClick={() => void controller.signIn("github")}
                      disabled={page.busy}
                    >
                      Continue with GitHub
                    </button>
                    <button
                      type="button"
                      className="lare-menu-item"
                      onClick={() => void controller.signIn("google")}
                      disabled={page.busy}
                    >
                      Continue with Google
                    </button>
                    <div className="lare-menu-hint">
                      Or use the extension popup for email sign-in.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="lare-menu-title">
                      <span className="lare-menu-title-text">
                        {page.problem ? page.problem.title : "Open a problem to start"}
                      </span>
                      {page.problem?.difficulty && (
                        <span
                          className={`lare-diff lare-diff--${page.problem.difficulty.toLowerCase()}`}
                        >
                          {page.problem.difficulty}
                        </span>
                      )}
                    </div>
                    <div
                      className={`lare-armed ${page.monacoReady ? "is-ready" : ""}`}
                      role="status"
                    >
                      <span
                        className="lare-armed-dot"
                        role="img"
                        aria-label={page.monacoReady ? "Editor ready" : "Editor not ready"}
                      />
                      {page.monacoReady ? "Capture armed" : "Waiting for editor"}
                    </div>
                    <button
                      type="button"
                      className="lare-menu-item"
                      disabled={page.busy || !onProblemPage}
                      aria-describedby={!onProblemPage ? problemDisabledId : undefined}
                      onClick={() => void controller.start("practice", "problem")}
                    >
                      <strong>Start problem</strong>
                      <span>Timer for this problem only</span>
                    </button>
                    {!onProblemPage && (
                      <div id={problemDisabledId} className="lare-disabled-reason">
                        Open a LeetCode problem to start a single-problem timer.
                      </div>
                    )}
                    <button
                      type="button"
                      className="lare-menu-item"
                      disabled={page.busy}
                      onClick={() => void controller.start("practice", "session")}
                    >
                      <strong>Start session</strong>
                      <span>Timer across multiple problems</span>
                    </button>
                    <button
                      type="button"
                      className="lare-menu-item lare-menu-item--interview"
                      disabled={page.busy || !onProblemPage || !appConnected}
                      aria-describedby={!appConnected ? interviewDisabledId : undefined}
                      onClick={startInterview}
                    >
                      <strong>Mock interview</strong>
                      <span>
                        {appConnected
                          ? "Records screen + mic, AI review after"
                          : "Lare desktop app not detected"}
                      </span>
                    </button>
                    {!appConnected && (
                      <div id={interviewDisabledId} className="lare-disabled-reason">
                        {interviewReason}
                      </div>
                    )}
                    <label className="lare-check">
                      <input
                        type="checkbox"
                        checked={facecam}
                        onChange={(e) => setFacecam(e.target.checked)}
                      />
                      Include facecam
                    </label>
                    {!appConnected && (
                      <button
                        type="button"
                        className="lare-link"
                        onClick={() => void controller.probeApp()}
                      >
                        Retry app detection
                      </button>
                    )}
                  </>
                )}
              </m.div>
            )}
          </AnimatePresence>
          <div className="lare-fab-row">
            <span className="lare-grip" aria-hidden />
            <button
              ref={fabRef}
              type="button"
              className="lare-fab"
              data-testid="lare-fab"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-haspopup="menu"
            >
              <Emblem className="lare-fab-logo" />
              <span>Lare</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
