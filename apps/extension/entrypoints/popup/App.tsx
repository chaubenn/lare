import { activeMs, formatDuration, timerStatus } from "@lare/shared";
import { Emblem } from "@lare/ui/brand";
import { useCallback, useEffect, useState } from "react";
import { type RuntimeSnapshot, type StateBroadcast, sendRuntime, toSnapshot } from "@/src/messages";
import { PAGE_PROBLEM_REQUEST, type PageProblemReply } from "@/src/pageController";

const SITE_URL: string = import.meta.env.WXT_SITE_URL ?? "https://lare-one.vercel.app";

export function App() {
  const [snap, setSnap] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const res = await sendRuntime({ type: "GET_STATE" });
    if (res.ok) {
      const next = toSnapshot(res);
      if (next) setSnap(next);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void sendRuntime({ type: "PROBE_APP" }).then((res) => {
      if (res.ok) {
        const next = toSnapshot(res);
        if (next) setSnap(next);
      }
    });
    const listener = (raw: unknown) => {
      const msg = raw as Partial<StateBroadcast>;
      if (msg?.type === "STATE_CHANGED") {
        const next = toSnapshot(msg);
        if (next) setSnap(next);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(id);
    };
  }, [refresh]);

  const run = async (fn: () => ReturnType<typeof sendRuntime>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        const next = toSnapshot(res);
        if (next) setSnap(next);
      }
      return res;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Interviews are the one thing still started by hand, and the popup cannot see
   * the page, so ask the active tab which problem is open first.
   */
  const startInterview = async () => {
    setError(null);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setError("Open a LeetCode problem tab first.");
      return;
    }
    let reply: PageProblemReply | undefined;
    try {
      reply = (await chrome.tabs.sendMessage(tab.id, { type: PAGE_PROBLEM_REQUEST })) as
        | PageProblemReply
        | undefined;
    } catch {
      setError("Open a LeetCode problem tab first.");
      return;
    }
    if (!reply?.problem) {
      setError("Open a LeetCode problem tab first.");
      return;
    }
    await run(() =>
      sendRuntime({
        type: "START_INTERVIEW",
        problem: reply.problem,
        question: reply.question,
        facecam: false,
        tabId: tab.id ?? null,
      }),
    );
  };

  const interview = snap?.state.interview ?? null;
  const auth = snap?.auth ?? null;
  const status = interview ? timerStatus(interview.events) : "idle";
  const sessionId = interview?.sessionId ?? null;
  // Only what is still waiting: reviewed problems stay in state as the slug -> row
  // map, but the popup and the badge treat them as cleared.
  const tracked = (snap?.state.tracking.problems ?? []).filter((p) => p.reviewedAt === null);
  const recording = snap?.recording ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the trigger
  useEffect(() => {
    setConfirmEnd(false);
  }, [sessionId]);

  return (
    <div className="popup">
      <header className="header">
        <Emblem className="logo" />
        <div>
          <div className="title">Lare</div>
          <div className="subtitle">Hevy for LeetCode</div>
        </div>
        <span
          className={`app-dot ${snap?.appConnected ? "on" : ""}`}
          role="img"
          aria-label={snap?.appConnected ? "Desktop app connected" : "Desktop app not detected"}
        />
      </header>

      {error && <div className="error">{error}</div>}

      {!snap ? (
        <div className="muted">Loading…</div>
      ) : !auth ? (
        <section className="card">
          <div className="card-title">Sign in</div>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void run(() => sendRuntime({ type: "SIGN_IN", provider: "github" }))}
          >
            Continue with GitHub
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void run(() => sendRuntime({ type: "SIGN_IN", provider: "google" }))}
          >
            Continue with Google
          </button>
          <div className="divider">or email</div>
          {!otpSent ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => sendRuntime({ type: "SIGN_IN_OTP", email })).then(
                  (r) => r.ok && setOtpSent(true),
                );
              }}
            >
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="btn btn-sm" disabled={busy || !email}>
                Send code
              </button>
            </form>
          ) : (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => sendRuntime({ type: "VERIFY_OTP", email, token: otp.trim() }));
              }}
            >
              <input
                inputMode="numeric"
                required
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
              <button type="submit" className="btn btn-sm" disabled={busy || otp.trim().length < 6}>
                Verify
              </button>
            </form>
          )}
        </section>
      ) : (
        <>
          <section className="card user">
            {auth.avatarUrl ? (
              <img src={auth.avatarUrl} alt="" className="avatar" />
            ) : (
              <div className="avatar" />
            )}
            <div className="grow">
              <div className="name">
                {auth.displayName ?? auth.handle ?? auth.email ?? "Signed in"}
              </div>
              <div className="muted">
                {auth.handle ? `@${auth.handle}` : "Set a handle in the app"}
              </div>
            </div>
            <button
              type="button"
              className="link"
              disabled={busy || !!interview}
              onClick={() => void run(() => sendRuntime({ type: "SIGN_OUT" }))}
            >
              Sign out
            </button>
          </section>

          <section className="card">
            <div className="card-title">
              Tracking submissions
              <span className="badge running">on</span>
            </div>
            <p className="muted">
              Every problem you open and every submission you make is saved automatically. Pick
              which ones to post from the desktop app.
            </p>
            <ul className="problems">
              {tracked.map((p) => (
                <li key={p.sessionProblemId}>
                  <span>{p.title || p.slug}</span>
                  <span className="muted">
                    {p.submissionCount === 0
                      ? "opened"
                      : `${p.acceptedCount}/${p.submissionCount} accepted`}
                  </span>
                </li>
              ))}
              {tracked.length === 0 && (
                <li className="muted">Nothing tracked yet — open a LeetCode problem.</li>
              )}
            </ul>
            {tracked.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void sendRuntime({ type: "OPEN_APP", path: "drafts" });
                  // Handing them over clears them here; the desktop app keeps
                  // listing everything that has not been posted.
                  void run(() => sendRuntime({ type: "MARK_TRACKED_REVIEWED" }));
                }}
              >
                Review {tracked.length === 1 ? "1 problem" : `${tracked.length} problems`} in Lare
              </button>
            )}
          </section>

          <section className="card">
            {interview ? (
              <>
                <div className="card-title">
                  Mock interview
                  <span className={`badge ${status}`}>{status}</span>
                </div>
                <div className="timer" role="timer">
                  {formatDuration(activeMs(interview.events, Date.now()))}
                </div>
                {recording?.state === "recording" && (
                  <p className="muted">Recording. A red dot shows on the problem page.</p>
                )}
                <ul className="problems">
                  {interview.problems.map((p) => (
                    <li key={p.sessionProblemId}>
                      <span>{p.problem.title}</span>
                      <span className="muted">
                        {p.submissions.filter((sub) => sub.accepted).length}/{p.submissions.length}{" "}
                        accepted
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="row">
                  {status === "running" ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void run(() => sendRuntime({ type: "PAUSE_SESSION" }))}
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void run(() => sendRuntime({ type: "RESUME_SESSION" }))}
                    >
                      Resume
                    </button>
                  )}
                  {!confirmEnd ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => setConfirmEnd(true)}
                    >
                      End &amp; save
                    </button>
                  ) : null}
                </div>
                {confirmEnd && (
                  <div className="confirm-sheet" role="dialog" aria-label="End mock interview">
                    <p>End and save this mock interview?</p>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={() => {
                          setConfirmEnd(false);
                          void run(() => sendRuntime({ type: "END_SESSION" }));
                        }}
                      >
                        Confirm end
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirmEnd(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="card-title">Mock interview</div>
                <p className="muted">
                  {snap.appConnected
                    ? "Records your screen and mic on the problem you have open, then grades it."
                    : "Open the Lare desktop app to record a mock interview."}
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !snap.appConnected}
                  onClick={() => void startInterview()}
                >
                  Start mock interview
                </button>
              </>
            )}
          </section>

          {!!snap.state.pendingSync.length && (
            <section className="card retry">
              <div className="card-title">Couldn’t save a mock interview</div>
              <p className="muted">
                {snap.state.pendingSync.length === 1
                  ? "The last mock interview is still on this device. Retry the upload."
                  : `${snap.state.pendingSync.length} mock interviews are waiting to sync.`}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void run(() => sendRuntime({ type: "RETRY_SYNC" }))}
              >
                Retry sync
              </button>
            </section>
          )}

          <section className="links">
            <button
              type="button"
              className="link"
              onClick={() => void sendRuntime({ type: "OPEN_APP" })}
            >
              Open desktop app
            </button>
            <a href={SITE_URL} target="_blank" rel="noreferrer" className="link">
              Open lare.app
            </a>
          </section>
        </>
      )}
    </div>
  );
}
