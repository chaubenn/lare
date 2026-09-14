import { type CaptureSession, startCapture } from "@lare/capture";
import type { CaptureState } from "@/src/capture";
import { PcmStream } from "@/src/pcm";

let capture: CaptureSession | null = null;
let state: CaptureState | null = null;
let streams: MediaStream[] = [];
let audio: AudioContext | null = null;
let pcm: PcmStream | null = null;
let tap: AudioWorkletNode | null = null;
let drawTimer: ReturnType<typeof setInterval> | undefined;
let stopping: Promise<unknown> | null = null;
let paused = false;
let gradingResult = false;
let flushed: (() => void) | null = null;

async function report(patch: Partial<CaptureState>) {
  if (!state) return;
  state = { ...state, ...patch };
  await chrome.runtime.sendMessage({ target: "background-capture", command: "state", state });
}
async function cloud(command: string, body: object) {
  const response = await chrome.runtime.sendMessage({
    target: "background-capture",
    command,
    body,
  });
  if (!response?.ok) throw new Error(response?.error ?? "Cloud request failed");
  return response.data;
}
function release() {
  clearInterval(drawTimer);
  for (const stream of streams) for (const track of stream.getTracks()) track.stop();
  streams = [];
  tap?.disconnect();
  tap = null;
  void audio?.close();
  audio = null;
}
async function start(req: {
  sessionId: string;
  tabId: number;
  streamId: string;
  userId: string;
  graded: boolean;
  facecam: boolean;
}) {
  if (capture || streams.length) throw new Error("A capture is already active");
  stopping = null;
  paused = false;
  gradingResult = false;
  state = { sessionId: req.sessionId, tabId: req.tabId, graded: req.graded, state: "starting" };
  try {
    const tab = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: req.streamId } },
      video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: req.streamId } },
    } as unknown as MediaStreamConstraints);
    streams.push(tab);
    const devices = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, channelCount: 1 },
      video: req.facecam,
    });
    streams.push(devices);
    audio = new AudioContext({ sampleRate: 16000 });
    await audio.resume();
    const mix = audio.createMediaStreamDestination();
    const mic = audio.createMediaStreamSource(new MediaStream(devices.getAudioTracks()));
    mic.connect(mix);
    if (tab.getAudioTracks().length) {
      const sound = audio.createMediaStreamSource(new MediaStream(tab.getAudioTracks()));
      sound.connect(mix);
      // tabCapture suppresses normal playback; restore it without echoing the mic.
      sound.connect(audio.destination);
    }
    if (req.graded) {
      pcm = new PcmStream(req.sessionId, req.userId, (message, failed, transcript) => {
        void report({
          message,
          ...(failed ? { graded: false } : {}),
          ...(transcript ? { transcript } : {}),
        });
      });
      await pcm.start();
      await audio.audioWorklet.addModule(chrome.runtime.getURL("pcm-worklet.js"));
      tap = new AudioWorkletNode(audio, "microphone-pcm");
      tap.port.onmessage = (event) => {
        if (event.data?.flushed) {
          flushed?.();
          flushed = null;
        } else pcm?.push(event.data as Float32Array);
      };
      mic.connect(tap);
      const silence = audio.createGain();
      silence.gain.value = 0;
      tap.connect(silence).connect(audio.destination);
    }
    let video = tab.getVideoTracks();
    if (req.facecam) {
      const screen = document.createElement("video");
      screen.srcObject = tab;
      screen.muted = true;
      const camera = document.createElement("video");
      camera.srcObject = devices;
      camera.muted = true;
      await Promise.all([screen.play(), camera.play()]);
      const canvas = document.createElement("canvas");
      canvas.width = screen.videoWidth || 1280;
      canvas.height = screen.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Camera composition unavailable");
      drawTimer = setInterval(() => {
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (paused) return;
        ctx.drawImage(screen, 0, 0, canvas.width, canvas.height);
        const width = canvas.width / 5;
        ctx.drawImage(
          camera,
          canvas.width - width - 20,
          canvas.height - width * 0.75 - 20,
          width,
          width * 0.75,
        );
      }, 1000 / 30);
      const composed = canvas.captureStream(30);
      streams.push(composed);
      video = composed.getVideoTracks();
    }
    const output = new MediaStream([...video, ...mix.stream.getAudioTracks()]);
    streams.push(output);
    capture = await startCapture({
      stream: output,
      createUpload: ({ mimeType }) =>
        cloud("create", {
          mode: "instant",
          sessionId: req.sessionId,
          captureSource: "extension",
          mimeType,
        }),
      finalizeUpload: (body) => cloud("finalize", body),
      onProgress: (progress) => void report(progress),
      onError: (error) => void report({ message: `Upload needs retry: ${error.message}` }),
    });
    tap?.port.postMessage({ paused: false });
    for (const track of [...tab.getVideoTracks(), ...devices.getAudioTracks()])
      track.onended = () => {
        if (!stopping) void chrome.runtime.sendMessage({ type: "END_SESSION" });
      };
    await report({ state: "recording", videoId: capture.videoId });
  } catch (error) {
    release();
    pcm?.close();
    pcm = null;
    await report({
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
async function stop(retry: boolean) {
  if (!capture) throw new Error("Capture is not available; the browser may have restarted");
  await report({ state: "uploading" });
  if (tap && pcm)
    await new Promise<void>((resolve) => {
      flushed = resolve;
      tap?.port.postMessage({ paused: true, flush: true });
      setTimeout(resolve, 500);
    });
  const localPcm = pcm;
  pcm = null;
  const upload = retry ? capture.retry() : capture.stop();
  release();
  const grading = localPcm
    ? (async () => {
        try {
          // Review must see the final code timeline, not just the rolling transcript.
          await cloud("prepare-review", {});
          gradingResult = await localPcm.stop();
          return gradingResult;
        } catch (error) {
          localPcm.close();
          await report({
            graded: false,
            message: `Could not prepare AI review. Saved as ungraded: ${String(error)}`,
          });
          return false;
        }
      })()
    : Promise.resolve(gradingResult);
  try {
    const [result, graded] = await Promise.all([upload, grading]);
    await report({
      state: "complete",
      graded: state?.graded === true && graded,
      videoId: result.videoId,
    });
    capture = null;
    return result;
  } catch (error) {
    await report({
      state: "error",
      graded: false,
      message: `Recording retained for retry: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}
chrome.runtime.onMessage.addListener((req, sender, respond) => {
  if (sender.id !== chrome.runtime.id || req?.target !== "offscreen") return false;
  const run = async () => {
    if (req.command === "start") await start(req);
    else if (req.command === "discard") {
      pcm?.close();
      pcm = null;
      release();
      await capture?.discard();
      capture = null;
      await report({
        state: "complete",
        videoId: undefined,
        graded: false,
        message: "Recording discarded by you. Session data is retained.",
      });
    } else if (req.command === "status") return { ok: true, state };
    else if (req.command === "stop" || req.command === "retry") {
      stopping ??= stop(req.command === "retry").finally(() => {
        stopping = null;
      });
      await stopping;
    } else if (req.command === "pause" || req.command === "resume") {
      paused = req.command === "pause";
      if (!capture) throw new Error("No active recording");
      if (paused) capture.pause();
      else capture.resume();
      for (const stream of streams) for (const track of stream.getTracks()) track.enabled = !paused;
      tap?.port.postMessage({ paused });
      pcm?.pause(paused);
      await report({ state: paused ? "paused" : "recording" });
    } else throw new Error("Unknown capture command");
    return { ok: true, state };
  };
  void run()
    .then(respond)
    .catch((error) =>
      respond({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  return true;
});
