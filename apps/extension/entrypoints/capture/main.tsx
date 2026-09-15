import "@fontsource-variable/outfit";
import { Emblem } from "@lare/ui/brand";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CaptureState } from "@/src/capture";
import { type HostPhase, hostBusy, installCaptureHost, onHostChange } from "@/src/captureHost";

installCaptureHost();

// Closing the window mid-recording loses whatever has not uploaded yet.
window.addEventListener("beforeunload", (event) => {
  if (hostBusy()) {
    event.preventDefault();
    event.returnValue = "";
  }
});

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  return `${mm}:${String(s % 60).padStart(2, "0")}`;
}

function Recorder() {
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [phase, setPhase] = useState<HostPhase>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(
    () =>
      onHostChange((state, next) => {
        setCapture(state);
        setPhase(next);
      }),
    [],
  );
  useEffect(() => {
    if (capture?.state === "recording" && startedAt === null) setStartedAt(Date.now());
  }, [capture?.state, startedAt]);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const live = capture?.state === "recording" || capture?.state === "paused";
  const title =
    phase === "picking"
      ? "Choose what to share"
      : capture?.state === "recording"
        ? "Recording"
        : capture?.state === "paused"
          ? "Paused"
          : capture?.state === "uploading"
            ? "Saving…"
            : capture?.state === "complete"
              ? "Saved"
              : capture?.state === "error"
                ? "Recording problem"
                : "Starting…";
  const note =
    phase === "picking"
      ? "Pick Entire Screen in Chrome's dialog. Tick system audio if you want it recorded."
      : capture?.state === "complete"
        ? "The interview is saved. You can close this window."
        : capture?.state === "error"
          ? (capture.message ?? "Something went wrong.")
          : "Keep this window open until the interview is saved. You can move it out of the way.";

  return (
    <div className="sidepanel">
      <header className="header">
        <Emblem className="logo" />
        <div className="brand">
          <div className="title">Lare</div>
          <div className="subtitle">Mock interview recorder</div>
        </div>
      </header>
      <section className="card">
        <h1 className="card-title">
          <span>
            {live ? <span className="rec-dot" aria-hidden /> : null}
            {title}
          </span>
          {live && startedAt !== null ? (
            <span className="timer-sm">{formatElapsed(Date.now() - startedAt)}</span>
          ) : null}
        </h1>
        <p className={capture?.state === "error" ? "error" : "note"}>{note}</p>
        {capture?.recordedBytes ? (
          <p className="muted">
            {((capture.uploadedBytes ?? 0) / 1048576).toFixed(1)} /{" "}
            {(capture.recordedBytes / 1048576).toFixed(1)} MB uploaded
          </p>
        ) : null}
        {live ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void chrome.runtime.sendMessage({ type: "END_SESSION" })}
          >
            End &amp; save
          </button>
        ) : null}
        {capture?.state === "complete" || (phase === "idle" && !capture) ? (
          <button type="button" className="btn" onClick={() => window.close()}>
            Close
          </button>
        ) : null}
      </section>
    </div>
  );
}

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Recorder />
    </StrictMode>,
  );
}
