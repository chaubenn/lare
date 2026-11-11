/**
 * What the side panel and the content scripts are shown: the snapshot of the worker's state, the
 * broadcast that pushes it out, and the toolbar badge.
 */
import { activeMs, type RecordingState, timerStatus } from "@lare/shared";
import { brand } from "@lare/ui/tokens";
import { getAuthInfo } from "./auth";
import { desktop } from "./desktopLink";
import {
  forTab,
  type RecordingInfo,
  type RuntimeSnapshot,
  type StateBroadcast,
  sendToExtensionPages,
  sendToTab,
} from "./messages";
import { PAGE_TABS } from "./origins";
import { loadState } from "./storage";

/** The desktop recorder's state for the live interview. Lost with the worker, like the socket. */
let recording: RecordingInfo | null = null;

export async function setRecording(state: RecordingState, message?: string | null): Promise<void> {
  recording = state === "idle" ? null : { state, message: message ?? null };
  await broadcast();
}

export async function snapshot(): Promise<RuntimeSnapshot> {
  const [state, auth] = await Promise.all([
    loadState(),
    // A failure to read the session is shown as signed out rather than failing every response.
    getAuthInfo().catch((e: unknown) => {
      console.warn("[lare] could not read the signed-in user", e);
      return null;
    }),
  ]);
  const userId = auth?.userId ?? null;
  const appConnected = desktop.recordingAvailable(userId);
  return {
    state: { ...state, appConnected },
    auth,
    appConnected,
    desktopBlocker: desktop.blocker(userId),
    buildId: __BUILD_ID__,
    recording,
  };
}

export async function broadcast(toast?: StateBroadcast["toast"]): Promise<void> {
  const snap = await snapshot();
  const msg: StateBroadcast = { type: "STATE_CHANGED", ...snap, toast };
  const tabs = await chrome.tabs.query(PAGE_TABS);
  await Promise.all(tabs.map((t) => (t.id ? sendToTab(t.id, forTab(msg, t.id)) : undefined)));
  sendToExtensionPages(msg);
}

export async function refreshBadge(): Promise<void> {
  const state = await loadState();
  const interview = state.interview;

  // A live interview owns the badge: red, counting up.
  if (interview) {
    const status = timerStatus(interview.events);
    const minutes = Math.floor(activeMs(interview.events, Date.now()) / 60_000);
    await chrome.action.setBadgeBackgroundColor({
      color: status === "paused" ? brand.statusPause : brand.statusStop,
    });
    await chrome.action.setBadgeText({ text: status === "paused" ? "II" : `${minutes}m` });
    return;
  }

  // Otherwise the badge counts the problems tracked and not yet posted: the "it is watching"
  // signal, and a nudge that there is something to post.
  const count = state.tracking.problems.length;
  if (count === 0) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: brand.statusRun });
  await chrome.action.setBadgeText({ text: String(count) });
}
