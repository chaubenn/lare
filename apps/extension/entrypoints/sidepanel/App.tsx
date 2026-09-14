import { activeMs, formatDuration, timerStatus } from "@lare/shared";
import { Emblem } from "@lare/ui/brand";
import { useCallback, useEffect, useState } from "react";
import { hasMediaPermission, requestMediaPermission } from "@/src/mediaPermission";
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
  const [confirmClear, setConfirmClear] = useState(false);
  // Follows whether the desktop app can grade until the user picks, so a fresh install without the
  // app is not stuck on a disabled Start button.
  const [gradedChoice, setGraded] = useState<boolean | null>(null);
  const [facecam, setFacecam] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
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
    // The side panel cannot show a permission prompt, so ask from a tab (see mediaPermission.ts).
    if (!(await hasMediaPermission(facecam))) {
      setBusy(true);
      try {
        const result = await requestMediaPermission(facecam);
        if (!result.granted) {
          setError(result.error ?? "Microphone access is required for a mock interview.");
          return;
        }
      } finally {
        setBusy(false);
      }
      await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
    }
    await run(() =>
      sendRuntime({
        type: "START_INTERVIEW",
        problem: reply.problem,
        question: reply.question,
        facecam,
        graded,
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
  // Failures after the toolbar hand-off happen in the background, not in a panel request.
  const shownError =
    error ?? (!interview && recording?.state === "error" ? (recording.message ?? null) : null);
  const awaiting = !!snap?.awaitingToolbarClick;
  const graded = gradedChoice ?? !!snap?.appConnected;
  const gradingBlocker = snap?.gradingBlocker ?? null;
  // Ids posted or cleared elsewhere must not stay selected.
  const selectedIds = selected.filter((id) => tracked.some((p) => p.sessionProblemId === id));

  // Waiting on the toolbar click can outlast the worker's 30 s idle limit; keep it awake.
  useEffect(() => {
    if (!awaiting) return;
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [awaiting, refresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionId is the trigger
  useEffect(() => {
    setConfirmEnd(false);
  }, [sessionId]);

  return (
    <div className="sidepanel">
      <header className="header">
        <Emblem className="logo" />
        <div className="brand">
          <div className="title">Lare</div>
          <div className="subtitle">Hevy for LeetCode</div>
        </div>
        <span
          className={`app-status ${snap?.appConnected ? "on" : ""}`}
          title={snap?.appConnected ? "Desktop app connected" : "Desktop app not detected"}
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
          <section className="account">
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
          </section>

          <section className="card">
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
                    {selectedIds.length > 0 ? `Clear ${selectedIds.length} selected` : "Clear all"}
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
                    if (res.ok && res.postId)
                      void chrome.tabs.create({ url: `${SITE_URL}/drafts/${res.postId}` });
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

          <section className="card">
            {interview ? (
              <>
                <h2 className="card-title">
                  Mock interview
                  <span className={`badge ${status}`}>{status}</span>
                </h2>
                <div className="timer" role="timer">
                  {formatDuration(activeMs(interview.events, Date.now()))}
                </div>
                <p className="note">
                  {snap.capture?.graded
                    ? "Graded: local Whisper and AI review"
                    : "Ungraded: video only, no transcript or AI review"}
                </p>
                {snap.capture?.message && (
                  <p className="muted" role="status">
                    {snap.capture.message}
                  </p>
                )}
                {!!snap.capture?.recordedBytes && (
                  <p className="muted">
                    {((snap.capture.uploadedBytes ?? 0) / 1048576).toFixed(1)} /{" "}
                    {(snap.capture.recordedBytes / 1048576).toFixed(1)} MB uploaded
                  </p>
                )}
                {snap.capture?.transcript && (
                  <section className="transcript" aria-label="Live transcript">
                    {snap.capture.transcript}
                  </section>
                )}
                {recording?.state === "recording" && (
                  <p className="muted">Recording. A red dot shows on the problem page.</p>
                )}
                <ul className="problems">
                  {interview.problems.map((p) => (
                    <li key={p.sessionProblemId} className="problem plain">
                      <span className="problem-title">{p.problem.title}</span>
                      <span className="problem-meta">
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
                <h2 className="card-title">Mock interview</h2>
                <p className="note">
                  Record this problem tab and microphone in Chrome. Camera is optional.
                </p>
                <div className="options">
                  <div className="option">
                    <label className="option-row">
                      Transcript &amp; AI review
                      <input
                        type="checkbox"
                        className="switch"
                        checked={graded}
                        onChange={(e) => setGraded(e.target.checked)}
                      />
                    </label>
                    <p className="option-hint">
                      {graded
                        ? "Transcribed by local Whisper in the desktop app, then AI reviewed."
                        : "Ungraded: video only. Disables both transcript and AI review; desktop is not required."}
                    </p>
                  </div>
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
                {graded && gradingBlocker && (
                  <p className="error" role="status">
                    Can't grade yet: {gradingBlocker} Or untick Transcript &amp; AI review to record
                    without it.
                  </p>
                )}
                {snap.awaitingToolbarClick ? (
                  <div className="handoff" role="status">
                    <Emblem className="handoff-icon" />
                    <div className="grow">
                      <div className="handoff-title">Click the Lare icon in your toolbar</div>
                      <p className="muted">
                        Chrome only lets Lare record a tab after you click its icon on that tab.
                        Recording starts as soon as you do. It's under the puzzle piece if unpinned,
                        or press Alt+Shift+L.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="link"
                      onClick={() => void run(() => sendRuntime({ type: "CANCEL_START" }))}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || (graded && !!gradingBlocker)}
                    onClick={() => void startInterview()}
                  >
                    Start mock interview
                  </button>
                )}
                <button
                  type="button"
                  className="link link-quiet"
                  disabled={busy}
                  onClick={() => void run(() => sendRuntime({ type: "PROBE_APP" }))}
                >
                  Check desktop grading connection
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
              {snap.capture?.state === "error" && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Permanently discard the failed video and save the session without video, transcript or AI review?",
                      )
                    )
                      void run(() => sendRuntime({ type: "DISCARD_RECORDING" }));
                  }}
                >
                  Discard failed video and keep session
                </button>
              )}
            </section>
          )}

          {!interview && snap.capture?.state === "complete" && (
            <section className="card" aria-label="Last recording">
              <div className="card-title">
                {snap.capture.graded ? "Graded interview saved" : "Ungraded session saved"}
              </div>
              {snap.capture.message && <p role="status">{snap.capture.message}</p>}
              <p className="muted">
                {snap.capture.graded
                  ? "Local transcript and AI review included."
                  : "No transcript or AI review included."}{" "}
                Upload acknowledgement does not mean playback encoding is finished.
              </p>
              <a href={`${SITE_URL}/drafts`} target="_blank" rel="noreferrer" className="link">
                Review and publish your draft
              </a>
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
            <a href={`${SITE_URL}/drafts`} target="_blank" rel="noreferrer" className="link">
              Review drafts
            </a>
          </section>
        </>
      )}
    </div>
  );
}
