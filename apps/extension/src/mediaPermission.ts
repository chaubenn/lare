/**
 * Microphone/camera access for interview capture.
 *
 * Chrome cannot show a permission prompt inside a side panel (or the hidden
 * offscreen document): the request fails straight away as if the user had said
 * no. The grant belongs to the extension's origin, though, so asking once from a
 * regular extension tab unlocks every extension page afterwards.
 */

export const MEDIA_PERMISSION_RESULT = "LARE_MEDIA_PERMISSION_RESULT";

export interface MediaPermissionResult {
  type: typeof MEDIA_PERMISSION_RESULT;
  granted: boolean;
  error: string | null;
}

async function granted(name: "microphone" | "camera"): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

export async function hasMediaPermission(camera: boolean): Promise<boolean> {
  return (await granted("microphone")) && (!camera || (await granted("camera")));
}

/** Open the permission tab and wait for it to report back (or be closed). */
export async function requestMediaPermission(camera: boolean): Promise<MediaPermissionResult> {
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`permissions.html?camera=${camera ? 1 : 0}`),
  });
  return new Promise((resolve) => {
    const finish = (result: MediaPermissionResult) => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(result);
    };
    const onMessage = (raw: unknown) => {
      const msg = raw as Partial<MediaPermissionResult> | null;
      if (msg?.type === MEDIA_PERMISSION_RESULT)
        finish({ type: MEDIA_PERMISSION_RESULT, granted: !!msg.granted, error: msg.error ?? null });
    };
    const onRemoved = (id: number) => {
      if (id !== tab.id) return;
      void hasMediaPermission(camera).then((ok) =>
        finish({
          type: MEDIA_PERMISSION_RESULT,
          granted: ok,
          error: ok ? null : "The permission tab was closed before access was allowed.",
        }),
      );
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

/** Human explanation for a getUserMedia failure, including the macOS system-level block. */
export function describeMediaError(error: unknown, camera: boolean): string {
  const what = camera ? "microphone and camera" : "microphone";
  const message = error instanceof Error ? error.message : String(error);
  if (/system/i.test(message))
    return `Your operating system is blocking Chrome from using the ${what}. On macOS open System Settings → Privacy & Security → Microphone${camera ? " (and Camera)" : ""}, switch on Google Chrome, then quit and reopen Chrome.`;
  if (error instanceof DOMException && error.name === "NotFoundError")
    return `No ${what} was found. Plug one in and try again.`;
  if (error instanceof DOMException && error.name === "NotReadableError")
    return `The ${what} is in use by another app. Close it and try again.`;
  return `Chrome did not allow the ${what}: ${message}. Click the camera icon in the address bar to change it.`;
}
