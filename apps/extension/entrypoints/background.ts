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
import { currentUserId } from "@/src/supabase";
import {
  finalizeSession,
  resolveInboxSession,
  syncProblemClose,
  syncProblemOpen,
  syncSessionStart,
  syncSubmission,
  syncTimerEvent,
  trackInboxProblem,
} from "@/src/sync";
import { DesktopClient } from "@/src/ws";

const TICK_ALARM = "lare-tick";
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
  });

  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const parsed = RuntimeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      // Not for us (e.g. STATE_CHANGED broadcast echoing back).
      return false;
    }
    handle(parsed.data)
      .then(sendResponse)
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
async function handle(req: RuntimeRequest): Promise<RuntimeResponse> {
  switch (req.type) {
    case "GET_STATE":
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
      return problemOpened(req.problem, req.question);

    case "EDITS":
      return edits(req.slug, req.language, req.events);

    case "SUBMISSION":
      return submission(req.slug, req.submission);

    case "MARK_TRACKED_REVIEWED":
      return markTrackedReviewed();
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
  if (existing.interview) throw new Error("A mock interview is already running");

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

  {
    if (!req.problem) throw new Error("Open a LeetCode problem to start a mock interview");
    startAbort = new AbortController();
    const signal = startAbort.signal;
    await setRecording("starting");
    try {
      await desktop.connect(userId, 2000).catch(() => {
        throw new Error("Open the Lare desktop app to start a mock interview");
      });
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const ack = desktop.ack;
      if (ack?.userId && ack.userId !== userId) {
        throw new Error("The desktop app is signed in as a different user");
      }
      if (ack && !ack.recordingCapable) {
        throw new Error("Grant Lare screen-recording permission in the desktop app first");
      }
      desktop.send({
        type: "session.start",
        sessionId,
        kind: "interview",
        scope: "problem",
        startedAt: now,
        problem: req.problem,
        facecam: req.facecam,
        mic: true,
      });
      const state = await desktop.waitFor(
        (m): m is Extract<AppToExt, { type: "recording.state" }> =>
          m.type === "recording.state" && (m.state === "recording" || m.state === "error"),
        30_000,
        signal,
      );
      if (state.state === "error") {
        throw new Error(state.message ?? "The desktop app could not start recording");
      }
      if (tp) {
        desktop.send({
          type: "problem.open",
          sessionId,
          sessionProblemId: tp.sessionProblemId,
          at: now,
          problem: req.problem,
        });
      }
    } catch (e) {
      desktop.send({ type: "session.end", sessionId, at: Date.now() });
      if (e instanceof DOMException && e.name === "AbortError") {
        await setRecording("idle");
        return { ok: true, ...(await snapshot()) };
      }
      await setRecording("error", e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      startAbort = null;
    }
  }

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

  await withState(async (s) => ({ state: { ...s, interview: session }, result: undefined }));
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });

  // Best-effort remote sync; the session keeps running locally if this fails.
  try {
    await syncSessionStart(session, userId);
    if (tp) await syncProblemOpen(sessionId, tp, req.question);
    await withState(async (s) => {
      if (!s.interview || s.interview.sessionId !== sessionId)
        return { state: s, result: undefined };
      const problems = s.interview.problems.map((p) => ({ ...p, synced: true }));
      return {
        state: { ...s, interview: { ...s.interview, synced: true, problems } },
        result: undefined,
      };
    });
  } catch (e) {
    console.warn("[lare] initial sync failed", e);
    await broadcast({ kind: "error", text: "Offline: session will sync when you end it" });
  }

  await refreshBadge();
  await broadcast({
    kind: "success",
    text: "Mock interview started. Recording.",
  });
  return { ok: true, ...(await snapshot()) };
}

async function pauseOrResume(type: "pause" | "resume"): Promise<RuntimeResponse> {
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
    if (result.kind === "interview") {
      desktop.send({
        type: type === "pause" ? "session.pause" : "session.resume",
        sessionId: result.sessionId,
        at: now,
      });
    }
    syncTimerEvent(result.sessionId, { t: now, type }).catch((e) =>
      console.warn("[lare] sync event failed", e),
    );
  }
  await refreshBadge();
  await broadcast();
  return { ok: true, ...(await snapshot()) };
}

async function endSession(): Promise<RuntimeResponse> {
  const userId = await currentUserId();
  const now = Date.now();
  const session = await withState(async (s) => {
    if (!s.interview) return { state: s, result: null };
    const events = [...s.interview.events, { t: now, type: "end" as const }];
    return {
      state: { ...s, interview: { ...s.interview, events } },
      result: { ...s.interview, events },
    };
  });
  if (!session) throw new Error("No active session");

  if (session.kind === "interview") {
    desktop.send({ type: "session.end", sessionId: session.sessionId, at: now });
  }

  let postId: string | undefined;
  try {
    if (!userId) throw new Error("Signed out");
    if (!session.synced) {
      await syncSessionStart(session, userId);
      for (const tp of session.problems) await syncProblemOpen(session.sessionId, tp, null);
    }
    postId = await finalizeSession(session, userId, now);
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
    console.warn("[lare] finalize failed", e);
    // Keep the ended session around so it can be retried from the popup.
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
      reviewedAt: null,
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

/**
 * Clear the popup list and the badge once the user has gone to review them in the
 * desktop app. Local only: the `session_problems` rows stay on the inbox, so the
 * desktop app keeps showing everything that has not been posted yet.
 *
 * Entries are marked rather than removed — see `reviewedAt` in InboxProblemSchema.
 */
async function markTrackedReviewed(): Promise<RuntimeResponse> {
  const now = Date.now();
  await withState(async (s) => ({
    state: {
      ...s,
      tracking: {
        ...s.tracking,
        problems: s.tracking.problems.map((p) =>
          p.reviewedAt === null ? { ...p, reviewedAt: now } : p,
        ),
      },
    },
    result: undefined,
  }));
  await refreshBadge();
  await broadcast();
  return { ok: true, ...(await snapshot()) };
}

async function problemOpened(
  problem: ProblemInfo,
  question: QuestionDetails | null,
): Promise<RuntimeResponse> {
  // Passive tracking always runs; the interview bookkeeping below only applies
  // while one is live.
  await trackProblem(problem, question);
  const now = Date.now();
  const change = await withState(async (s) => {
    const session = s.interview;
    if (!session) return { state: s, result: null };
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
    if (session.kind === "interview") {
      desktop.send({
        type: "problem.open",
        sessionId: session.sessionId,
        sessionProblemId: opened.sessionProblemId,
        at: now,
        problem,
      });
    }
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
): Promise<RuntimeResponse> {
  if (events.length === 0) return { ok: true };
  const target = await withState(async (s) => {
    const session = s.interview;
    if (!session) return { state: s, result: null };
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
  if (target.session.kind === "interview") {
    desktop.send({
      type: "edits.batch",
      sessionId: target.session.sessionId,
      sessionProblemId: target.tp.sessionProblemId,
      slug,
      events,
    });
  }
  return { ok: true };
}

/**
 * Every submission is captured, interview or not. During an interview it also
 * goes to the desktop app for the live review; otherwise it just lands on the
 * inbox problem so it shows up in the picker.
 */
async function submission(slug: string, sub: CapturedSubmission): Promise<RuntimeResponse> {
  type Target = {
    session: ActiveSession | null;
    tp: TrackedProblem | null;
    tracked: InboxProblem | null;
  };
  const target = await withState<Target>(async (s) => {
    const session = s.interview;
    const tp = session?.problems.find((p) => p.problem.slug === slug) ?? null;
    const { runtimeDistribution: _r, memoryDistribution: _m, ...lite } = sub;

    // Keep the local tally on the tracked problem so the popup and the desktop
    // picker can show "2 submissions, 1 accepted" without a round trip.
    const tracked = s.tracking.problems.find((p) => p.slug === slug) ?? null;
    const problems = s.tracking.problems.map((p) =>
      p.slug === slug
        ? {
            ...p,
            submissionCount: p.submissionCount + 1,
            acceptedCount: p.acceptedCount + (sub.accepted ? 1 : 0),
            lastSeenAt: Date.now(),
            // Submitting again is new work, so a problem already carried over to
            // the desktop app comes back into the list. Merely re-opening it does
            // not (see `trackProblem`).
            reviewedAt: null,
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
    const {
      runtimeDistribution: _r,
      memoryDistribution: _m,
      langVerbose: _l,
      runtimeDisplay: _rd,
      memoryDisplay: _md,
      ...info
    } = sub;
    desktop.send({
      type: "submission",
      sessionId: target.session.sessionId,
      sessionProblemId: target.tp.sessionProblemId,
      submission: info,
    });
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
    await desktop.connect(userId, 3000);
    return true;
  } catch {
    return false;
  }
}

async function onDesktopMessage(msg: AppToExt): Promise<void> {
  if (msg.type !== "recording.state") return;
  recording = { state: msg.state, message: msg.message ?? null };
  if (msg.state === "error") {
    await broadcast({ kind: "error", text: msg.message ?? "Recording error in the desktop app" });
  } else {
    await broadcast();
  }
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

async function retrySync(): Promise<RuntimeResponse> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Sign in to Lare first");
  const state = await loadState();
  const session = state.interview;
  if (!session || !state.pendingSync.includes(session.sessionId)) {
    throw new Error("Nothing to retry");
  }
  let endedAt = Date.now();
  for (let i = session.events.length - 1; i >= 0; i--) {
    const event = session.events[i];
    if (event?.type === "end") {
      endedAt = event.t;
      break;
    }
  }
  const postId = await finalizeSession(session, userId, endedAt);
  await withState(async (s) => ({
    state: {
      ...s,
      interview: null,
      pendingSync: s.pendingSync.filter((id) => id !== session.sessionId),
    },
    result: undefined,
  }));
  await chrome.alarms.clear(TICK_ALARM);
  await refreshBadge();
  await broadcast({ kind: "success", text: "Session saved. Draft is ready in Lare." });
  return { ok: true, postId, ...(await snapshot()) };
}

async function resumeAfterRestart(): Promise<void> {
  const state = await loadState();
  if (state.interview) {
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
  return {
    state: { ...state, appConnected: desktop.connected },
    auth,
    appConnected: desktop.connected,
    recording,
  };
}

async function broadcast(toast?: StateBroadcast["toast"]): Promise<void> {
  const snap = await snapshot();
  const msg: StateBroadcast = { type: "STATE_CHANGED", ...snap, toast };
  const tabs = await chrome.tabs.query({ url: ["https://leetcode.com/*", "http://localhost/*"] });
  await Promise.all(
    tabs.map((t) => (t.id ? chrome.tabs.sendMessage(t.id, msg).catch(() => undefined) : undefined)),
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

  // Otherwise the badge is the count of problems still waiting to be reviewed —
  // the "it is watching" signal, and a nudge that there is something to post.
  const count = state.tracking.problems.filter((p) => p.reviewedAt === null).length;
  if (count === 0) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: brand.statusRun });
  await chrome.action.setBadgeText({ text: String(count) });
}
