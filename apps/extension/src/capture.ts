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

// ---------------------------------------------------------------------------
// The recorder window (entrypoints/capture). Chrome binds a screen-share id to the page that
// opened the share dialog, so recording lives in a small visible window rather than an
// offscreen document, which cannot show that dialog.
// ---------------------------------------------------------------------------
const WINDOW_KEY = "lare:capture-window";
const WIDTH = 380;
const HEIGHT = 300;

async function storedWindowId(): Promise<number | null> {
  const id = (await chrome.storage.session.get(WINDOW_KEY))[WINDOW_KEY];
  return typeof id === "number" ? id : null;
}

export async function captureWindowId(): Promise<number | null> {
  const id = await storedWindowId();
  if (id === null) return null;
  const alive = await chrome.windows.get(id).then(
    () => true,
    () => false,
  );
  if (!alive) await chrome.storage.session.remove(WINDOW_KEY);
  return alive ? id : null;
}

/** Whether the recorder window is open (it holds the only copy of the live media). */
export async function captureWindowAlive(): Promise<boolean> {
  return (await captureWindowId()) !== null;
}

let opening: Promise<void> | null = null;
export function ensureCaptureWindow(): Promise<void> {
  opening ??= (async () => {
    const existing = await captureWindowId();
    if (existing !== null) {
      await chrome.windows.update(existing, { focused: true });
      return;
    }
    // Top-right of the current window, out of the way of the problem.
    const current = await chrome.windows.getLastFocused().catch(() => null);
    const left =
      current?.left !== undefined && current.width !== undefined
        ? Math.max(0, current.left + current.width - WIDTH - 24)
        : undefined;
    const top = current?.top !== undefined ? current.top + 80 : undefined;
    const base = {
      url: chrome.runtime.getURL("capture.html"),
      type: "popup" as const,
      width: WIDTH,
      height: HEIGHT,
      focused: true,
    };
    // Chrome rejects bounds that are mostly off-screen (multi-monitor, odd window positions):
    // fall back to letting it place the window.
    const win = await chrome.windows
      .create({ ...base, left, top })
      .catch(() => chrome.windows.create(base));
    if (win?.id === undefined) throw new Error("Could not open the recording window");
    await chrome.storage.session.set({ [WINDOW_KEY]: win.id });
    // Wait until the page can take commands.
    for (let attempt = 0; attempt < 50; attempt++) {
      const ok = await chrome.runtime
        .sendMessage({ target: "capture-host", command: "status" })
        .then((res) => res?.ok === true)
        .catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("The recording window did not start");
  })().finally(() => {
    opening = null;
  });
  return opening;
}

export async function closeCaptureWindow(): Promise<void> {
  const id = await captureWindowId();
  await chrome.storage.session.remove(WINDOW_KEY);
  if (id !== null) await chrome.windows.remove(id).catch(() => undefined);
}

export async function captureCommand(command: string, payload: object = {}) {
  const result = await chrome.runtime.sendMessage({ target: "capture-host", command, ...payload });
  if (!result?.ok) throw new Error(result?.error ?? "Recording window unavailable");
  return result;
}
