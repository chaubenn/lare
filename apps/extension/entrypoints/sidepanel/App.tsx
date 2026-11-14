import {
  activeMs,
  enabledOAuthProviders,
  formatDuration,
  OAUTH_PROVIDER_LABELS,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  timerStatus,
} from "@lare/shared";
import { Emblem } from "@lare/ui/brand";
import { useCallback, useEffect, useState } from "react";
import { applySnapshot, type RuntimeSnapshot, sendRuntime, sendToTab } from "@/src/messages";
import { isLeetcodeUrl } from "@/src/origins";
import { type Theme, useTheme } from "@/src/theme";

type Tab = "tracking" | "interview";
const TABS: { id: Tab; label: string }[] = [
  { id: "tracking", label: "Tracking" },
  { id: "interview", label: "Mock interview" },
];

const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** Light, dark or follow the system, shown whether or not anyone is signed in. */
function Appearance() {
  const [theme, setTheme] = useTheme();
  return (
    <fieldset className="appearance" aria-label="Appearance">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className="tab"
          aria-pressed={theme === t.id}
          onClick={() => setTheme(t.id)}
        >
          {t.label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The whole side panel: sign-in, the tracking controls and the recording settings.
 * Mirrors the background runtime's snapshot, so every action round-trips through
 * `sendRuntime` rather than keeping its own copy of the session state.
 */
export function App() {
  const [snap, setSnap] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  /** Which of the interview's two endings is waiting to be confirmed. */
  const [confirmFinish, setConfirmFinish] = useState<"end" | "discard" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDiscardUnsaved, setConfirmDiscardUnsaved] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [facecam, setFacecam] = useState(false);
  const [graded, setGraded] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("tracking");
  /** The sign-in buttons to show: the providers the Supabase project has switched on. */
  const [providers, setProviders] = useState<readonly OAuthProvider[]>(OAUTH_PROVIDERS);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    applySnapshot(await sendRuntime({ type: "GET_STATE" }), setSnap);
  }, []);

  useEffect(() => {
    void refresh();
    void sendRuntime({ type: "PROBE_APP" }).then((res) => applySnapshot(res, setSnap));
    const listener = (raw: unknown) => applySnapshot(raw, setSnap);
    chrome.runtime.onMessage.addListener(listener);
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(id);
    };
  }, [refresh]);

  // A provider that is off in Supabase opens a window that can never come back signed in, so only
  // the ones that are on get a button. Asked while signed out, which is when the buttons show.
  const signedOut = snap !== null && !snap.auth;
  useEffect(() => {
    if (!signedOut) return;
    let active = true;
    void enabledOAuthProviders(
      import.meta.env.WXT_SUPABASE_URL,
      import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY,
    ).then((enabled) => {
      if (active) setProviders(enabled);
    });
    return () => {
      active = false;
    };
  }, [signedOut]);

  const run = async (fn: () => ReturnType<typeof sendRuntime>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else applySnapshot(res, setSnap);
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
    const ask = () => sendToTab(tabId, { type: "LARE_PAGE_PROBLEM" });
    let reply = await ask();
    // A LeetCode tab opened before the extension loaded has no content script: add it, ask again.
    if (!reply?.problem && isLeetcodeUrl(tab.url)) {
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
        graded,
        tabId: tab.id ?? null,
      }),
    );
  };

  const interview = snap?.state.interview ?? null;
  const auth = snap?.auth ?? null;
  const status = interview ? timerStatus(interview.events) : "idle";
  const sessionId = interview?.sessionId ?? null;
  // Everything this device has noticed that hasn't been posted yet: a local, at-a-glance echo
  // of the server inbox, which the desktop app reads directly.
  const tracked = snap?.state.tracking.problems ?? [];
  // Ended interviews whose save failed. They no longer hold up anything else; the background
  // keeps retrying them until they save or are discarded here.
  const unsaved = snap?.state.unsaved ?? [];
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
    setConfirmFinish(null);
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
          {providers.map((provider) => (
            <button
              key={provider}
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run(() => sendRuntime({ type: "SIGN_IN", provider }))}
            >
              Continue with {OAUTH_PROVIDER_LABELS[provider]}
            </button>
          ))}
          {providers.length > 0 && <div className="divider">or email</div>}
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
                {t.id === "interview" && !interview && unsaved.length > 0 && (
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
                {tracked.length === 0 && <li className="problems-empty">Nothing tracked yet</li>}
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
                  {recording?.state === "error" ? (
                    // The recording stopped or was lost (say, the app restarted); the timer did not.
                    <p className="error" role="status">
                      {recording.message ?? "The desktop app stopped recording."}
                    </p>
                  ) : (
                    <p className="note">The desktop app is recording your screen and microphone.</p>
                  )}
                  <p className="muted">
                    {interview.graded
                      ? "Graded: transcribed locally, then AI reviewed."
                      : "Ungraded: video only, no transcript or AI review."}
                  </p>
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
                    {!confirmFinish && status !== "ended" ? (
                      <>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => setConfirmFinish("discard")}
                        >
                          Discard
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy}
                          onClick={() => setConfirmFinish("end")}
                        >
                          End &amp; save
                        </button>
                      </>
                    ) : null}
                  </div>
                  {confirmFinish && (
                    <div
                      className="confirm-sheet"
                      role="dialog"
                      aria-label={
                        confirmFinish === "end" ? "End mock interview" : "Discard mock interview"
                      }
                    >
                      <p>
                        {confirmFinish === "end"
                          ? "End and save this mock interview?"
                          : "Discard this mock interview? The recording is deleted and nothing is saved."}
                      </p>
                      <div className="row">
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={busy}
                          onClick={() => {
                            const type =
                              confirmFinish === "end" ? "END_SESSION" : "DISCARD_SESSION";
                            setConfirmFinish(null);
                            void run(() => sendRuntime({ type }));
                          }}
                        >
                          {confirmFinish === "end" ? "Confirm end" : "Confirm discard"}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setConfirmFinish(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="muted">
                    The Lare desktop app records your screen and microphone while you solve. Camera
                    is optional.
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
                          ? "The desktop app transcribes the recording locally, then it can be AI reviewed."
                          : "Video only: no transcript and no AI review."}
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

              {unsaved.length > 0 && (
                <section className="card retry">
                  <div className="card-title">
                    {unsaved.length === 1
                      ? "Couldn’t save a mock interview"
                      : `Couldn’t save ${unsaved.length} mock interviews`}
                  </div>
                  <p className="muted">
                    {unsaved.length === 1
                      ? "It’s still on this device and Lare keeps retrying in the background."
                      : "They’re still on this device and Lare keeps retrying in the background."}{" "}
                    You can start another interview in the meantime.
                  </p>
                  {confirmDiscardUnsaved ? (
                    <div className="confirm-sheet" role="dialog" aria-label="Discard unsaved">
                      <p>
                        Stop retrying and remove{" "}
                        {unsaved.length === 1 ? "it" : `all ${unsaved.length}`} from this device? No
                        draft is created. The desktop app keeps its copy of the recording.
                      </p>
                      <div className="row">
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={busy}
                          onClick={() => {
                            setConfirmDiscardUnsaved(false);
                            void run(() => sendRuntime({ type: "DISCARD_UNSAVED" }));
                          }}
                        >
                          Confirm discard
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setConfirmDiscardUnsaved(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => void run(() => sendRuntime({ type: "RETRY_SYNC" }))}
                      >
                        Retry now
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => setConfirmDiscardUnsaved(true)}
                      >
                        Discard
                      </button>
                    </div>
                  )}
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
                title={interview ? "End the mock interview before signing out" : undefined}
                onClick={() =>
                  // Signing out clears this device's state, unsaved interviews included.
                  unsaved.length > 0
                    ? setConfirmSignOut(true)
                    : void run(() => sendRuntime({ type: "SIGN_OUT" }))
                }
              >
                Sign out
              </button>
            </div>
            {confirmSignOut && (
              <div className="confirm-sheet" role="dialog" aria-label="Sign out">
                <p>
                  {unsaved.length === 1
                    ? "A mock interview hasn’t been saved yet. Signing out removes it from this device."
                    : `${unsaved.length} mock interviews haven’t been saved yet. Signing out removes them from this device.`}{" "}
                  The desktop app keeps its copy of the recording.
                </p>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => {
                      setConfirmSignOut(false);
                      void run(() => sendRuntime({ type: "SIGN_OUT" }));
                    }}
                  >
                    Sign out anyway
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmSignOut(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </footer>
        </>
      )}

      <Appearance />
    </div>
  );
}
