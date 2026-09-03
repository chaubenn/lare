import { activeMs, formatDuration, timerStatus } from "@lare/shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { PageController } from "@/src/pageController";

export function Overlay({ controller }: { controller: PageController }) {
  const page = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const session = page.snapshot?.state.session ?? null;
  const auth = page.snapshot?.auth ?? null;
  const [open, setOpen] = useState(false);
  const [facecam, setFacecam] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Re-render every second while a session is running so the timer ticks.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (open && !session) void controller.probeApp();
  }, [open, session, controller]);

  // Collapse the launcher whenever a session starts or ends.
  const sessionId = session?.sessionId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the trigger, not a value used inside
  useEffect(() => {
    setOpen(false);
    setConfirmEnd(false);
  }, [sessionId]);

  const status = session ? timerStatus(session.events) : "idle";
  const elapsed = session ? activeMs(session.events, Date.now()) : 0;
  const appConnected = page.snapshot?.appConnected ?? false;
  const onProblemPage = page.problem !== null;

  return (
    <div className="lare-root">
      <div className="lare-toasts">
        {page.toasts.map((t) => (
          <div key={t.id} className={`lare-toast lare-toast--${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>

      {session ? (
        <div className={`lare-pill lare-pill--active ${status === "paused" ? "is-paused" : ""}`}>
          <span className={`lare-dot ${session.kind === "interview" ? "lare-dot--rec" : ""}`} />
          <span className="lare-kind">
            {session.kind === "interview"
              ? "Interview"
              : session.scope === "session"
                ? "Session"
                : "Problem"}
          </span>
          <span className="lare-time">{formatDuration(elapsed)}</span>
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
          {confirmEnd ? (
            <>
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
            </>
          ) : (
            <button
              type="button"
              className="lare-btn lare-btn--primary"
              onClick={() => setConfirmEnd(true)}
              disabled={page.busy}
            >
              End
            </button>
          )}
          {session.problems.length > 0 && (
            <span className="lare-meta" title="Problems in this session">
              {session.problems.length} problem{session.problems.length === 1 ? "" : "s"}
              {" · "}
              {session.problems.reduce((n, p) => n + p.submissions.length, 0)} submission
              {session.problems.reduce((n, p) => n + p.submissions.length, 0) === 1 ? "" : "s"}
            </span>
          )}
        </div>
      ) : (
        <div className="lare-launcher">
          {open && (
            <div className="lare-menu">
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
                    {page.problem ? page.problem.title : "Open a problem to start"}
                    {page.problem?.difficulty && (
                      <span
                        className={`lare-diff lare-diff--${page.problem.difficulty.toLowerCase()}`}
                      >
                        {page.problem.difficulty}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="lare-menu-item"
                    disabled={page.busy || !onProblemPage}
                    onClick={() => void controller.start("practice", "problem")}
                  >
                    <strong>Start problem</strong>
                    <span>Timer for this problem only</span>
                  </button>
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
                    title={
                      appConnected ? "" : "Open the Lare desktop app to record a mock interview"
                    }
                    onClick={() => void controller.start("interview", "problem", facecam)}
                  >
                    <strong>Mock interview</strong>
                    <span>
                      {appConnected
                        ? "Records screen + mic, AI review after"
                        : "Lare desktop app not detected"}
                    </span>
                  </button>
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
            </div>
          )}
          <button
            type="button"
            className="lare-fab"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <span className="lare-fab-logo">L</span>
            <span>Lare</span>
          </button>
        </div>
      )}
    </div>
  );
}
