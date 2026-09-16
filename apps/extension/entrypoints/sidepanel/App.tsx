import { activeMs, formatDuration, timerStatus } from "@lare/shared";
import { Emblem } from "@lare/ui/brand";
import { useCallback, useEffect, useState } from "react";
import { type RuntimeSnapshot, type StateBroadcast, sendRuntime, toSnapshot } from "@/src/messages";
import { PAGE_PROBLEM_REQUEST, type PageProblemReply } from "@/src/pageController";

type Tab = "tracking" | "interview";
const TABS: { id: Tab; label: string }[] = [
  { id: "tracking", label: "Tracking" },
  { id: "interview", label: "Mock interview" },
];

export function App() {
  const [snap, setSnap] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [facecam, setFacecam] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("tracking");
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
   * Interviews are the one thing still started by hand, and the side panel cannot
   * see the page, so ask the active tab which problem is open first.
   */
  const startInterview = async () => {
    setError(null);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setError("Open a LeetCode problem tab first.");
      return;
    }
    const tabId = tab.id;
    const ask = () =>
      chrome.tabs
        .sendMessage(tabId, { type: PAGE_PROBLEM_REQUEST })
        .then((r) => r as PageProblemReply | undefined)
        .catch(() => undefined);
    let reply = await ask();
    // A LeetCode tab opened before the extension loaded has no content script: add it, ask again.
    if (!reply?.problem && tab.url?.startsWith("https://leetcode.com/")) {
      await sendRuntime({ type: "INJECT_PAGE", tabId });
      for (let attempt = 0; attempt < 10 && !reply?.problem; attempt++) {
        await new Promise((r) => setTimeout(r, 300));
        reply = await ask();
      }
    }
    if (!reply?.problem) {
      setError("Open a LeetCode problem tab first.");
      return;
    }
    // The background asks the desktop app to record and waits until it is.
    await run(() =>
      sendRuntime({
        type: "START_INTERVIEW",
        problem: reply.problem,
        question: reply.question,
        facecam,
        tabId: tab.id ?? null,
      }),
    );
  };

  const interview = snap?.state.interview ?? null;
  const auth = snap?.auth ?? null;
  const status = interview ? timerStatus(interview.events) : "idle";
  const sessionId = interview?.sessionId ?? null;
  // Everything this device has noticed that hasn't been posted yet. Posting (and
  // clearing) happens in the desktop app, which reads the real inbox from the
  // server — this list is just a local, at-a-glance echo of it.
  const tracked = snap?.state.tracking.problems ?? [];
  const recording = snap?.recording ?? null;
  // A start can fail in the background after the panel request returned.
  const shownError =
    error ?? (!interview && recording?.state === "error" ? (recording.message ?? null) : null);
  const desktopBlocker = snap?.desktopBlocker ?? null;
  // Ids posted or cleared elsewhere must not stay selected.
  const selectedIds = selected.filter((id) => tracked.some((p) => p.sessionProblemId === id));

  const starting = !interview && recording?.state === "starting";

  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the trigger
  useEffect(() => {
    setConfirmEnd(false);
  }, [sessionId]);

  // A live interview is what the panel is for until it ends.
  useEffect(() => {
    if (sessionId || starting) setTab("interview");
  }, [sessionId, starting]);

  return (
    <div className="sidepanel">
      <header className="header">
        <Emblem className="logo" />
        <div className="brand">
          <div className="title">Lare</div>
          <div className="subtitle">Progress tracking for LeetCode</div>
        </div>
        <span
          className={`app-status ${snap?.appConnected ? "on" : ""}`}
          title={
            snap?.appConnected
              ? "Desktop app connected"
              : (desktopBlocker ?? "Desktop app not detected")
          }
        >
          <span className="app-dot" aria-hidden />
          {snap?.appConnected ? "Desktop" : "No desktop"}
        </span>
      </header>

      {snap && snap.buildId !== __BUILD_ID__ && (
        <div className="stale" role="alert">
          <span>
            Lare was rebuilt, but Chrome is still running the old version in the background.
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => chrome.runtime.reload()}
          >
            Reload Lare
          </button>
        </div>
      )}

      {shownError && <div className="error">{shownError}</div>}

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
          <div className="tabs" role="tablist" aria-label="Lare">
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === t.id}
                aria-controls={`pane-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  const step = e.key === "ArrowRight" ? 1 : TABS.length - 1;
                  const next = TABS[(TABS.indexOf(t) + step) % TABS.length];
                  if (!next) return;
                  setTab(next.id);
                  document.getElementById(`tab-${next.id}`)?.focus();
                }}
              >
                {t.label}
                {t.id === "tracking" && tracked.length > 0 && (
                  <span className="tab-count">{tracked.length}</span>
                )}
                {t.id === "interview" && (interview || starting) && (
                  <span className="tab-live" role="img" aria-label="In progress" />
                )}
                {t.id === "interview" && !interview && !!snap.state.pendingSync.length && (
                  <span className="tab-alert" role="img" aria-label="Needs attention" />
                )}
              </button>
            ))}
          </div>

          {tab === "tracking" ? (
            <section
              className="pane"
              id="pane-tracking"
              role="tabpanel"
              aria-labelledby="tab-tracking"
            >
              <h2 className="card-title">
                Tracking submissions
                <span className="badge on">On</span>
              </h2>
              <p className="note">
                Problems and submissions are saved to your cloud inbox. No desktop app needed.
              </p>
              {tracked.length > 0 && (
                <div className="list-bar">
                  <span>
                    {selectedIds.length > 0
                      ? `${selectedIds.length} of ${tracked.length} selected`
                      : `${tracked.length} tracked`}
                  </span>
                  {!confirmClear && (
                    <button
                      type="button"
                      className="link"
                      disabled={busy}
                      onClick={() => setConfirmClear(true)}
                    >
                      {selectedIds.length > 0
                        ? `Clear ${selectedIds.length} selected`
                        : "Clear all"}
                    </button>
                  )}
                </div>
              )}
              <ul className="problems">
                {tracked.map((p) => (
                  <li key={p.sessionProblemId}>
                    <label className="problem">
                      <input
                        type="checkbox"
                        className="check"
                        aria-label={`Select ${p.title || p.slug}`}
                        disabled={!p.synced}
                        checked={selectedIds.includes(p.sessionProblemId)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selectedIds, p.sessionProblemId]
                              : selectedIds.filter((id) => id !== p.sessionProblemId),
                          )
                        }
                      />
                      <span className="problem-title">{p.title || p.slug}</span>
                      <span className="problem-meta">
                        {p.submissionCount === 0
                          ? "opened"
                          : `${p.acceptedCount}/${p.submissionCount} accepted`}
                      </span>
                    </label>
                  </li>
                ))}
                {tracked.length === 0 && (
                  <li className="problems-empty">Nothing tracked yet — open a LeetCode problem.</li>
                )}
              </ul>
              <button
                type="button"
                className="btn"
                disabled={busy || selectedIds.length === 0}
                onClick={() =>
                  void run(() => sendRuntime({ type: "PUBLISH_PROBLEMS", ids: selectedIds })).then(
                    (res) => {
                      setSelected([]);
                      // The draft is edited in the desktop app; the website is a landing page.
                      if (res.ok && res.postId)
                        void sendRuntime({ type: "OPEN_APP", path: `drafts/${res.postId}` });
                    },
                  )
                }
              >
                Create draft from selected problems
              </button>
              {confirmClear && (
                <div className="confirm-sheet" role="dialog" aria-label="Clear tracked problems">
                  <p>
                    {selectedIds.length > 0
                      ? `Remove ${selectedIds.length} selected problem${selectedIds.length === 1 ? "" : "s"}`
                      : "Remove every tracked problem"}{" "}
                    from your inbox without posting? Their captured submissions are deleted too.
                  </p>
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => {
                        setConfirmClear(false);
                        const ids = selectedIds.length > 0 ? selectedIds : undefined;
                        void run(() => sendRuntime({ type: "CLEAR_TRACKED", ids })).then(() =>
                          setSelected([]),
                        );
                      }}
                    >
                      Confirm clear
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : (
            <section
              className="pane"
              id="pane-interview"
              role="tabpanel"
              aria-labelledby="tab-interview"
            >
              {interview ? (
                <>
                  <h2 className="card-title">
                    Mock interview
                    <span className={`badge ${status}`}>{status}</span>
                  </h2>
                  <div className="timer" role="timer">
                    {formatDuration(activeMs(interview.events, Date.now()))}
                  </div>
                  <p className="note">The desktop app is recording your screen and microphone.</p>
                  {recording?.state === "recording" && (
                    <p className="muted">A red dot shows on the problem page while it records.</p>
                  )}
                  <ul className="problems">
                    {interview.problems.map((p) => (
                      <li key={p.sessionProblemId} className="problem plain">
                        <span className="problem-title">{p.problem.title}</span>
                        <span className="problem-meta">
                          {p.submissions.filter((sub) => sub.accepted).length}/
                          {p.submissions.length} accepted
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
                        disabled={busy || status === "ended"}
                        onClick={() => void run(() => sendRuntime({ type: "RESUME_SESSION" }))}
                      >
                        Resume
                      </button>
                    )}
                    {!confirmEnd && status !== "ended" ? (
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
                  <p className="muted">
                    The Lare desktop app records your screen and microphone while you solve, then
                    transcribes it locally for the AI review. Camera is optional.
                  </p>
                  <div className="options">
                    <div className="option">
                      <label className="option-row">
                        Include camera
                        <input
                          type="checkbox"
                          className="switch"
                          checked={facecam}
                          onChange={(e) => setFacecam(e.target.checked)}
                        />
                      </label>
                    </div>
                  </div>
                  {desktopBlocker && (
                    <p className="error" role="status">
                      {desktopBlocker}
                    </p>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || starting || !!desktopBlocker}
                    onClick={() => void startInterview()}
                  >
                    Start mock interview
                  </button>
                  {starting && (
                    <div className="row">
                      <p className="muted" role="status">
                        Waiting for the desktop app to start recording…
                      </p>
                      <button
                        type="button"
                        className="link"
                        onClick={() => void run(() => sendRuntime({ type: "CANCEL_START" }))}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="link link-quiet"
                    disabled={busy}
                    onClick={() => void run(() => sendRuntime({ type: "PROBE_APP" }))}
                  >
                    Check desktop connection
                  </button>
                </>
              )}

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
            </section>
          )}

          <footer className="footer">
            <div className="account">
              {auth.avatarUrl ? (
                <img src={auth.avatarUrl} alt="" className="avatar" />
              ) : (
                <div className="avatar" />
              )}
              <div className="grow">
                <div className="name">
                  {auth.displayName ?? auth.handle ?? auth.email ?? "Signed in"}
                </div>
                <div className="handle">
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
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
