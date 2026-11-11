import { DEEP_LINK_SCHEME, timerStatus } from "@lare/shared";
import "@/src/zodConfig";
import { signInWithOtp, signInWithProvider, signOut, verifyOtp } from "@/src/auth";
import { deliverOutbox, desktop, forgetPairingSecrets, probeDesktop } from "@/src/desktopLink";
import { onDesktopMessage, reconnectIfLive, scheduleReconnect } from "@/src/desktopSync";
import {
  cancelStart,
  clearSyncRetry,
  discardFromPanel,
  discardUnsaved,
  endSession,
  parkStaleEndedInterview,
  pauseOrResume,
  RETRY_SYNC_ALARM,
  retryUnsaved,
  startInterview,
  startTick,
  TICK_ALARM,
} from "@/src/interview";
import {
  forTab,
  isPageRequest,
  type RuntimeRequest,
  RuntimeRequestSchema,
  type RuntimeResponse,
} from "@/src/messages";
import { LEETCODE_TABS } from "@/src/origins";
import { edits, problemOpened, submission } from "@/src/pageEvents";
import {
  clearTracked,
  flushSubmissionQueue,
  publishTracked,
  reconcileTracked,
} from "@/src/practice";
import { broadcast, refreshBadge, snapshot } from "@/src/snapshot";
import { clearState, loadState } from "@/src/storage";
import { currentUserId } from "@/src/supabase";
import { injectPage, showIndicator } from "@/src/tabs";
import { errorText } from "@/src/util";

/** Periodically drops tracked problems that were posted or cleared from another client. */
const RECONCILE_ALARM = "lare-reconcile";

export default defineBackground(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.tabs.onUpdated.addListener((id, change) => {
    // Chrome reports "loading" for far more than a reload: subframes loading, in-page URL changes,
    // LeetCode's own Run. Ending on it stopped interviews mid-problem. Wait for the load to finish
    // and put the consent dot back; stop only when it cannot be shown, i.e. the page really left.
    if (change.status === "complete")
      void loadState()
        .then(async (s) => {
          if (s.interview?.tabId !== id || timerStatus(s.interview.events) === "ended") return;
          if (!(await showIndicator(id))) return endSession();
        })
        .catch(console.warn);
  });
  chrome.tabs.onRemoved.addListener((id) => {
    void loadState()
      .then((s) => {
        if (s.interview?.tabId === id && timerStatus(s.interview.events) !== "ended")
          return endSession();
      })
      .catch(console.warn);
  });
  chrome.runtime.onInstalled.addListener(() => {
    void refreshBadge();
    // Tabs that were already open never got the content scripts; without them Lare cannot see the
    // problem until the user refreshes.
    void chrome.tabs
      .query(LEETCODE_TABS)
      .then((tabs) => Promise.all(tabs.map((t) => (t.id ? injectPage(t.id) : undefined))))
      .catch(console.warn);
  });
  chrome.runtime.onStartup.addListener(() => {
    void resumeAfterRestart();
  });
  void resumeAfterRestart();

  chrome.runtime.onConnect.addListener((_port) => {
    // Content scripts keep a `lare-keepalive` port open so the MV3 worker is not
    // killed mid-submit. Other ports (WXT HMR) must be left alone.
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TICK_ALARM) {
      void refreshBadge();
      // Backstop for the reconnect timer, which does not survive the worker going to sleep.
      void reconnectIfLive().catch(console.warn);
    }
    if (alarm.name === RECONCILE_ALARM) {
      void reconcileTracked().catch(console.warn);
      void flushSubmissionQueue();
      void deliverOutbox().catch(console.warn);
    }
    if (alarm.name === RETRY_SYNC_ALARM) void retryUnsaved();
  });
  // Back online: whatever failed for want of a network is worth trying straight away.
  self.addEventListener("online", () => {
    void retryUnsaved();
    void flushSubmissionQueue();
  });
  // `create` resets the period, and the worker restarts far more often than every few minutes.
  void chrome.alarms.get(RECONCILE_ALARM).then((alarm) => {
    if (!alarm) return chrome.alarms.create(RECONCILE_ALARM, { periodInMinutes: 2 });
  });

  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    const parsed = RuntimeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      // Not for us (e.g. STATE_CHANGED broadcast echoing back).
      return false;
    }
    const req = parsed.data;
    // Trusted only when it comes from one of our own pages. Anything else is a content script
    // in a LeetCode tab, which speaks for that tab and nothing more.
    const fromPage = !(sender.url?.startsWith(chrome.runtime.getURL("")) ?? false);
    const pageTabId = fromPage ? sender.tab?.id : undefined;
    if (fromPage && (!isPageRequest(req) || pageTabId === undefined)) return false;
    handle(req, pageTabId)
      .then((res) => {
        sendResponse(res.ok && pageTabId !== undefined ? forTab(res, pageTabId) : res);
      })
      .catch((e: unknown) => {
        sendResponse({ ok: false, error: errorText(e) });
      });
    return true; // async response
  });

  desktop.onMessage((msg) => void onDesktopMessage(msg));
  desktop.onClose(() => {
    void broadcast();
    scheduleReconnect();
  });
});

/** `sourceTabId` is the tab a content script's request came from; absent for our own pages. */
async function handle(req: RuntimeRequest, sourceTabId?: number): Promise<RuntimeResponse> {
  switch (req.type) {
    case "PUBLISH_PROBLEMS":
      return publishTracked(req.ids);

    case "CLEAR_TRACKED":
      return clearTracked(req.ids);

    case "INJECT_PAGE":
      await injectPage(req.tabId);
      return { ok: true };

    case "GET_STATE":
      // The side panel opening is the moment a stale list would be noticed.
      if (sourceTabId === undefined) void reconcileTracked().catch(console.warn);
      return { ok: true, ...(await snapshot()) };

    case "SIGN_IN":
      await signInWithProvider(req.provider);
      await broadcast({ kind: "success", text: "Signed in to Lare" });
      void afterSignIn();
      return { ok: true, ...(await snapshot()) };

    case "SIGN_IN_OTP":
      await signInWithOtp(req.email);
      return { ok: true };

    case "VERIFY_OTP":
      await verifyOtp(req.email, req.token);
      await broadcast({ kind: "success", text: "Signed in to Lare" });
      void afterSignIn();
      return { ok: true, ...(await snapshot()) };

    case "SIGN_OUT": {
      const state = await loadState();
      // Only a live interview blocks this. Unsaved ones are dropped with the rest of the state;
      // the side panel asks before it sends this when there are any.
      if (state.interview) throw new Error("End the mock interview before signing out");
      await signOut();
      desktop.close();
      await forgetPairingSecrets();
      await clearSyncRetry();
      await clearState();
      await refreshBadge();
      await broadcast();
      return { ok: true, ...(await snapshot()) };
    }

    case "PROBE_APP": {
      const userId = await currentUserId();
      const connected = await probeDesktop(userId);
      await broadcast();
      return { ok: true, ...(await snapshot()), appConnected: connected };
    }

    case "OPEN_APP": {
      const url = `${DEEP_LINK_SCHEME}://${req.path ?? "open"}`;
      await chrome.tabs.create({ url, active: false }).catch(() => undefined);
      return { ok: true };
    }

    case "CANCEL_START":
      return cancelStart();

    case "RETRY_SYNC":
      return retryUnsaved();

    case "DISCARD_UNSAVED":
      return discardUnsaved(req.sessionIds);

    case "START_INTERVIEW":
      return startInterview(req);

    case "PAUSE_SESSION":
    case "RESUME_SESSION":
      return pauseOrResume(req.type === "PAUSE_SESSION" ? "pause" : "resume");

    case "END_SESSION":
      return endSession();

    case "DISCARD_SESSION":
      return discardFromPanel();

    case "PROBLEM_OPENED":
      return problemOpened(req.problem, req.question, sourceTabId);

    case "EDITS":
      return edits(req.slug, req.language, req.events, sourceTabId);

    case "SUBMISSION":
      return submission(
        req.slug,
        req.submission,
        req.problem ?? null,
        req.question ?? null,
        sourceTabId,
      );

    default: {
      // A request type added to the schema without a case here fails to compile.
      const unhandled: never = req;
      throw new Error(`Unhandled request ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Retry whatever waited on a signed-in user. */
async function afterSignIn(): Promise<void> {
  await retryUnsaved().catch(console.warn);
  await flushSubmissionQueue();
}

async function resumeAfterRestart(): Promise<void> {
  await parkStaleEndedInterview();
  const state = await loadState();
  if (state.interview) await startTick();
  const userId = await currentUserId();
  await probeDesktop(userId);
  await refreshBadge();
  await broadcast();
  // What waited for a network or a worker that was asleep.
  if (state.unsaved.length > 0) void retryUnsaved();
  void flushSubmissionQueue();
}
