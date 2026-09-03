import { openUrl } from "@tauri-apps/plugin-opener";
import { inTauri } from "./tauri";

/** Open a URL in the system browser (falls back to window.open outside Tauri). */
export async function openExternal(url: string): Promise<void> {
  if (inTauri) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
