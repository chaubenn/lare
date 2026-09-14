import "@fontsource-variable/outfit";
import { type CaptureSession, startCapture } from "@lare/capture";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendRuntime } from "@/src/messages";

async function cloud(command: string, body: object) {
  const res = await chrome.runtime.sendMessage({ target: "background-recorder", command, body });
  if (!res?.ok) throw new Error(res?.error ?? "Cloud request failed");
  return res.data;
}
function Recorder() {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Practice summary");
  const [mic, setMic] = useState(true);
  const [uploaded, setUploaded] = useState(0);
  const [recorded, setRecorded] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const capture = useRef<CaptureSession | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const preview = useRef<HTMLVideoElement | null>(null);
  const stopping = useRef(false);
  const release = () => {
    for (const stream of streams.current) for (const track of stream.getTracks()) track.stop();
    streams.current = [];
    void audio.current?.close();
    audio.current = null;
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (capture.current || streams.current.length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const finish = async (retry = false) => {
    if (!capture.current || stopping.current) return;
    stopping.current = true;
    setStatus("uploading");
    setError(null);
    const result = retry ? capture.current.retry() : capture.current.stop();
    release();
    try {
      const done = await result;
      setVideoId(done.videoId);
      capture.current = null;
      setStatus("complete");
    } catch (e) {
      setStatus("error");
      setError(String(e));
    } finally {
      stopping.current = false;
    }
  };
  const start = async () => {
    setStatus("starting");
    setError(null);
    stopping.current = false;
    try {
      // This call must stay directly in the click handler for the screen-picker gesture.
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      streams.current.push(screen);
      const auth = await sendRuntime({ type: "GET_STATE" });
      if (!auth.ok || !auth.auth) throw new Error("Sign in using the Lare side panel first");
      const microphone = mic ? await navigator.mediaDevices.getUserMedia({ audio: true }) : null;
      if (microphone) streams.current.push(microphone);
      audio.current = new AudioContext();
      await audio.current.resume();
      const mix = audio.current.createMediaStreamDestination();
      for (const stream of streams.current)
        if (stream.getAudioTracks().length)
          audio.current
            .createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
            .connect(mix);
      const output = new MediaStream([...screen.getVideoTracks(), ...mix.stream.getAudioTracks()]);
      streams.current.push(output);
      if (preview.current) {
        preview.current.srcObject = output;
        await preview.current.play();
      }
      capture.current = await startCapture({
        stream: output,
        createUpload: ({ mimeType }) =>
          cloud("create", { mode: "instant", title, captureSource: "extension", mimeType }),
        finalizeUpload: (body) => cloud("finalize", body),
        onProgress: (p) => {
          setUploaded(p.uploadedBytes);
          setRecorded(p.recordedBytes);
        },
        onError: (e) => setError(`Upload needs attention: ${e.message}. Keep this page open.`),
      });
      screen.getVideoTracks()[0]?.addEventListener("ended", () => void finish());
      setStatus("recording");
    } catch (e) {
      release();
      setStatus("idle");
      setError(String(e));
    }
  };
  const publish = async () => {
    if (!videoId) return;
    setError(null);
    const result = await sendRuntime({
      type: "CREATE_VIDEO_DRAFT",
      videoId,
      title: title.trim() || "Practice summary",
    });
    if (!result.ok) setError(result.error);
    else if (result.postId)
      location.href = `${import.meta.env.WXT_SITE_URL ?? "https://lare-one.vercel.app"}/drafts/${result.postId}`;
  };
  return (
    <main className="sidepanel" style={{ maxWidth: 900, margin: "0 auto", padding: 32 }}>
      <h1>Browser recorder</h1>
      <p>
        Record a summary or demo. No desktop app required. This is video only, without local Whisper
        or AI review.
      </p>
      <p role="status">
        {status === "recording"
          ? "Recording - Chrome is sharing the selected screen or tab"
          : status}
      </p>
      <video
        ref={preview}
        muted
        playsInline
        style={{ width: "100%", maxHeight: "60vh", background: "black" }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label className="row">
        Title <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {status === "idle" && (
        <>
          <label>
            <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />{" "}
            Include microphone
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void start()}>
            Choose screen and record
          </button>
        </>
      )}
      {status === "recording" && (
        <button type="button" className="btn btn-danger" onClick={() => void finish()}>
          Stop and save
        </button>
      )}
      {recorded > 0 && (
        <p>
          {(uploaded / 1048576).toFixed(1)} / {(recorded / 1048576).toFixed(1)} MB uploaded. Keep
          this page open until upload completes.
        </p>
      )}
      {status === "error" && (
        <>
          <button type="button" className="btn" onClick={() => void finish(true)}>
            Retry upload
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              if (window.confirm("Permanently discard the retained recording?"))
                void capture.current?.discard().then(() => {
                  capture.current = null;
                  setStatus("idle");
                  setError(null);
                });
            }}
          >
            Discard recording
          </button>
        </>
      )}
      {status === "complete" && (
        <>
          <p>Upload acknowledged. Playback may still be encoding.</p>
          <button type="button" className="btn btn-primary" onClick={() => void publish()}>
            Review and publish draft
          </button>
        </>
      )}
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Recorder />);
