import { activeMs, formatDuration, timerStatus } from "@lare/shared";
import { useCallback, useEffect, useState } from "react";
import { type RuntimeSnapshot, type StateBroadcast, sendRuntime } from "@/src/messages";

const SITE_URL: string = import.meta.env.WXT_SITE_URL ?? "https://lare.vercel.app";

export function App() {
  const [snap, setSnap] = useState<RuntimeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    const res = await sendRuntime({ type: "GET_STATE" });
    if (res.ok && res.state) {
      setSnap({ state: res.state, auth: res.auth ?? null, appConnected: res.appConnected ?? false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    void sendRuntime({ type: "PROBE_APP" }).then((res) => {
      if (res.ok && res.state) {
        setSnap({ state: res.state, auth: res.auth ?? null, appConnected: res.appConnected ?? false });
      }
    });
    const listener = (raw: unknown) => {
      const msg = raw as Partial<StateBroadcast>;
      if (msg?.type === "STATE_CHANGED" && msg.state) {
        setSnap({ state: msg.state, auth: msg.auth ?? null, appConnected: msg.appConnected ?? false });
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
      else if (res.state) {
        setSnap({ state: res.state, auth: res.auth ?? null, appConnected: res.appConnected ?? false });
      }
      return res;
    } finally {
      setBusy(false);
    }
  };

  const session = snap?.state.session ?? null;
  const auth = snap?.auth ?? null;
  const status = session ? timerStatus(session.events) : "idle";

  return (
    <div className="popup">
      <header className="header">
        <div className="logo">L</div>
        <div>
          <div className="title">Lare</div>
          <div className="subtitle">Hevy for LeetCode</div>
        </div>
        <span className={`app-dot ${snap?.appConnected ? "on" : ""}`} title={snap?.appConnected ? "Desktop app connected" : "Desktop app not detected"} />
      </header>

      {error && <div className="error">{error}</div>}

      {!snap ? (
        <div className="muted">Loading…</div>
      ) : !auth ? (
        <section className="card">
          <div className="card-title">Sign in</div>
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => sendRuntime({ type: "SIGN_IN", provider: "github" }))}>
            Continue with GitHub
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => sendRuntime({ type: "SIGN_IN", provider: "google" }))}>
            Continue with Google
          </button>
          <div className="divider">or email</div>
          {!otpSent ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => sendRuntime({ type: "SIGN_IN_OTP", email })).then((r) => r.ok && setOtpSent(true));
              }}
            >
              <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
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
              <input inputMode="numeric" required placeholder="6-digit code" value={otp} onChange={(e) => setOtp(e.target.value)} />
              <button type="submit" className="btn btn-sm" disabled={busy || otp.trim().length < 6}>
                Verify
              </button>
            </form>
          )}
        </section>
      ) : (
        <>
          <section className="card user">
            {auth.avatarUrl ? <img src={auth.avatarUrl} alt="" className="avatar" /> : <div className="avatar" />}
            <div className="grow">
              <div className="name">{auth.displayName ?? auth.handle ?? auth.email ?? "Signed in"}</div>
              <div className="muted">{auth.handle ? `@${auth.handle}` : "Set a handle in the app"}</div>
            </div>
            <button type="button" className="link" disabled={busy || !!session} onClick={() => void run(() => sendRuntime({ type: "SIGN_OUT" }))}>
              Sign out
            </button>
          </section>

          <section className="card">
            {session ? (
              <>
                <div className="card-title">
                  {session.kind === "interview" ? "Mock interview" : session.scope === "session" ? "Practice session" : "Practice problem"}
                  <span className={`badge ${status}`}>{status}</span>
                </div>
                <div className="timer">{formatDuration(activeMs(session.events, Date.now()))}</div>
                <ul className="problems">
                  {session.problems.map((p) => (
                    <li key={p.sessionProblemId}>
                      <span>{p.problem.title}</span>
                      <span className="muted">
                        {p.submissions.filter((s) => s.accepted).length}/{p.submissions.length} accepted
                      </span>
                    </li>
                  ))}
                  {session.problems.length === 0 && <li className="muted">Open a problem to start tracking</li>}
                </ul>
                <div className="row">
                  {status === "running" ? (
                    <button type="button" className="btn" disabled={busy} onClick={() => void run(() => sendRuntime({ type: "PAUSE_SESSION" }))}>
                      Pause
                    </button>
                  ) : (
                    <button type="button" className="btn" disabled={busy} onClick={() => void run(() => sendRuntime({ type: "RESUME_SESSION" }))}>
                      Resume
                    </button>
                  )}
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => sendRuntime({ type: "END_SESSION" }))}>
                    End &amp; save
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="card-title">No active session</div>
                <p className="muted">Open a LeetCode problem and use the Lare button in the bottom-right corner to start.</p>
              </>
            )}
          </section>

          <section className="links">
            <button type="button" className="link" onClick={() => void sendRuntime({ type: "OPEN_APP" })}>
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
