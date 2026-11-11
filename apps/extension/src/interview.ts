/**
 * The mock interview: start, pause, end, discard, and what happens to one that ended but could
 * not be saved. The desktop app does the recording; this keeps the session, its timer and its
 * Supabase rows.
 */
import {
  type ActiveSession,
  type AppToExt,
  type ExtensionState,
  type TrackedProblem,
  timerStatus,
} from "@lare/shared";
import { desktop, probeDesktop, tellDesktop } from "./desktopLink";
import { deleteSessionEvents } from "./editsDb";
import { type RuntimeRequest, type RuntimeResponse, requestFromTab } from "./messages";
import { nextSyncRetryDelay, resetSyncRetry } from "./queues";
import { broadcast, refreshBadge, setRecording, snapshot } from "./snapshot";
import { loadState, withState } from "./storage";
import { currentUserId } from "./supabase";
import {
  closeSession,
  finalizeSession,
  syncProblemOpen,
  syncSessionStart,
  syncTimerEvent,
} from "./sync";
import { hideIndicator } from "./tabs";
import { errorText, singleFlight } from "./util";
import { START_TIMEOUT_MS } from "./ws";

/** Runs while an interview is live: the badge's minute count, and a reconnect backstop. */
export const TICK_ALARM = "lare-tick";
/** Next attempt at saving mock interviews that ended but could not be saved (with backoff). */
export const RETRY_SYNC_ALARM = "lare-retry-sync";

/** Half a minute is the shortest period Chrome allows an alarm. */
export function startTick(): Promise<void> {
  return chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
}

/** Set from the moment a start is accepted until it has succeeded, failed or been called off. */
let startAbort: AbortController | null = null;

/** A start is in flight: the session may exist in state, but it is not recording yet. */
export function isStarting(): boolean {
  return startAbort !== null;
}

/** The interview is being ended (and saved) or discarded right now. */
export function isFinishing(): boolean {
  return endSession.busy() || discardFromPanel.busy();
}

/** When the session's timer was stopped, if it has been. */
function endedAt(session: ActiveSession): number | undefined {
  return session.events.find((event) => event.type === "end")?.t;
}

/** `interview` for a state that `sessionId` has just left: whatever else is there stays. */
function interviewWithout(s: ExtensionState, sessionId: string): ActiveSession | null {
  return s.interview?.sessionId === sessionId ? null : s.interview;
}

/**
 * The live interview, as far as a request from `sourceTabId` is concerned: a content script only
 * speaks for the tab being recorded. Requests from the extension's own pages carry no tab id.
 */
export function interviewForTab(
  s: ExtensionState,
  sourceTabId: number | undefined,
): ActiveSession | null {
  return sourceTabId !== undefined && s.interview?.tabId !== sourceTabId ? null : s.interview;
}

export async function startInterview(
  req: Extract<RuntimeRequest, { type: "START_INTERVIEW" }>,
): Promise<RuntimeResponse> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Sign in to Lare first (click the extension icon)");
  const existing = await loadState();
  if (existing.interview || isStarting())
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
    const indicator = await requestFromTab(tabId, {
      type: "LARE_RECORDING_INDICATOR",
      visible: true,
    });
    if (!indicator?.ok) throw new Error("Cannot show the recording indicator on this tab");

    const answer = desktop.waitFor(
      (m): m is Extract<AppToExt, { type: "recording.state" }> =>
        m.type === "recording.state" &&
        m.sessionId === sessionId &&
        (m.state === "recording" || m.state === "error"),
      START_TIMEOUT_MS,
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
    await hideIndicator(tabId);
    await withState(async (s) => ({
      state: { ...s, interview: interviewWithout(s, sessionId) },
      result: undefined,
    }));
    // Only a start that got as far as creating the row has one to close.
    if (session?.synced) await closeSession(sessionId, Date.now(), true);
    const aborted = e instanceof DOMException && e.name === "AbortError";
    await setRecording(aborted ? "idle" : "error", aborted ? null : errorText(e));
    if (aborted) return { ok: true, ...(await snapshot()) };
    throw e;
  } finally {
    startAbort = null;
  }
  await startTick();

  await refreshBadge();
  await broadcast({
    kind: "success",
    text: "Mock interview started. The desktop app is recording.",
  });
  return { ok: true, ...(await snapshot()) };
}

export async function cancelStart(): Promise<RuntimeResponse> {
  startAbort?.abort();
  if (!startAbort) await setRecording("idle");
  return { ok: true, ...(await snapshot()) };
}

/**
 * Pause or resume the interview timer. `fromDesktop` is the desktop pill having already paused or
 * resumed the recording, so the timer only follows it.
 */
export async function pauseOrResume(
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

/**
 * End the interview and save it. Ends that arrive together (side panel, desktop pill, tab closed)
 * share one run.
 */
export const endSession = singleFlight(finishSession);

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
  // The desktop stops recording, then transcribes and uploads on its own.
  await tellDesktop("end", session.sessionId, endedAt(session) ?? now);
  if (session.tabId !== null) await hideIndicator(session.tabId);
  try {
    if (!userId) throw new Error("Signed out");
    postId = await saveEndedSession(session, userId);
    await withState(async (s) => ({
      state: {
        ...s,
        interview: interviewWithout(s, session.sessionId),
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
  // Rows a flaky start or problem switch never managed to create are needed first: the finalize
  // updates them by id, and an update of a missing row fails silently.
  if (!session.synced) await syncSessionStart(session, userId, session.graded);
  for (const tp of session.problems)
    if (!session.synced || !tp.synced) await syncProblemOpen(session.sessionId, tp, null);
  return finalizeSession(session, userId, endedAt(session) ?? Date.now());
}

/** Move an ended interview out of `interview` into `unsaved`, for the background retry. */
async function parkUnsaved(session: ActiveSession): Promise<void> {
  await withState(async (s) => ({
    state: {
      ...s,
      interview: interviewWithout(s, session.sessionId),
      unsaved: [...s.unsaved.filter((u) => u.sessionId !== session.sessionId), session],
    },
    result: undefined,
  }));
}

/**
 * State from a build that kept a failed save in `interview` (or a worker that died mid-save): an
 * ended interview that is not being saved right now belongs with the unsaved ones.
 */
export async function parkStaleEndedInterview(): Promise<void> {
  const { interview } = await loadState();
  if (interview && timerStatus(interview.events) === "ended" && !endSession.busy())
    await parkUnsaved(interview);
}

async function scheduleSyncRetry(reset: boolean): Promise<void> {
  const delayInMinutes = await nextSyncRetryDelay(reset);
  await chrome.alarms.create(RETRY_SYNC_ALARM, { delayInMinutes });
}

/** Stop the retry alarm and start the backoff over. */
export async function clearSyncRetry(): Promise<void> {
  await chrome.alarms.clear(RETRY_SYNC_ALARM);
  await resetSyncRetry();
}

/** Try to save every unsaved interview now: the side panel's Retry, the alarm, back online. */
export const retryUnsaved = singleFlight(runRetryUnsaved);

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
export async function discardUnsaved(sessionIds?: string[]): Promise<RuntimeResponse> {
  const dropped = await withState(async (s) => {
    const drop = s.unsaved.filter((u) => !sessionIds || sessionIds.includes(u.sessionId));
    const ids = new Set(drop.map((u) => u.sessionId));
    return {
      state: {
        ...s,
        unsaved: s.unsaved.filter((u) => !ids.has(u.sessionId)),
      },
      result: drop,
    };
  });
  for (const session of dropped) {
    await deleteSessionEvents(session.sessionId).catch((e) =>
      console.warn("[lare] drop local edits", e),
    );
    // Best effort: likely offline, which is how it got here.
    if (session.synced)
      await closeSession(session.sessionId, endedAt(session) ?? Date.now(), false);
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

/** Discard from the side panel: the desktop throws the recording away, the session closes here. */
export const discardFromPanel = singleFlight(async (): Promise<RuntimeResponse> => {
  const { interview } = await loadState();
  if (!interview || timerStatus(interview.events) === "ended") throw new Error("No live interview");
  // The app answers this with an `idle` frame, which is ignored while the discard is in flight
  // (`isFinishing`).
  await tellDesktop("cancel", interview.sessionId);
  await discardSession(interview);
  return { ok: true, ...(await snapshot()) };
});

/** The take was thrown away: close the interview without a recording. */
export async function discardSession(interview: ActiveSession): Promise<void> {
  if (interview.tabId !== null) await hideIndicator(interview.tabId);
  await withState(async (s) => ({
    state: { ...s, interview: interviewWithout(s, interview.sessionId) },
    result: undefined,
  }));
  // Same close as a start that failed: the row stays, ungraded, so nothing waits on a recording.
  if (interview.synced) await closeSession(interview.sessionId, Date.now(), true);
  await chrome.alarms.clear(TICK_ALARM);
  await setRecording("idle");
  await refreshBadge();
  await broadcast({ kind: "success", text: "Mock interview discarded." });
}
