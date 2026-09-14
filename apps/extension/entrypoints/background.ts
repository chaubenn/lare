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
import { getAuthInfo, signInWithOtp, signInWithProvider, signOut, verifyOtp } from "@/src/auth";
import { CAPTURE_KEY, captureCommand, ensureOffscreen, getCapture } from "@/src/capture";
import { appendEvents } from "@/src/editsDb";
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
  syncSessionEnd,
  syncSessionStart,
  syncSubmission,
  syncTimerEvent,
  trackInboxProblem,
} from "@/src/sync";
import { repairGroup, restoreGroup, startGroup } from "@/src/tabGroup";
import { DesktopClient } from "@/src/ws";

const TICK_ALARM = "lare-tick";
/** Periodically drops tracked problems that were posted or cleared from another client. */
const RECONCILE_ALARM = "lare-reconcile";
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
  chrome.action.onClicked.addListener((tab) => void onActionClicked(tab).catch(console.warn));
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (change.groupId !== undefined) void repairGroup().catch(console.warn);
    if (change.status === "loading")
      void getCapture()
        .then((c) => {
          // A full navigation destroys the consent dot; stop rather than record an unmarked page.
          if (c?.tabId === id && ["recording", "paused"].includes(c.state)) return endSession();
        })
        .catch(console.warn);
  });
  chrome.tabGroups.onRemoved.addListener(() => void repairGroup().catch(console.warn));
  chrome.tabs.onRemoved.addListener((id) => {
    void getCapture()
      .then((c) => {
        if (c?.tabId === id && (c.state === "recording" || c.state === "paused"))
          return endSession();
      })
      .catch(console.warn);
  });
  chrome.runtime.onInstalled.addListener(() => {
    void refreshBadge();
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
    if (alarm.name === TICK_ALARM) void refreshBadge();
    if (alarm.name === RECONCILE_ALARM) void reconcileTracked().catch(console.warn);
  });
  // `create` resets the period, and the worker restarts far more often than every few minutes.
  void chrome.alarms.get(RECONCILE_ALARM).then((alarm) => {
    if (!alarm) return chrome.alarms.create(RECONCILE_ALARM, { periodInMinutes: 2 });
  });

  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (
      raw?.target === "background-capture" &&
      sender.url === chrome.runtime.getURL("offscreen.html")
    ) {
      void (async () => {
        if (raw.command === "prepare-review") {
          const state = await loadState();
          const userId = await currentUserId();
          if (!state.interview || !userId) throw new Error("Session unavailable for review");
          await syncSessionEnd(
            state.interview,
            userId,
            state.interview.events.find((event) => event.type === "end")?.t ?? Date.now(),
          );
          return { ok: true };
        }
        if (raw.command === "state") {
          const previous = await getCapture();
          if (previous && previous.sessionId !== raw.state.sessionId)
            throw new Error("Stale capture update");
          await chrome.storage.local.set({ [CAPTURE_KEY]: raw.state });
          if (raw.state.state === "recording" && previous?.state === "starting") {
            const { error } = await getSupabase()
              .from("sessions")
              .update({ recording_started_at: new Date().toISOString() })
              .eq("id", raw.state.sessionId);
            if (error) console.warn("[lare] recording timestamp sync", error);
          }
          if (!raw.state.graded && previous?.graded !== false) {
            const { error } = await getSupabase()
              .from("sessions")
              .update({ graded: false })
              .eq("id", raw.state.sessionId);
            if (error) console.warn("[lare] grading state sync", error);
          }
          void broadcast().catch(console.warn);
          return { ok: true };
        }
        const name =
          raw.command === "create"
            ? "bunny-create-upload"
            : raw.command === "finalize"
              ? "bunny-finalize-recording"
              : null;
        if (!name) throw new Error("Unknown capture operation");
        const { data, error } = await getSupabase().functions.invoke(name, { body: raw.body });
        if (error) throw error;
        return { ok: true, data };
      })()
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
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
        if (res.ok && fromPage && res.capture?.tabId !== sender.tab?.id)
          sendResponse({ ...res, capture: null, recording: null });
        else sendResponse(res);
      })
      .catch((e: unknown) => {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      });
    return true; // async response
  });

  desktop.onMessage((msg) => void onDesktopMessage(msg));
  desktop.onClose(() => void broadcast());
});

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------
async function handle(req: RuntimeRequest, sourceTabId?: number): Promise<RuntimeResponse> {
  switch (req.type) {
    case "DISCARD_RECORDING": {
      const capture = await getCapture();
      if (capture?.state !== "error")
        throw new Error("Only a failed recording can be discarded here");
      if (await chrome.offscreen.hasDocument()) await captureCommand("discard");
      await chrome.storage.local.set({
        [CAPTURE_KEY]: {
          ...capture,
          state: "complete",
          videoId: undefined,
          graded: false,
          message: "Recording discarded. Session data retained.",
        },
      });
      return endSession();
    }
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
    case "GET_STATE":
      // The side panel opening is the moment a stale list would be noticed. While a Start waits
      // for the toolbar click the panel polls to keep this worker alive; that needs no refetch.
      if (sourceTabId === undefined && !pendingStart) void reconcileTracked().catch(console.warn);
      return { ok: true, ...(await snapshot()) };

    case "SIGN_IN":
      await signInWithProvider(req.provider);
      await broadcast({ kind: "success", text: "Signed in to Lare" });
      return { ok: true, ...(await snapshot()) };

    case "SIGN_IN_OTP":
      await signInWithOtp(req.email);
      return { ok: true };

    case "VERIFY_OTP":
      await verifyOtp(req.email, req.token);
      await broadcast({ kind: "success", text: "Signed in to Lare" });
      return { ok: true, ...(await snapshot()) };

    case "SIGN_OUT": {
      const state = await loadState();
      if (state.interview) throw new Error("End the mock interview before signing out");
      await signOut();
      desktop.close();
      await chrome.storage.local.remove(["lare:state", CAPTURE_KEY]);
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
      return retrySync();

    case "START_INTERVIEW":
      return startInterview(req);

    case "PAUSE_SESSION":
    case "RESUME_SESSION":
      return pauseOrResume(req.type === "PAUSE_SESSION" ? "pause" : "resume");

    case "END_SESSION":
      return endSession();

    case "PROBLEM_OPENED":
      return problemOpened(req.problem, req.question, sourceTabId);

    case "EDITS":
      return edits(req.slug, req.language, req.events, sourceTabId);

    case "SUBMISSION":
      return submission(req.slug, req.submission, sourceTabId);
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
  // Capture is the step Chrome gates, so check it before a session row, tab group or indicator
  // exists. The id is thrown away; a fresh one is taken right before capture starts.
  try {
    await chrome.tabCapture.getMediaStreamId({ targetTabId: req.tabId });
  } catch (e) {
    if (!notInvoked(e)) throw e;
    await armStart(req);
    return { ok: true, ...(await snapshot()) };
  }
  startAbort = new AbortController();
  const signal = startAbort.signal;

  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const tp: TrackedProblem | null = req.problem
    ? {
        sessionProblemId: crypto.randomUUID(),
        problem: req.problem,
        openedAt: now,
        closedAt: null,
        editCount: 0,
        submissions: [],
        synced: false,
      }
    : null;

  const session: ActiveSession = {
    sessionId,
    kind: "interview",
    scope: "problem",
    startedAt: now,
    events: tp
      ? [
          { t: now, type: "start" },
          { t: now, type: "problem_open", slug: tp.problem.slug },
        ]
      : [{ t: now, type: "start" }],
    problems: tp ? [tp] : [],
    currentSlug: tp?.problem.slug ?? null,
    tabId: req.tabId,
    facecam: req.facecam,
    synced: false,
  };

  await setRecording("starting");
  try {
    if (req.graded && !(await probeDesktop(userId)))
      throw new Error(
        "Open an updated Lare desktop app, or explicitly turn off Transcript & AI review",
      );
    await syncSessionStart(session, userId, req.graded);
    if (tp) await syncProblemOpen(sessionId, tp, req.question);
    session.synced = true;
    if (tp) tp.synced = true;
    await withState(async (s) => ({ state: { ...s, interview: session }, result: undefined }));
    await ensureOffscreen();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: req.tabId });
    if (signal.aborted) throw new Error("Start cancelled");
    await chrome.storage.local.set({
      [CAPTURE_KEY]: { sessionId, tabId: req.tabId, graded: req.graded, state: "starting" },
    });
    // Consent indicator must be acknowledged by the recorded page before any media starts.
    const indicator = await chrome.tabs.sendMessage(req.tabId, {
      type: "LARE_RECORDING_INDICATOR",
      visible: true,
    });
    if (!indicator?.ok) throw new Error("Cannot show the recording indicator on this tab");
    await startGroup(req.tabId).catch((e) => console.warn("[lare] tab outline unavailable", e));
    await captureCommand("start", {
      sessionId,
      tabId: req.tabId,
      streamId,
      userId,
      graded: req.graded,
      facecam: req.facecam,
    });
    if (signal.aborted) return await endSession();
  } catch (e) {
    const failedCapture = await getCapture();
    if (
      failedCapture?.sessionId === sessionId &&
      ["recording", "paused", "uploading"].includes(failedCapture.state)
    ) {
      return await endSession();
    }
    await restoreGroup().catch(console.warn);
    await chrome.tabs
      .sendMessage(req.tabId, { type: "LARE_RECORDING_INDICATOR", visible: false })
      .catch(() => undefined);
    await chrome.storage.local.remove(CAPTURE_KEY);
    await withState(async (s) => ({
      state: { ...s, interview: s.interview?.sessionId === sessionId ? null : s.interview },
      result: undefined,
    }));
    await getSupabase()
      .from("sessions")
      .update({ status: "ended", ended_at: new Date().toISOString(), graded: false })
      .eq("id", sessionId);
    await setRecording("error", e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    startAbort = null;
  }
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });

  await refreshBadge();
  await broadcast({
    kind: "success",
    text: "Mock interview started. Recording.",
  });
  return { ok: true, ...(await snapshot()) };
}

// ---------------------------------------------------------------------------
// Toolbar hand-off
//
// Chrome only lets an extension capture a tab it was invoked on: its toolbar icon or shortcut,
// used on that tab. A click inside the side panel never counts, and the grant ends when the tab
// reloads. So when Start is refused, the Start is parked and the toolbar icon stops opening the
// panel for a moment; the user's click on it grants the tab and finishes the same Start.
// ---------------------------------------------------------------------------
type StartRequest = Extract<RuntimeRequest, { type: "START_INTERVIEW" }>;
const ARMED_MS = 2 * 60_000;
let pendingStart: { req: StartRequest; timer: ReturnType<typeof setTimeout> } | null = null;

function notInvoked(e: unknown): boolean {
  return /not been invoked|activeTab/i.test(e instanceof Error ? e.message : String(e));
}

async function armStart(req: StartRequest): Promise<void> {
  if (pendingStart) clearTimeout(pendingStart.timer);
  pendingStart = { req, timer: setTimeout(() => void disarmStart(), ARMED_MS) };
  recording = null;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  await chrome.action.setTitle({ title: "Lare: click to start recording this tab" });
  await refreshBadge();
  await broadcast();
}

async function disarmStart(): Promise<void> {
  if (!pendingStart) return;
  clearTimeout(pendingStart.timer);
  pendingStart = null;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.action.setTitle({ title: "Lare" });
  await refreshBadge();
  await broadcast();
}

/** Only fires while armed: otherwise the icon opens the side panel and Chrome sends no click. */
async function onActionClicked(tab: chrome.tabs.Tab): Promise<void> {
  const pending = pendingStart;
  if (!pending) {
    // A worker that died while armed leaves the panel behaviour off; behave like the panel.
    if (tab.windowId !== undefined)
      void chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.warn);
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    return;
  }
  if (tab.id !== pending.req.tabId) {
    await setRecording(
      "error",
      "Switch back to the problem tab you pressed Start on, then click the Lare icon.",
    );
    return;
  }
  await disarmStart();
  try {
    await startInterview(pending.req);
  } catch (e) {
    await setRecording("error", e instanceof Error ? e.message : String(e));
  }
}

async function pauseOrResume(type: "pause" | "resume"): Promise<RuntimeResponse> {
  const current = await loadState();
  if (!current.interview || timerStatus(current.interview.events) === "ended")
    throw new Error("No live interview");
  await captureCommand(type);
  const now = Date.now();
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
  try {
    const capture = await getCapture();
    if (capture?.state !== "complete")
      await captureCommand(capture?.state === "error" ? "retry" : "stop");
    await restoreGroup().catch(console.warn);
    if (session.tabId !== null)
      await chrome.tabs
        .sendMessage(session.tabId, { type: "LARE_RECORDING_INDICATOR", visible: false })
        .catch(() => undefined);
    if (!userId) throw new Error("Signed out");
    if (!session.synced) {
      await syncSessionStart(session, userId, (await getCapture())?.graded ?? false);
      for (const tp of session.problems) await syncProblemOpen(session.sessionId, tp, null);
    }
    const endedAt = session.events.find((event) => event.type === "end")?.t ?? now;
    postId = await finalizeSession(session, userId, endedAt);
    await withState(async (s) => ({
      state: {
        ...s,
        interview: null,
        pendingSync: s.pendingSync.filter((id) => id !== session.sessionId),
      },
      result: undefined,
    }));
    await broadcast({ kind: "success", text: "Session saved. Draft is ready in Lare." });
  } catch (e) {
    await restoreGroup().catch(console.warn);
    if (session.tabId !== null)
      await chrome.tabs
        .sendMessage(session.tabId, { type: "LARE_RECORDING_INDICATOR", visible: false })
        .catch(() => undefined);
    console.warn("[lare] finalize failed", e);
    // Keep the ended session around so it can be retried from the side panel.
    await withState(async (s) => ({
      state: { ...s, pendingSync: [...new Set([...s.pendingSync, session.sessionId])] },
      result: undefined,
    }));
    await broadcast({ kind: "error", text: "Could not save the session yet. Will retry." });
    await chrome.alarms.clear(TICK_ALARM);
    await refreshBadge();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (session.kind !== "interview") desktop.close();
  await setRecording("idle");
  await chrome.alarms.clear(TICK_ALARM);
  await refreshBadge();
  return { ok: true, postId, ...(await snapshot()) };
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
  sourceTabId?: number,
): Promise<RuntimeResponse> {
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

  if (target.session && target.tp) {
    syncSubmission(target.tp.sessionProblemId, sub).catch((e) =>
      console.warn("[lare] submission sync failed", e),
    );
  } else {
    // Practice: attach to the inbox row, creating it first if this is the very
    // first thing we have seen for the problem.
    void (async () => {
      try {
        // The problem row is the submission's foreign key, so let any in-flight
        // upsert finish before inserting against it.
        await pendingTrack.get(slug)?.catch(() => undefined);
        const state = await loadState();
        const entry = state.tracking.problems.find((p) => p.slug === slug) ?? null;
        if (!entry?.synced) {
          console.warn("[lare] no tracked problem row for", slug, "- submission not stored");
          return;
        }
        await syncSubmission(entry.sessionProblemId, sub);
      } catch (e) {
        console.warn("[lare] submission sync failed", e);
      }
    })();
  }

  await refreshBadge();
  await broadcast({
    kind: sub.accepted ? "success" : "info",
    text: sub.accepted
      ? `Accepted${sub.runtimeMs !== null ? ` · ${Math.round(sub.runtimeMs)} ms` : ""}${
          sub.runtimePercentile !== null ? ` · beats ${sub.runtimePercentile.toFixed(2)}%` : ""
        } · captured`
      : `${sub.statusDisplay ?? "Submission"} · captured`,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Desktop app
// ---------------------------------------------------------------------------
async function probeDesktop(userId: string | null): Promise<boolean> {
  try {
    // Capabilities are fixed at handshake time, so a connection made before the app signed in or
    // downloaded its speech model would report "unavailable" forever. Handshake again instead.
    if (desktop.connected && !desktop.gradingAvailable(userId) && !(await loadState()).interview)
      desktop.close();
    await desktop.connect(userId, 3000);
    return desktop.gradingAvailable(userId);
  } catch {
    return false;
  }
}

async function onDesktopMessage(msg: AppToExt): Promise<void> {
  if (msg.type === "hello.ack") await broadcast();
}

async function setRecording(state: RecordingState, message?: string | null): Promise<void> {
  recording = state === "idle" ? null : { state, message: message ?? null };
  await broadcast();
}

async function cancelStart(): Promise<RuntimeResponse> {
  await disarmStart();
  startAbort?.abort();
  if (!startAbort) await setRecording("idle");
  return { ok: true, ...(await snapshot()) };
}

async function retrySync(): Promise<RuntimeResponse> {
  return endSession();
}

async function resumeAfterRestart(): Promise<void> {
  const capture = await getCapture();
  if (capture && ["recording", "paused", "starting", "uploading"].includes(capture.state)) {
    const alive = await chrome.offscreen.hasDocument();
    if (alive) await repairGroup().catch(console.warn);
    else {
      await chrome.storage.local.set({
        [CAPTURE_KEY]: {
          ...capture,
          state: "error",
          graded: false,
          message:
            "Browser capture was interrupted. Unsaved media cannot be recovered after a browser restart.",
        },
      });
      await restoreGroup().catch(console.warn);
    }
  }
  const state = await loadState();
  if (state.interview) {
    const sessionId = state.interview.sessionId;
    if (capture && !(await chrome.offscreen.hasDocument()) && capture.state !== "complete") {
      await withState(async (s) => ({
        state: { ...s, pendingSync: [...new Set([...s.pendingSync, sessionId])] },
        result: undefined,
      }));
    }
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
  }
  const userId = await currentUserId();
  await probeDesktop(userId);
  await refreshBadge();
  await broadcast();
}

// ---------------------------------------------------------------------------
// Snapshot / broadcast / badge
// ---------------------------------------------------------------------------
async function snapshot(): Promise<RuntimeSnapshot> {
  const [state, auth] = await Promise.all([loadState(), getAuthInfo().catch(() => null)]);
  const capture = await getCapture();
  const appConnected = desktop.gradingAvailable(auth?.userId ?? null);
  return {
    state: { ...state, appConnected },
    auth,
    appConnected,
    gradingBlocker: desktop.gradingBlocker(auth?.userId ?? null),
    awaitingToolbarClick: pendingStart !== null,
    buildId: __BUILD_ID__,
    capture,
    // A failed toolbar hand-off is newer than whatever the last capture left behind.
    recording:
      recording?.state === "error"
        ? recording
        : capture
          ? {
              state:
                capture.state === "complete"
                  ? "idle"
                  : capture.state === "uploading"
                    ? "stopping"
                    : capture.state,
              message: capture.message,
            }
          : recording,
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
              t.id === snap.capture?.tabId ? msg : { ...msg, capture: null, recording: null },
            )
            .catch(() => undefined)
        : undefined,
    ),
  );
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

async function refreshBadge(): Promise<void> {
  // Pointing at the icon the user has to click next.
  if (pendingStart) {
    await chrome.action.setBadgeBackgroundColor({ color: brand.statusStop });
    await chrome.action.setBadgeText({ text: "REC" });
    return;
  }
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
