import {
  type ActiveSession,
  type AppToExt,
  activeMs,
  type EditEvent,
  type InboxProblem,
  type ProblemInfo,
  type RecordingState,
  type TrackedProblem,
  timerStatus,
} from "@lare/shared";
import { brand } from "@lare/ui/tokens";
import "@/src/zodConfig";
import { getAuthInfo, signInWithOtp, signInWithProvider, signOut, verifyOtp } from "@/src/auth";
import { appendEvents, deleteSessionEvents } from "@/src/editsDb";
import {
  type CapturedSubmission,
  type QuestionDetails,
  type RecordingInfo,
  type RuntimeRequest,
  RuntimeRequestSchema,
  type RuntimeResponse,
  type RuntimeSnapshot,
  type StateBroadcast,
} from "@/src/messages";
import {
  clearDesktopFrame,
  enqueueSubmission,
  hasDesktopOutbox,
  loadSubmissionQueue,
  nextSyncRetryDelay,
  queueDesktopFrame,
  removeQueuedSubmission,
  resetSyncRetry,
  takeDesktopOutbox,
} from "@/src/queues";
import { loadState, withState } from "@/src/storage";
import { currentUserId, getSupabase } from "@/src/supabase";
import {
  deleteInboxProblems,
  finalizeSession,
  listInboxProblemIds,
  publishInboxProblems,
  resolveInboxSession,
  syncProblemClose,
  syncProblemOpen,
  syncSessionStart,
  syncSubmission,
  syncTimerEvent,
  trackInboxProblem,
} from "@/src/sync";
import { DesktopClient, type HelloAck } from "@/src/ws";

const TICK_ALARM = "lare-tick";
/** Periodically drops tracked problems that were posted or cleared from another client. */
const RECONCILE_ALARM = "lare-reconcile";
/** Next attempt at saving mock interviews that ended but could not be saved (with backoff). */
const RETRY_SYNC_ALARM = "lare-retry-sync";
/** Delays between reconnect attempts while a live interview has lost the desktop app. */
const RECONNECT_DELAYS_MS = [1000, 3000, 10_000, 30_000];
const desktop = new DesktopClient();
/**
 * In-flight `session_problems` upserts, keyed by slug. `submissions` has a
 * foreign key onto that row, so a submission captured moments after the problem
 * was first seen has to wait for the row to land.
 */
const pendingTrack = new Map<string, Promise<void>>();
let recording: RecordingInfo | null = null;
let startAbort: AbortController | null = null;

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
      .query({ url: "https://leetcode.com/*" })
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
    const fromPage = !!sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(""));
    if (
      fromPage &&
      !["GET_STATE", "PROBE_APP", "PROBLEM_OPENED", "EDITS", "SUBMISSION"].includes(req.type)
    )
      return false;
    handle(req, fromPage ? sender.tab?.id : undefined)
      .then((res) => {
        if (res.ok && fromPage && res.state?.interview?.tabId !== sender.tab?.id)
          sendResponse({ ...res, recording: null });
        else sendResponse(res);
      })
      .catch((e: unknown) => {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });
    return true; // async response
  });

  desktop.onMessage((msg) => void onDesktopMessage(msg));
  desktop.onClose(() => {
    void broadcast();
    scheduleReconnect();
  });
});

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------
async function handle(req: RuntimeRequest, sourceTabId?: number): Promise<RuntimeResponse> {
  switch (req.type) {
    case "PUBLISH_PROBLEMS": {
      const state = await loadState();
      if (
        !req.ids.every((id) =>
          state.tracking.problems.some((p) => p.sessionProblemId === id && p.synced),
        )
      )
        throw new Error("Select synced inbox problems");
      const postId = await publishInboxProblems(req.ids, null);
      await withState(async (s) => ({
        state: {
          ...s,
          tracking: {
            ...s.tracking,
            problems: s.tracking.problems.filter((p) => !req.ids.includes(p.sessionProblemId)),
          },
        },
        result: undefined,
      }));
      await refreshBadge();
      await broadcast();
      return { ok: true, postId, ...(await snapshot()) };
    }
    case "CLEAR_TRACKED": {
      const state = await loadState();
      const ids = new Set(req.ids ?? state.tracking.problems.map((p) => p.sessionProblemId));
      const synced = state.tracking.problems
        .filter((p) => p.synced && ids.has(p.sessionProblemId))
        .map((p) => p.sessionProblemId);
      if (synced.length > 0) {
        const inboxSessionId = state.tracking.inboxSessionId;
        if (!inboxSessionId) throw new Error("Practice inbox unavailable; try again");
        await deleteInboxProblems(inboxSessionId, synced);
      }
      await withState(async (s) => ({
        state: {
          ...s,
          tracking: {
            ...s.tracking,
            problems: s.tracking.problems.filter((p) => !ids.has(p.sessionProblemId)),
          },
        },
        result: undefined,
      }));
      await refreshBadge();
      await broadcast();
      return { ok: true, ...(await snapshot()) };
    }
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
      await chrome.alarms.clear(RETRY_SYNC_ALARM);
      await resetSyncRetry();
      await chrome.storage.local.remove("lare:state");
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
      const url = `lare://${req.path ?? "open"}`;
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
  }
}

// ---------------------------------------------------------------------------
// Mock interview lifecycle
//
// Practice has no lifecycle any more: see `trackProblem` and `submission`.
// ---------------------------------------------------------------------------
async function startInterview(
  req: Extract<RuntimeRequest, { type: "START_INTERVIEW" }>,
): Promise<RuntimeResponse> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Sign in to Lare first (click the extension icon)");
  const existing = await loadState();
  if (existing.interview || startAbort)
    throw new Error("A mock interview is already running or starting");
  if (!req.problem || req.tabId === null)
    throw new Error("Open a LeetCode problem to start a mock interview");
  startAbort = new AbortController();
  const signal = startAbort.signal;

  const sessionId = crypto.randomUUID();
  const problem = req.problem;
  const tabId = req.tabId;
  let session: ActiveSession | null = null;
  let desktopStarted = false;

  await setRecording("starting");
  try {
    // The desktop app records the screen, microphone and camera bubble; nothing starts without it.
    if (!(await probeDesktop(userId)))
      throw new Error(desktop.blocker(userId) ?? "The Lare desktop app cannot record right now");

    const now = Date.now();
    const tp: TrackedProblem = {
      sessionProblemId: crypto.randomUUID(),
      problem,
      openedAt: now,
      closedAt: null,
      editCount: 0,
      submissions: [],
      synced: false,
    };
    const started: ActiveSession = {
      sessionId,
      kind: "interview",
      scope: "problem",
      startedAt: now,
      events: [
        { t: now, type: "start" },
        { t: now, type: "problem_open", slug: problem.slug },
      ],
      problems: [tp],
      currentSlug: problem.slug,
      tabId,
      facecam: req.facecam,
      graded: req.graded,
      synced: false,
    };
    session = started;
    // The desktop pipeline writes to this row when the recording finishes, so it must exist first.
    // It also reads `graded` from it to decide whether to transcribe.
    await syncSessionStart(started, userId, started.graded);
    await syncProblemOpen(sessionId, tp, req.question);
    started.synced = true;
    tp.synced = true;
    await withState(async (s) => ({ state: { ...s, interview: started }, result: undefined }));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // Consent indicator must be acknowledged by the recorded page before any media starts.
    const indicator = await chrome.tabs.sendMessage(tabId, {
      type: "LARE_RECORDING_INDICATOR",
      visible: true,
    });
    if (!indicator?.ok) throw new Error("Cannot show the recording indicator on this tab");

    const answer = desktop.waitFor(
      (m): m is Extract<AppToExt, { type: "recording.state" }> =>
        m.type === "recording.state" &&
        m.sessionId === sessionId &&
        (m.state === "recording" || m.state === "error"),
      30_000,
      signal,
    );
    if (
      !desktop.send({
        type: "session.start",
        sessionId,
        kind: "interview",
        scope: "problem",
        startedAt: now,
        problem,
        facecam: req.facecam,
        mic: true,
      })
    )
      throw new Error("Lost the connection to the Lare desktop app");
    desktopStarted = true;
    const state = await answer;
    if (state.state === "error")
      throw new Error(state.message ?? "The desktop app could not start recording");
  } catch (e) {
    // Cancel, not end: a start that failed, timed out or was called off has no draft to attach a
    // recording to, so one that is still coming up must be thrown away, never stopped and uploaded.
    // The desktop only acts on this session, so a demo it happens to be recording carries on.
    if (desktopStarted) await tellDesktop("cancel", sessionId);
    await chrome.tabs
      .sendMessage(tabId, { type: "LARE_RECORDING_INDICATOR", visible: false })
      .catch(() => undefined);
    await withState(async (s) => ({
      state: { ...s, interview: s.interview?.sessionId === sessionId ? null : s.interview },
      result: undefined,
    }));
    // Only a start that got as far as creating the row has one to close.
    if (session?.synced)
      await getSupabase()
        .from("sessions")
        .update({ status: "ended", ended_at: new Date().toISOString(), graded: false })
        .eq("id", sessionId);
    const aborted = e instanceof DOMException && e.name === "AbortError";
    await setRecording(aborted ? "idle" : "error", aborted ? null : errorText(e));
    if (aborted) return { ok: true, ...(await snapshot()) };
    throw e;
  } finally {
    startAbort = null;
  }
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });

  await refreshBadge();
  await broadcast({
    kind: "success",
    text: "Mock interview started. The desktop app is recording.",
  });
  return { ok: true, ...(await snapshot()) };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Run the manifest's content scripts in a tab that does not have them yet. The MAIN-world script
 * guards against running twice; a stale isolated script from a previous build is already dead.
 */
async function injectPage(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url?.startsWith("https://leetcode.com/")) return;
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
async function showIndicator(tabId: number): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const ok = await chrome.tabs
      .sendMessage(tabId, { type: "LARE_RECORDING_INDICATOR", visible: true })
      .then((res) => res?.ok === true)
      .catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Pause or resume the interview timer. `fromDesktop` is the desktop pill having already paused or
 * resumed the recording, so the timer only follows it.
 */
async function pauseOrResume(
  type: "pause" | "resume",
  fromDesktop = false,
): Promise<RuntimeResponse> {
  const current = await loadState();
  if (!current.interview || timerStatus(current.interview.events) === "ended")
    throw new Error("No live interview");
  const now = Date.now();
  if (!fromDesktop)
    desktop.send({ type: `session.${type}`, sessionId: current.interview.sessionId, at: now });
  const result = await withState(async (s) => {
    if (!s.interview) return { state: s, result: null };
    const status = timerStatus(s.interview.events);
    if ((type === "pause" && status !== "running") || (type === "resume" && status !== "paused")) {
      return { state: s, result: null };
    }
    const events = [...s.interview.events, { t: now, type }];
    return { state: { ...s, interview: { ...s.interview, events } }, result: s.interview };
  });
  if (result) {
    syncTimerEvent(result.sessionId, { t: now, type }).catch((e) =>
      console.warn("[lare] sync event failed", e),
    );
  }
  await refreshBadge();
  await broadcast();
  return { ok: true, ...(await snapshot()) };
}

let ending: Promise<RuntimeResponse> | null = null;
function endSession(): Promise<RuntimeResponse> {
  ending ??= finishSession().finally(() => {
    ending = null;
  });
  return ending;
}
async function finishSession(): Promise<RuntimeResponse> {
  const userId = await currentUserId();
  const now = Date.now();
  const session = await withState(async (s) => {
    if (!s.interview) return { state: s, result: null };
    const events =
      timerStatus(s.interview.events) === "ended"
        ? s.interview.events
        : [...s.interview.events, { t: now, type: "end" as const }];
    return {
      state: { ...s, interview: { ...s.interview, events } },
      result: { ...s.interview, events },
    };
  });
  if (!session) throw new Error("No active session");

  let postId: string | undefined;
  const endedAt = session.events.find((event) => event.type === "end")?.t ?? now;
  // The desktop stops recording, then transcribes and uploads on its own.
  await tellDesktop("end", session.sessionId, endedAt);
  if (session.tabId !== null)
    await chrome.tabs
      .sendMessage(session.tabId, { type: "LARE_RECORDING_INDICATOR", visible: false })
      .catch(() => undefined);
  try {
    if (!userId) throw new Error("Signed out");
    postId = await saveEndedSession(session, userId);
    await withState(async (s) => ({
      state: {
        ...s,
        interview: s.interview?.sessionId === session.sessionId ? null : s.interview,
        pendingSync: s.pendingSync.filter((id) => id !== session.sessionId),
      },
      result: undefined,
    }));
    await broadcast({
      kind: "success",
      text: "Session saved. The desktop app is processing the recording.",
    });
  } catch (e) {
    console.warn("[lare] finalize failed", e);
    // Park it with the other unsaved interviews rather than leaving it as the live one, which
    // would block starting another, signing out and discarding until the save went through.
    await parkUnsaved(session);
    await scheduleSyncRetry(true);
    await setRecording("idle");
    await chrome.alarms.clear(TICK_ALARM);
    await refreshBadge();
    const text = "Couldn’t save the mock interview yet. Lare will keep retrying.";
    await broadcast({ kind: "error", text });
    return { ok: false, error: `${text} (${errorText(e)})` };
  }

  await setRecording("idle");
  await chrome.alarms.clear(TICK_ALARM);
  await refreshBadge();
  return { ok: true, postId, ...(await snapshot()) };
}

/** Write an ended interview to Supabase and create its draft. Returns the post id. */
async function saveEndedSession(session: ActiveSession, userId: string): Promise<string> {
  const endedAt = session.events.find((event) => event.type === "end")?.t ?? Date.now();
  // Rows a flaky start or problem switch never managed to create are needed first: the finalize
  // updates them by id, and an update of a missing row fails silently.
  if (!session.synced) await syncSessionStart(session, userId, session.graded);
  for (const tp of session.problems)
    if (!session.synced || !tp.synced) await syncProblemOpen(session.sessionId, tp, null);
  return finalizeSession(session, userId, endedAt);
}

/** Move an ended interview out of `interview` into `unsaved`, for the background retry. */
async function parkUnsaved(session: ActiveSession): Promise<void> {
  await withState(async (s) => ({
    state: {
      ...s,
      interview: s.interview?.sessionId === session.sessionId ? null : s.interview,
      pendingSync: s.pendingSync.filter((id) => id !== session.sessionId),
      unsaved: [...s.unsaved.filter((u) => u.sessionId !== session.sessionId), session],
    },
    result: undefined,
  }));
}

/**
 * State from a build that kept a failed save in `interview` (or a worker that died mid-save): an
 * ended interview that is not being saved right now belongs with the unsaved ones.
 */
async function parkStaleEndedInterview(): Promise<void> {
  const { interview } = await loadState();
  if (interview && timerStatus(interview.events) === "ended" && !ending)
    await parkUnsaved(interview);
}

async function scheduleSyncRetry(reset: boolean): Promise<void> {
  const delayInMinutes = await nextSyncRetryDelay(reset);
  await chrome.alarms.create(RETRY_SYNC_ALARM, { delayInMinutes });
}

async function clearSyncRetry(): Promise<void> {
  await chrome.alarms.clear(RETRY_SYNC_ALARM);
  await resetSyncRetry();
}

let retrying: Promise<RuntimeResponse> | null = null;
/** Try to save every unsaved interview now: the side panel's Retry, the alarm, back online. */
function retryUnsaved(): Promise<RuntimeResponse> {
  retrying ??= runRetryUnsaved().finally(() => {
    retrying = null;
  });
  return retrying;
}

async function runRetryUnsaved(): Promise<RuntimeResponse> {
  await parkStaleEndedInterview();
  const { unsaved } = await loadState();
  if (unsaved.length === 0) {
    await clearSyncRetry();
    return { ok: true, ...(await snapshot()) };
  }
  const userId = await currentUserId();
  // Signing in triggers a retry, so there is no point waking up for one until then.
  if (!userId) {
    await clearSyncRetry();
    return { ok: false, error: "Sign in to Lare to save your mock interviews." };
  }
  let saved = 0;
  let failure: unknown = null;
  for (const session of unsaved) {
    try {
      await saveEndedSession(session, userId);
      saved++;
      await withState(async (s) => ({
        state: { ...s, unsaved: s.unsaved.filter((u) => u.sessionId !== session.sessionId) },
        result: undefined,
      }));
    } catch (e) {
      console.warn("[lare] retry save failed", session.sessionId, e);
      failure = e;
    }
  }
  await refreshBadge();
  if (failure) {
    await scheduleSyncRetry(false);
    await broadcast();
    return {
      ok: false,
      error: `Couldn’t save yet (${errorText(failure)}). Lare will keep retrying.`,
    };
  }
  await clearSyncRetry();
  await broadcast({
    kind: "success",
    text:
      saved === 1
        ? "Mock interview saved. The desktop app is processing the recording."
        : `${saved} mock interviews saved.`,
  });
  return { ok: true, ...(await snapshot()) };
}

/**
 * Give up on unsaved interviews: forget them here and close their rows so nothing waits on them.
 * The recording was already stopped (not discarded), so the desktop app keeps its copy.
 */
async function discardUnsaved(sessionIds?: string[]): Promise<RuntimeResponse> {
  const dropped = await withState(async (s) => {
    const drop = s.unsaved.filter((u) => !sessionIds || sessionIds.includes(u.sessionId));
    const ids = new Set(drop.map((u) => u.sessionId));
    return {
      state: {
        ...s,
        unsaved: s.unsaved.filter((u) => !ids.has(u.sessionId)),
        pendingSync: s.pendingSync.filter((id) => !ids.has(id)),
      },
      result: drop,
    };
  });
  for (const session of dropped) {
    await deleteSessionEvents(session.sessionId).catch((e) =>
      console.warn("[lare] drop local edits", e),
    );
    // Best effort: likely offline, which is how it got here.
    if (session.synced) {
      const endedAt = session.events.find((event) => event.type === "end")?.t ?? Date.now();
      await getSupabase()
        .from("sessions")
        .update({ status: "ended", ended_at: new Date(endedAt).toISOString() })
        .eq("id", session.sessionId)
        .then(({ error }) => {
          if (error) console.warn("[lare] close discarded session", error);
        });
    }
  }
  if ((await loadState()).unsaved.length === 0) await clearSyncRetry();
  await refreshBadge();
  await broadcast(
    dropped.length > 0
      ? {
          kind: "success",
          text: "Unsaved mock interview removed. The desktop app keeps its copy of the recording.",
        }
      : undefined,
  );
  return { ok: true, ...(await snapshot()) };
}

/** Retry whatever waited on a signed-in user. */
async function afterSignIn(): Promise<void> {
  await retryUnsaved().catch(console.warn);
  await flushSubmissionQueue();
}

/**
 * Passive capture: remember the problem against the inbox so a later submission
 * has a row to attach to, and record that it was solved even if the user never
 * publishes it. Runs on every problem page, signed in or not (a signed-out user
 * is simply skipped — there is nowhere to write).
 */
async function trackProblem(problem: ProblemInfo, question: QuestionDetails | null): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const now = Date.now();

  const target = await withState(async (s) => {
    const existing = s.tracking.problems.find((p) => p.slug === problem.slug);
    if (existing) {
      const problems = s.tracking.problems.map((p) =>
        p.slug === problem.slug ? { ...p, lastSeenAt: now, title: problem.title || p.title } : p,
      );
      return {
        state: { ...s, tracking: { ...s.tracking, problems } },
        result: { entry: existing, isNew: false },
      };
    }
    const entry = {
      sessionProblemId: crypto.randomUUID(),
      slug: problem.slug,
      title: problem.title,
      firstSeenAt: now,
      lastSeenAt: now,
      submissionCount: 0,
      acceptedCount: 0,
      synced: false,
    };
    return {
      state: { ...s, tracking: { ...s.tracking, problems: [...s.tracking.problems, entry] } },
      result: { entry, isNew: true },
    };
  });

  // Already on the server and nothing new to say.
  if (!target.isNew && target.entry.synced) return;

  const run = (async () => {
    try {
      const inboxSessionId = await ensureInbox();
      await trackInboxProblem(
        inboxSessionId,
        target.entry.sessionProblemId,
        problem,
        question,
        target.entry.firstSeenAt,
      );
      await withState(async (s) => ({
        state: {
          ...s,
          tracking: {
            ...s.tracking,
            problems: s.tracking.problems.map((p) =>
              p.sessionProblemId === target.entry.sessionProblemId ? { ...p, synced: true } : p,
            ),
          },
        },
        result: undefined,
      }));
      await refreshBadge();
      await broadcast();
    } catch (e) {
      // Stays unsynced; the next visit or submission retries.
      console.warn("[lare] track problem failed", e);
    }
  })();
  pendingTrack.set(problem.slug, run);
  try {
    await run;
  } finally {
    if (pendingTrack.get(problem.slug) === run) pendingTrack.delete(problem.slug);
  }
}

/**
 * Forget tracked problems that are no longer on the server inbox: posted (from
 * the desktop app, the web or elsewhere) or cleared. Without this the side panel
 * and the badge keep counting work that has already been dealt with, and later
 * submissions attach to a row that now belongs to a published post.
 *
 * Only entries already synced before the request went out are candidates, so a
 * row whose upsert lands mid-request is never mistaken for a deleted one.
 */
async function reconcileTracked(): Promise<void> {
  const { tracking } = await loadState();
  const { inboxSessionId } = tracking;
  const synced = tracking.problems.filter((p) => p.synced).map((p) => p.sessionProblemId);
  if (!inboxSessionId || synced.length === 0 || !(await currentUserId())) return;

  const onServer = await listInboxProblemIds(inboxSessionId);
  const handled = new Set(synced.filter((id) => !onServer.has(id)));
  if (handled.size === 0) return;
  await withState(async (s) => ({
    state: {
      ...s,
      tracking: {
        // An empty inbox may mean the inbox itself is gone; re-resolve it next time.
        inboxSessionId: onServer.size === 0 ? null : s.tracking.inboxSessionId,
        problems: s.tracking.problems.filter((p) => !handled.has(p.sessionProblemId)),
      },
    },
    result: undefined,
  }));
  await refreshBadge();
  await broadcast();
}

/** The inbox session id, resolved once per worker lifetime and cached in state. */
async function ensureInbox(): Promise<string> {
  const cached = (await loadState()).tracking.inboxSessionId;
  if (cached) return cached;
  const inboxSessionId = await resolveInboxSession();
  await withState(async (s) => ({
    state: { ...s, tracking: { ...s.tracking, inboxSessionId } },
    result: undefined,
  }));
  return inboxSessionId;
}

async function problemOpened(
  problem: ProblemInfo,
  question: QuestionDetails | null,
  sourceTabId?: number,
): Promise<RuntimeResponse> {
  // Passive tracking always runs; the interview bookkeeping below only applies
  // while one is live.
  await trackProblem(problem, question);
  const now = Date.now();
  const change = await withState(async (s) => {
    const session = s.interview;
    if (!session || (sourceTabId !== undefined && session.tabId !== sourceTabId))
      return { state: s, result: null };
    if (session.currentSlug === problem.slug) {
      // Same problem: refresh language if we learned it.
      const problems = session.problems.map((p) =>
        p.problem.slug === problem.slug && !p.problem.language && problem.language
          ? { ...p, problem: { ...p.problem, language: problem.language } }
          : p,
      );
      return { state: { ...s, interview: { ...session, problems } }, result: null };
    }
    if (session.scope === "problem") {
      // Single-problem sessions ignore navigation to other problems.
      return {
        state: { ...s, interview: { ...session, currentSlug: session.currentSlug } },
        result: null,
      };
    }
    const events = [...session.events];
    let closed: TrackedProblem | null = null;
    const problems: TrackedProblem[] = [];
    for (const p of session.problems) {
      if (p.problem.slug === session.currentSlug && p.closedAt === null) {
        const c: TrackedProblem = { ...p, closedAt: now };
        closed = c;
        problems.push(c);
      } else {
        problems.push(p);
      }
    }
    if (session.currentSlug)
      events.push({ t: now, type: "problem_close", slug: session.currentSlug });
    const existing = problems.find((p) => p.problem.slug === problem.slug);
    let opened: TrackedProblem;
    if (existing) {
      opened = { ...existing, closedAt: null };
      for (let i = 0; i < problems.length; i++) {
        if (problems[i]?.sessionProblemId === opened.sessionProblemId) problems[i] = opened;
      }
    } else {
      opened = {
        sessionProblemId: crypto.randomUUID(),
        problem,
        openedAt: now,
        closedAt: null,
        editCount: 0,
        submissions: [],
        synced: false,
      };
      problems.push(opened);
    }
    events.push({ t: now, type: "problem_open", slug: problem.slug });
    const next: ActiveSession = { ...session, events, problems, currentSlug: problem.slug };
    return {
      state: { ...s, interview: next },
      result: { session: next, closed, opened, isNew: !existing },
    };
  });

  if (change) {
    const { session, closed, opened, isNew } = change;
    (async () => {
      if (closed) {
        await syncTimerEvent(session.sessionId, {
          t: now,
          type: "problem_close",
          slug: closed.problem.slug,
        });
        await syncProblemClose(session, closed, now);
      }
      if (isNew) {
        await syncProblemOpen(session.sessionId, opened, question);
        await withState(async (s) => {
          if (!s.interview) return { state: s, result: undefined };
          const problems = s.interview.problems.map((p) =>
            p.sessionProblemId === opened.sessionProblemId ? { ...p, synced: true } : p,
          );
          return { state: { ...s, interview: { ...s.interview, problems } }, result: undefined };
        });
      } else {
        await syncTimerEvent(session.sessionId, {
          t: now,
          type: "problem_open",
          slug: problem.slug,
        });
      }
    })().catch((e) => console.warn("[lare] problem sync failed", e));
    await broadcast();
  }
  return { ok: true, ...(await snapshot()) };
}

async function edits(
  slug: string,
  language: string | null,
  events: EditEvent[],
  sourceTabId?: number,
): Promise<RuntimeResponse> {
  if (events.length === 0) return { ok: true };
  const target = await withState(async (s) => {
    const session = s.interview;
    if (!session || (sourceTabId !== undefined && session.tabId !== sourceTabId))
      return { state: s, result: null };
    const tp = session.problems.find((p) => p.problem.slug === slug);
    if (!tp) return { state: s, result: null };
    const problems = session.problems.map((p) =>
      p.sessionProblemId === tp.sessionProblemId
        ? {
            ...p,
            editCount: p.editCount + events.length,
            problem: { ...p.problem, language: p.problem.language ?? language },
          }
        : p,
    );
    return { state: { ...s, interview: { ...session, problems } }, result: { session, tp } };
  });
  if (!target) return { ok: true };
  await appendEvents(target.session.sessionId, target.tp.sessionProblemId, slug, language, events);
  return { ok: true };
}

/**
 * Every submission is captured, interview or not. During an interview it also
 * goes to the desktop app for the live review; otherwise it just lands on the
 * inbox problem so it shows up in the picker.
 */
async function submission(
  slug: string,
  sub: CapturedSubmission,
  problem: ProblemInfo | null,
  question: QuestionDetails | null,
  sourceTabId?: number,
): Promise<RuntimeResponse> {
  // A problem first opened offline or signed out, or tracked and since posted, has no local
  // entry. Track it now so the tally below has somewhere to go and the save has a row.
  await pendingTrack.get(slug)?.catch(() => undefined);
  if (!(await loadState()).tracking.problems.some((p) => p.slug === slug))
    await trackProblem(problem ?? fallbackProblem(slug, null, sub), question);

  type Target = {
    session: ActiveSession | null;
    tp: TrackedProblem | null;
    tracked: InboxProblem | null;
  };
  const target = await withState<Target>(async (s) => {
    const session =
      sourceTabId !== undefined && s.interview?.tabId !== sourceTabId ? null : s.interview;
    const tp = session?.problems.find((p) => p.problem.slug === slug) ?? null;
    const { runtimeDistribution: _r, memoryDistribution: _m, ...lite } = sub;

    // Keep the local tally on the tracked problem so the side panel and the desktop
    // picker can show "2 submissions, 1 accepted" without a round trip.
    const tracked = s.tracking.problems.find((p) => p.slug === slug) ?? null;
    const problems = s.tracking.problems.map((p) =>
      p.slug === slug
        ? {
            ...p,
            submissionCount: p.submissionCount + 1,
            acceptedCount: p.acceptedCount + (sub.accepted ? 1 : 0),
            lastSeenAt: Date.now(),
          }
        : p,
    );
    const nextTracking = { ...s.tracking, problems };

    if (!session || !tp) {
      return {
        state: { ...s, tracking: nextTracking },
        result: { session: null, tp: null, tracked },
      };
    }
    const interviewProblems = session.problems.map((p) =>
      p.sessionProblemId === tp.sessionProblemId
        ? { ...p, submissions: [...p.submissions.slice(-19), lite] }
        : p,
    );
    return {
      state: {
        ...s,
        tracking: nextTracking,
        interview: { ...session, problems: interviewProblems },
      },
      result: { session, tp, tracked },
    };
  });

  let outcome: SaveOutcome;
  if (target.session && target.tp) {
    const sessionProblemId = target.tp.sessionProblemId;
    // The interview keeps its own copy for the review, so the save can wait in the queue.
    outcome = "saved";
    syncSubmission(sessionProblemId, sub).catch(async (e) => {
      console.warn("[lare] submission sync failed; queued", e);
      const userId = await currentUserId();
      if (userId)
        await enqueueSubmission({
          userId,
          slug,
          problem,
          sessionProblemId,
          submission: sub,
          queuedAt: Date.now(),
        });
    });
  } else {
    outcome = await savePracticeSubmission(slug, problem, question, sub);
  }

  await refreshBadge();
  const verdict = sub.accepted
    ? `Accepted${sub.runtimeMs !== null ? ` · ${Math.round(sub.runtimeMs)} ms` : ""}${
        sub.runtimePercentile !== null ? ` · beats ${sub.runtimePercentile.toFixed(2)}%` : ""
      }`
    : (sub.statusDisplay ?? "Submission");
  // "Captured" only once it is actually stored; anything else says what happened instead.
  const toast: NonNullable<StateBroadcast["toast"]> =
    outcome === "saved"
      ? { kind: sub.accepted ? "success" : "info", text: `${verdict} · captured` }
      : outcome === "queued"
        ? { kind: "error", text: `${verdict} · not saved yet. Lare will retry.` }
        : { kind: "error", text: `${verdict} · not saved. Sign in to Lare to capture it.` };
  await broadcast(toast);
  if (outcome === "saved") return { ok: true };
  return { ok: false, error: toast.text };
}

type SaveOutcome = "saved" | "queued" | "signed-out";

/** A stand-in when the page did not say which problem it is (older content scripts). */
function fallbackProblem(slug: string, title: string | null, sub: CapturedSubmission): ProblemInfo {
  return {
    slug,
    frontendId: null,
    title:
      title ||
      slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
    difficulty: null,
    url: `https://leetcode.com/problems/${slug}/`,
    language: sub.lang,
  };
}

/**
 * The inbox row for `slug`, created on demand when tracking it on open did not get that far
 * (offline, signed out, or the earlier row was posted and dropped). Throws while it cannot be.
 */
async function trackedRowId(
  slug: string,
  problem: ProblemInfo | null,
  question: QuestionDetails | null,
  sub: CapturedSubmission,
): Promise<string> {
  // The problem row is the submission's foreign key, so let any in-flight upsert land first.
  await pendingTrack.get(slug)?.catch(() => undefined);
  const find = async () =>
    (await loadState()).tracking.problems.find((p) => p.slug === slug) ?? null;
  let entry = await find();
  if (!entry?.synced) {
    await trackProblem(problem ?? fallbackProblem(slug, entry?.title ?? null, sub), question);
    entry = await find();
  }
  if (!entry?.synced) throw new Error(`Could not add ${slug} to the practice inbox`);
  return entry.sessionProblemId;
}

/** Store a practice submission now, or queue it for when that works again. */
async function savePracticeSubmission(
  slug: string,
  problem: ProblemInfo | null,
  question: QuestionDetails | null,
  sub: CapturedSubmission,
): Promise<SaveOutcome> {
  const userId = await currentUserId();
  if (!userId) return "signed-out";
  try {
    await syncSubmission(await trackedRowId(slug, problem, question, sub), sub);
  } catch (e) {
    console.warn("[lare] submission not saved; queued for retry", e);
    await enqueueSubmission({
      userId,
      slug,
      problem,
      sessionProblemId: null,
      submission: sub,
      queuedAt: Date.now(),
    });
    return "queued";
  }
  // The network works again, so anything queued earlier can go too.
  void flushSubmissionQueue();
  return "saved";
}

let flushing: Promise<void> | null = null;
/** Save queued submissions for the signed-in user, oldest first. */
function flushSubmissionQueue(): Promise<void> {
  flushing ??= runFlushSubmissionQueue()
    .catch((e) => console.warn("[lare] flush submissions", e))
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

async function runFlushSubmissionQueue(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const mine = (await loadSubmissionQueue()).filter((q) => q.userId === userId);
  let saved = 0;
  for (const q of mine) {
    try {
      const rowId =
        q.sessionProblemId ?? (await trackedRowId(q.slug, q.problem, null, q.submission));
      await syncSubmission(rowId, q.submission);
      await removeQueuedSubmission(q.id);
      saved++;
    } catch (e) {
      // Most likely still offline; the rest would fail the same way. Next trigger retries.
      console.warn("[lare] queued submission still not saved", e);
      break;
    }
  }
  if (saved === 0) return;
  await refreshBadge();
  await broadcast({
    kind: "success",
    text:
      saved === 1
        ? "Saved a submission that was waiting."
        : `Saved ${saved} submissions that were waiting.`,
  });
}

// ---------------------------------------------------------------------------
// Desktop app
// ---------------------------------------------------------------------------
async function probeDesktop(userId: string | null): Promise<boolean> {
  try {
    // What the app can do is fixed at handshake time, so a connection made before it signed in or
    // was allowed to record would say "unavailable" forever. Handshake again instead.
    if (desktop.connected && !desktop.recordingAvailable(userId) && !(await loadState()).interview)
      desktop.close();
    await desktop.connect(userId, 3000);
    return desktop.recordingAvailable(userId);
  } catch {
    return false;
  }
}

/**
 * Send `session.end`/`session.cancel` now, or keep it until the desktop app is back: a recording
 * nobody tells to stop runs on, and a cancelled start would still record and upload.
 */
async function tellDesktop(
  frame: "end" | "cancel",
  sessionId: string,
  at = Date.now(),
): Promise<void> {
  const sent = desktop.send({
    type: frame === "end" ? "session.end" : "session.cancel",
    sessionId,
    at,
  });
  if (sent) await clearDesktopFrame(sessionId);
  else await queueDesktopFrame(sessionId, frame);
}

/** Connect to the desktop app if frames are waiting for it (the handshake delivers them). */
async function deliverOutbox(): Promise<void> {
  if (desktop.connected || !(await hasDesktopOutbox())) return;
  await probeDesktop(await currentUserId());
}

/**
 * Catch up after a (re)connect, from the recorder state in `hello.ack`: deliver frames that could
 * not be sent, and bring a live interview in line with what is really being recorded.
 */
async function syncFromAck(ack: HelloAck): Promise<void> {
  const live = ack.recording ?? null;
  const outbox = await takeDesktopOutbox();
  for (const [sessionId, frame] of Object.entries(outbox)) {
    // Only a recording still running for that session needs telling; otherwise it is moot.
    if (live?.sessionId === sessionId)
      desktop.send({
        type: frame === "end" ? "session.end" : "session.cancel",
        sessionId,
        at: Date.now(),
      });
  }
  const { interview } = await loadState();
  if (!interview || startAbort || ending || discarding) return;
  if (timerStatus(interview.events) === "ended") return;
  // Every app that negotiates sends `recording`, null included; absent means it cannot say.
  if (ack.recording === undefined) return;
  if (live?.sessionId === interview.sessionId) {
    // Exactly what the frames themselves would have done, had they arrived.
    await onDesktopMessage({
      type: "recording.state",
      sessionId: live.sessionId,
      state: live.state,
      startedAt: live.startedAt,
      message: null,
    });
    return;
  }
  // Probably restarted mid-interview. Say so rather than guess: ending keeps what was captured,
  // discarding throws it away, and only the user knows which they want.
  await setRecording(
    "error",
    "The desktop app is not recording this interview. End it to save what was captured, or discard it.",
  );
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** Keep trying to get the desktop app back while an interview is live. */
function scheduleReconnect(attempt = 0): void {
  if (reconnectTimer) return;
  const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void reconnectIfLive()
      .then((retry) => {
        if (retry) scheduleReconnect(attempt + 1);
      })
      .catch(console.warn);
  }, delay);
}

/** Reconnect if a live interview has lost the desktop app. Resolves true if it is still lost. */
async function reconnectIfLive(): Promise<boolean> {
  if (desktop.connected) return false;
  const { interview } = await loadState();
  if (!interview || timerStatus(interview.events) === "ended" || startAbort) return false;
  await probeDesktop(await currentUserId());
  await broadcast();
  return !desktop.connected;
}

async function onDesktopMessage(msg: AppToExt): Promise<void> {
  if (msg.type === "hello.ack") {
    await syncFromAck(msg);
    return broadcast();
  }
  if (msg.type !== "recording.state") return;
  const { interview } = await loadState();
  if (!interview || msg.sessionId !== interview.sessionId || startAbort) return;
  if (msg.state === "error") {
    const text = msg.message ?? "The desktop app stopped recording";
    await setRecording("error", text);
    await broadcast({ kind: "error", text });
    return;
  }
  if (msg.state === "recording" || msg.state === "paused" || msg.state === "stopping")
    await setRecording(msg.state, msg.message);
  // The desktop pill can finish an interview on its own. Once the side panel has ended it there is
  // nothing to do: `ending` or `discarding` is in flight, or the session already carries its end
  // event (a save that failed and waits to be retried).
  if (ending || discarding || timerStatus(interview.events) === "ended") return;
  // Pause and resume from the pill: the recording already did it, so the timer follows. A frame
  // that only echoes the side panel's own pause or resume finds the timer there already.
  const status = timerStatus(interview.events);
  if (msg.state === "paused" && status === "running") await pauseOrResume("pause", true);
  else if (msg.state === "recording" && status === "paused") await pauseOrResume("resume", true);
  // End: stop comes first, so save the session exactly as the side panel's End button would. The
  // `session.end` that sends is answered from the recorder's last result, not stopped twice.
  if (msg.state === "stopping") void endSession();
  // Discard: the recording went straight to idle, with no stop before it.
  else if (msg.state === "idle") await discardSession(interview);
}

let discarding: Promise<RuntimeResponse> | null = null;
/** Discard from the side panel: the desktop throws the recording away, the session closes here. */
function discardFromPanel(): Promise<RuntimeResponse> {
  discarding ??= (async () => {
    const { interview } = await loadState();
    if (!interview || timerStatus(interview.events) === "ended")
      throw new Error("No live interview");
    // The `idle` frame this answers with is ignored while `discarding` is set.
    await tellDesktop("cancel", interview.sessionId);
    await discardSession(interview);
    return { ok: true, ...(await snapshot()) } satisfies RuntimeResponse;
  })().finally(() => {
    discarding = null;
  });
  return discarding;
}

/** The take was thrown away: close the interview without a recording. */
async function discardSession(interview: ActiveSession): Promise<void> {
  if (interview.tabId !== null)
    await chrome.tabs
      .sendMessage(interview.tabId, { type: "LARE_RECORDING_INDICATOR", visible: false })
      .catch(() => undefined);
  await withState(async (s) => ({
    state: {
      ...s,
      interview: s.interview?.sessionId === interview.sessionId ? null : s.interview,
    },
    result: undefined,
  }));
  // Same close as a start that failed: the row stays, ungraded, so nothing waits on a recording.
  if (interview.synced)
    await getSupabase()
      .from("sessions")
      .update({ status: "ended", ended_at: new Date().toISOString(), graded: false })
      .eq("id", interview.sessionId)
      .then(({ error }) => {
        if (error) console.warn("[lare] close discarded session", error);
      });
  await chrome.alarms.clear(TICK_ALARM);
  await setRecording("idle");
  await refreshBadge();
  await broadcast({ kind: "success", text: "Mock interview discarded." });
}

async function setRecording(state: RecordingState, message?: string | null): Promise<void> {
  recording = state === "idle" ? null : { state, message: message ?? null };
  await broadcast();
}

async function cancelStart(): Promise<RuntimeResponse> {
  startAbort?.abort();
  if (!startAbort) await setRecording("idle");
  return { ok: true, ...(await snapshot()) };
}

async function resumeAfterRestart(): Promise<void> {
  await parkStaleEndedInterview();
  const state = await loadState();
  if (state.interview) await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
  const userId = await currentUserId();
  await probeDesktop(userId);
  await refreshBadge();
  await broadcast();
  // What waited for a network or a worker that was asleep.
  if (state.unsaved.length > 0) void retryUnsaved();
  void flushSubmissionQueue();
}

// ---------------------------------------------------------------------------
// Snapshot / broadcast / badge
// ---------------------------------------------------------------------------
async function snapshot(): Promise<RuntimeSnapshot> {
  const [state, auth] = await Promise.all([loadState(), getAuthInfo().catch(() => null)]);
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

async function broadcast(toast?: StateBroadcast["toast"]): Promise<void> {
  const snap = await snapshot();
  const msg: StateBroadcast = { type: "STATE_CHANGED", ...snap, toast };
  const tabs = await chrome.tabs.query({ url: ["https://leetcode.com/*", "http://localhost/*"] });
  await Promise.all(
    tabs.map((t) =>
      t.id
        ? chrome.tabs
            .sendMessage(
              t.id,
              t.id === snap.state.interview?.tabId ? msg : { ...msg, recording: null },
            )
            .catch(() => undefined)
        : undefined,
    ),
  );
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

async function refreshBadge(): Promise<void> {
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

  // Otherwise the badge is the count of problems tracked so far this session —
  // the "it is watching" signal, and a nudge that there is something to post.
  const count = state.tracking.problems.length;
  if (count === 0) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: brand.statusRun });
  await chrome.action.setBadgeText({ text: String(count) });
}
