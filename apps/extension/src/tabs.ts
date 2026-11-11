/** Things the worker does to a LeetCode tab: load the content scripts, show the consent dot. */
import { sendToTab } from "./messages";
import { isLeetcodeUrl } from "./origins";

/**
 * Run the manifest's content scripts in a tab that does not have them yet. The MAIN-world script
 * guards against running twice; a stale isolated script from a previous build is already dead.
 */
export async function injectPage(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!isLeetcodeUrl(tab?.url)) return;
  for (const script of chrome.runtime.getManifest().content_scripts ?? []) {
    if (!script.js?.length) continue;
    await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: script.all_frames ?? false },
        files: script.js,
        world: (script as { world?: "MAIN" | "ISOLATED" }).world ?? "ISOLATED",
      })
      .catch((e) => console.warn("[lare] inject content script", e));
  }
}

/**
 * Ask the page to show the consent dot. After a real reload the content script injects at
 * document_idle, which can land just after Chrome reports the tab complete, so retry briefly.
 */
export async function showIndicator(tabId: number): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const reply = await sendToTab(tabId, { type: "LARE_RECORDING_INDICATOR", visible: true });
    if (reply?.ok === true) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function hideIndicator(tabId: number): Promise<void> {
  await sendToTab(tabId, { type: "LARE_RECORDING_INDICATOR", visible: false });
}
