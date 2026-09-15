/**
 * The interview recorder. Runs in the small "Lare · Recording" window (entrypoints/capture), not
 * an offscreen document: Chrome binds a screen-share id to the page that opened the share dialog,
 * so the page that picks the screen has to be the page that records it.
 *
 * Background drives it with runtime messages targeted at "capture-host":
 *   pick → start → pause/resume → stop | retry | discard, plus status.
 */
import { type CaptureSession, startCapture } from "@lare/capture";
import type { CaptureState } from "./capture";
import { PcmStream } from "./pcm";

export const CAPTURE_HOST = "capture-host";

// Insertable streams: frame-driven, so compositing keeps pace even if Chrome throttles the window.
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack });
  readonly readable: ReadableStream<VideoFrame>;
}
declare class MediaStreamTrackGenerator extends MediaStreamTrack {
  constructor(init: { kind: "video" });
  readonly writable: WritableStream<VideoFrame>;
}

type Listener = (state: CaptureState | null, phase: HostPhase) => void;
export type HostPhase = "idle" | "picking" | "picked" | "active";

let capture: CaptureSession | null = null;
let state: CaptureState | null = null;
let phase: HostPhase = "idle";
let picked: MediaStream | null = null;
let streams: MediaStream[] = [];
let audio: AudioContext | null = null;
let pcm: PcmStream | null = null;
let tap: AudioWorkletNode | null = null;
let stopping: Promise<unknown> | null = null;
let gradingResult = false;
let flushed: (() => void) | null = null;
const listeners = new Set<Listener>();

export function onHostChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(state, phase);
  return () => listeners.delete(listener);
}
function notify() {
  for (const l of listeners) l(state, phase);
}
function setPhase(next: HostPhase) {
  phase = next;
  notify();
}

async function report(patch: Partial<CaptureState>) {
  if (!state) return;
  state = { ...state, ...patch };
  notify();
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
  for (const stream of streams) for (const track of stream.getTracks()) track.stop();
  streams = [];
  tap?.disconnect();
  tap = null;
  void audio?.close();
  audio = null;
}

/** Chrome's share dialog, then the stream straight away: the id is single-use and short-lived. */
async function pick(): Promise<{ systemAudio: boolean }> {
  if (capture) throw new Error("A capture is already active");
  for (const track of picked?.getTracks() ?? []) track.stop();
  picked = null;
  setPhase("picking");
  try {
    // e2e builds only: headless Chromium has no screen to share, so the harness picks for it.
    const e2e = import.meta.env.MODE === "e2e" ? localStorage.getItem("lare:e2e-share") : null;
    if (e2e === "screen") {
      picked = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setPhase("picked");
      return { systemAudio: false };
    }
    const choice =
      e2e === "cancel"
        ? { streamId: "", systemAudio: false }
        : await new Promise<{ streamId: string; systemAudio: boolean }>((resolve) =>
            chrome.desktopCapture.chooseDesktopMedia(["screen", "audio"], (streamId, options) =>
              resolve({ streamId, systemAudio: !!options?.canRequestAudioTrack }),
            ),
          );
    if (!choice.streamId)
      throw new Error("Screen sharing was cancelled. Press Start to try again.");
    const desktop = { chromeMediaSource: "desktop", chromeMediaSourceId: choice.streamId };
    picked = await navigator.mediaDevices.getUserMedia({
      audio: choice.systemAudio ? { mandatory: desktop } : false,
      // The whole display at its real resolution: code in the video has to stay readable.
      video: { mandatory: { ...desktop, maxWidth: 2560, maxHeight: 1440, maxFrameRate: 30 } },
    } as unknown as MediaStreamConstraints);
    setPhase("picked");
    return { systemAudio: choice.systemAudio };
  } catch (error) {
    setPhase("idle");
    throw error;
  }
}

/** Screen with the webcam in the bottom-right corner, one output frame per camera frame. */
function composite(screenTrack: MediaStreamTrack, cameraTrack: MediaStreamTrack): MediaStreamTrack {
  const { width = 1920, height = 1080 } = screenTrack.getSettings();
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Camera composition unavailable");
  const generator = new MediaStreamTrackGenerator({ kind: "video" });
  const writer = generator.writable.getWriter();
  let screenFrame: VideoFrame | null = null;

  void (async () => {
    const reader = new MediaStreamTrackProcessor({ track: screenTrack }).readable.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      screenFrame?.close();
      screenFrame = value;
    }
    screenFrame?.close();
    screenFrame = null;
  })().catch(() => undefined);

  void (async () => {
    const reader = new MediaStreamTrackProcessor({ track: cameraTrack }).readable.getReader();
    for (;;) {
      const { value: camera, done } = await reader.read();
      if (done) break;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, width, height);
      if (screenFrame) ctx.drawImage(screenFrame, 0, 0, width, height);
      const w = width / 5;
      const h = (w * camera.displayHeight) / camera.displayWidth;
      ctx.drawImage(camera, width - w - 24, height - h - 24, w, h);
      const frame = new VideoFrame(canvas, { timestamp: camera.timestamp });
      camera.close();
      await writer.write(frame);
    }
    await writer.close().catch(() => undefined);
  })().catch(() => undefined);

  return generator;
}

async function start(req: {
  sessionId: string;
  tabId: number;
  userId: string;
  graded: boolean;
  facecam: boolean;
}) {
  if (capture || streams.length) throw new Error("A capture is already active");
  const screen = picked;
  picked = null;
  if (!screen) throw new Error("Pick a screen to record first");
  stopping = null;
  gradingResult = false;
  state = { sessionId: req.sessionId, tabId: req.tabId, graded: req.graded, state: "starting" };
  setPhase("active");
  try {
    streams.push(screen);
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
    if (screen.getAudioTracks().length) {
      // System audio still plays normally, so it is only mixed in, never sent to the speakers.
      audio.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(mix);
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
    const [screenTrack] = screen.getVideoTracks();
    const [cameraTrack] = devices.getVideoTracks();
    if (!screenTrack) throw new Error("The shared screen has no video");
    const video = req.facecam && cameraTrack ? composite(screenTrack, cameraTrack) : screenTrack;
    const output = new MediaStream([video, ...mix.stream.getAudioTracks()]);
    streams.push(output);
    capture = await startCapture({
      stream: output,
      // Screen text blurs at MediaRecorder's default ~2.5 Mbps.
      videoBitsPerSecond: 8_000_000,
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
    // Chrome's own "Stop sharing" bar ends the interview like End & save.
    for (const track of [screenTrack, ...devices.getAudioTracks()])
      track.addEventListener("ended", () => {
        if (!stopping) void chrome.runtime.sendMessage({ type: "END_SESSION" });
      });
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
  if (!capture) throw new Error("Capture is not available; the recording window may have closed");
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

/** Whether closing the window now would lose recording or unfinished upload. */
export function hostBusy(): boolean {
  return capture !== null;
}

export function installCaptureHost(): void {
  chrome.runtime.onMessage.addListener((req, sender, respond) => {
    if (sender.id !== chrome.runtime.id || req?.target !== CAPTURE_HOST) return false;
    const run = async () => {
      if (req.command === "pick") return { ok: true, ...(await pick()) };
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
      } else if (req.command === "status") return { ok: true, state, phase };
      else if (req.command === "stop" || req.command === "retry") {
        stopping ??= stop(req.command === "retry").finally(() => {
          stopping = null;
        });
        await stopping;
      } else if (req.command === "pause" || req.command === "resume") {
        const paused = req.command === "pause";
        if (!capture) throw new Error("No active recording");
        if (paused) capture.pause();
        else capture.resume();
        for (const stream of streams)
          for (const track of stream.getTracks()) track.enabled = !paused;
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
}
