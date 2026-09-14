export interface CaptureState {
  sessionId: string;
  tabId: number;
  graded: boolean;
  state: "starting" | "recording" | "paused" | "uploading" | "complete" | "error";
  videoId?: string;
  message?: string;
  transcript?: string;
  uploadedBytes?: number;
  recordedBytes?: number;
}
export const CAPTURE_KEY = "lare:capture";
export async function getCapture(): Promise<CaptureState | null> {
  return (
    ((await chrome.storage.local.get(CAPTURE_KEY))[CAPTURE_KEY] as CaptureState | undefined) ?? null
  );
}
let creating: Promise<void> | null = null;
export async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.DISPLAY_MEDIA],
      justification:
        "Record the explicitly selected interview tab, microphone and optional camera, and stream microphone PCM to local Whisper.",
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}
export async function captureCommand(command: string, payload: object = {}) {
  const result = await chrome.runtime.sendMessage({ target: "offscreen", command, ...payload });
  if (!result?.ok) throw new Error(result?.error ?? "Capture document unavailable");
  return result;
}
