import "@fontsource-variable/outfit";
import { Emblem } from "@lare/ui/brand";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  describeMediaError,
  MEDIA_PERMISSION_RESULT,
  type MediaPermissionResult,
} from "@/src/mediaPermission";

const camera = new URLSearchParams(location.search).get("camera") === "1";

function report(result: Omit<MediaPermissionResult, "type">) {
  void chrome.runtime
    .sendMessage({ type: MEDIA_PERMISSION_RESULT, ...result })
    .catch(() => undefined);
}

function Permissions() {
  const [status, setStatus] = useState<"asking" | "granted" | "failed">("asking");
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(async () => {
    setStatus("asking");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: camera });
      for (const track of stream.getTracks()) track.stop();
      setStatus("granted");
      report({ granted: true, error: null });
      setTimeout(() => window.close(), 600);
    } catch (e) {
      const text = describeMediaError(e, camera);
      setStatus("failed");
      setError(text);
      report({ granted: false, error: text });
    }
  }, []);

  useEffect(() => {
    void ask();
  }, [ask]);

  return (
    <div className="sidepanel">
      <header className="header">
        <Emblem className="logo" />
        <div>
          <div className="title">Lare</div>
          <div className="subtitle">Mock interview access</div>
        </div>
      </header>
      <section className="card">
        {status === "asking" && (
          <p>
            Allow the {camera ? "microphone and camera" : "microphone"} in the prompt at the top of
            this tab. Chrome can't show it inside the side panel.
          </p>
        )}
        {status === "granted" && <p role="status">Allowed. Back to your problem…</p>}
        {status === "failed" && (
          <>
            <div className="error">{error}</div>
            <button type="button" className="btn btn-primary" onClick={() => void ask()}>
              Try again
            </button>
          </>
        )}
      </section>
    </div>
  );
}

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Permissions />
    </StrictMode>,
  );
}
