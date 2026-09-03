import {
  type ActiveSession,
  type AppToExt,
  type EditEvent,
  type ProblemInfo,
  type TrackedProblem,
  activeMs,
  timerStatus,
} from "@lare/shared";
import { getAuthInfo, signInWithOtp, signInWithProvider, signOut, verifyOtp } from "@/src/auth";
import { appendEvents } from "@/src/editsDb";
import {
  type CapturedSubmission,
  type QuestionDetails,
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
  syncProblemClose,
  syncProblemOpen,
  syncSessionStart,
  syncSubmission,
  syncTimerEvent,
} from "@/src/sync";
import { DesktopClient } from "@/src/ws";

const TICK_ALARM = "lare-tick";
const desktop = new DesktopClient();

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void refreshBadge();
  });
  chrome.runtime.onStartup.addListener(() => {
    void resumeAfterRestart();
  });
  void resumeAfterRestart();

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
      if (state.session) throw new Error("End the active session before signing out");
      await signOut();
      await broadcast();
      return { ok: true, ...(await snapshot()) };
    }

    case "PROBE_APP": {
      const userId = await currentUserId();
      const connected = await probeDesktop(userId);
      return { ok: true, ...(await snapshot()), appConnected: connected };
    }

    case "OPEN_APP": {
      const url = `lare://${req.path ?? "open"}`;
      await chrome.tabs.create({ url, active: false }).catch(() => undefined);
      return { ok: true };
    }

    case "START_SESSION":
      return startSession(req);

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
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
async function startSession(
  req: Extract<RuntimeRequest, { type: "START_SESSION" }>,
): Promise<RuntimeResponse> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Sign in to Lare first (click the extension icon)");
  const existing = await loadState();
  if (existing.session) throw new Error("A session is already active");

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

  if (req.kind === "interview") {
    if (!req.problem) throw new Error("Open a LeetCode problem to start a mock interview");
    await desktop.connect(userId, 2000).catch(() => {
      throw new Error("Open the Lare desktop app to start a mock interview");
    });
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
      scope: req.scope,
      startedAt: now,
      problem: req.problem,
      facecam: req.facecam,
      mic: true,
    });
    const state = await desktop.waitFor(
      (m): m is Extract<AppToExt, { type: "recording.state" }> =>
        m.type === "recording.state" && (m.state === "recording" || m.state === "error"),
      30_000,
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
  }

  const session: ActiveSession = {
    sessionId,
    kind: req.kind,
    scope: req.scope,
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

  await withState(async (s) => ({ state: { ...s, session }, result: undefined }));
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });

  // Best-effort remote sync; the session keeps running locally if this fails.
  try {
    await syncSessionStart(session, userId);
    if (tp) await syncProblemOpen(sessionId, tp, req.question);
    await withState(async (s) => {
      if (!s.session || s.session.sessionId !== sessionId) return { state: s, result: undefined };
      const problems = s.session.problems.map((p) => ({ ...p, synced: true }));
      return { state: { ...s, session: { ...s.session, synced: true, problems } }, result: undefined };
    });
  } catch (e) {
    console.warn("[lare] initial sync failed", e);
    await broadcast({ kind: "error", text: "Offline: session will sync when you end it" });
  }

  await refreshBadge();
  await broadcast({
    kind: "success",
    text: req.kind === "interview" ? "Mock interview started. Recording." : "Session started",
  });
  return { ok: true, ...(await snapshot()) };
}

async function pauseOrResume(type: "pause" | "resume"): Promise<RuntimeResponse> {
  const now = Date.now();
  const result = await withState(async (s) => {
    if (!s.session) return { state: s, result: null };
    const status = timerStatus(s.session.events);
    if ((type === "pause" && status !== "running") || (type === "resume" && status !== "paused")) {
      return { state: s, result: null };
    }
    const events = [...s.session.events, { t: now, type }];
    return { state: { ...s, session: { ...s.session, events } }, result: s.session };
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
    if (!s.session) return { state: s, result: null };
    const events = [...s.session.events, { t: now, type: "end" as const }];
    return { state: { ...s, session: { ...s.session, events } }, result: { ...s.session, events } };
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
      state: { ...s, session: null, pendingSync: s.pendingSync.filter((id) => id !== session.sessionId) },
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
  await chrome.alarms.clear(TICK_ALARM);
  await refreshBadge();
  return { ok: true, postId, ...(await snapshot()) };
}

async function problemOpened(
  problem: ProblemInfo,
  question: QuestionDetails | null,
): Promise<RuntimeResponse> {
  const now = Date.now();
  const change = await withState(async (s) => {
    const session = s.session;
    if (!session) return { state: s, result: null };
    if (session.currentSlug === problem.slug) {
      // Same problem: refresh language if we learned it.
      const problems = session.problems.map((p) =>
        p.problem.slug === problem.slug && !p.problem.language && problem.language
          ? { ...p, problem: { ...p.problem, language: problem.language } }
          : p,
      );
      return { state: { ...s, session: { ...session, problems } }, result: null };
    }
    if (session.scope === "problem") {
      // Single-problem sessions ignore navigation to other problems.
      return { state: { ...s, session: { ...session, currentSlug: session.currentSlug } }, result: null };
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
    if (session.currentSlug) events.push({ t: now, type: "problem_close", slug: session.currentSlug });
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
    return { state: { ...s, session: next }, result: { session: next, closed, opened, isNew: !existing } };
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
        await syncTimerEvent(session.sessionId, { t: now, type: "problem_close", slug: closed.problem.slug });
        await syncProblemClose(session, closed, now);
      }
      if (isNew) {
        await syncProblemOpen(session.sessionId, opened, question);
        await withState(async (s) => {
          if (!s.session) return { state: s, result: undefined };
          const problems = s.session.problems.map((p) =>
            p.sessionProblemId === opened.sessionProblemId ? { ...p, synced: true } : p,
          );
          return { state: { ...s, session: { ...s.session, problems } }, result: undefined };
        });
      } else {
        await syncTimerEvent(session.sessionId, { t: now, type: "problem_open", slug: problem.slug });
      }
    })().catch((e) => console.warn("[lare] problem sync failed", e));
    await broadcast();
  }
  return { ok: true, ...(await snapshot()) };
}

async function edits(slug: string, language: string | null, events: EditEvent[]): Promise<RuntimeResponse> {
  if (events.length === 0) return { ok: true };
  const target = await withState(async (s) => {
    const session = s.session;
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
    return { state: { ...s, session: { ...session, problems } }, result: { session, tp } };
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

async function submission(slug: string, sub: CapturedSubmission): Promise<RuntimeResponse> {
  const target = await withState(async (s) => {
    const session = s.session;
    if (!session) return { state: s, result: null };
    const tp = session.problems.find((p) => p.problem.slug === slug);
    if (!tp) return { state: s, result: null };
    const { runtimeDistribution: _r, memoryDistribution: _m, ...lite } = sub;
    const problems = session.problems.map((p) =>
      p.sessionProblemId === tp.sessionProblemId
        ? { ...p, submissions: [...p.submissions.slice(-19), lite] }
        : p,
    );
    return { state: { ...s, session: { ...session, problems } }, result: { session, tp } };
  });
  if (!target) return { ok: true };
  if (target.session.kind === "interview") {
    const { runtimeDistribution: _r, memoryDistribution: _m, langVerbose: _l, runtimeDisplay: _rd, memoryDisplay: _md, ...info } = sub;
    desktop.send({
      type: "submission",
      sessionId: target.session.sessionId,
      sessionProblemId: target.tp.sessionProblemId,
      submission: info,
    });
  }
  syncSubmission(target.tp, sub).catch((e) => console.warn("[lare] submission sync failed", e));
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
    await desktop.connect(userId, 1500);
    const state = await loadState();
    if (state.session?.kind !== "interview") {
      // Don't hold a socket open when nothing needs it.
      setTimeout(() => {
        void loadState().then((s) => {
          if (s.session?.kind !== "interview") desktop.close();
        });
      }, 5000);
    }
    return true;
  } catch {
    return false;
  }
}

async function onDesktopMessage(msg: AppToExt): Promise<void> {
  if (msg.type === "recording.state" && msg.state === "error") {
    await broadcast({ kind: "error", text: msg.message ?? "Recording error in the desktop app" });
  }
}

async function resumeAfterRestart(): Promise<void> {
  const state = await loadState();
  if (state.session) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
    if (state.session.kind === "interview") {
      const userId = await currentUserId();
      desktop.connect(userId, 2000).catch(() => undefined);
    }
  }
  await refreshBadge();
}

// ---------------------------------------------------------------------------
// Snapshot / broadcast / badge
// ---------------------------------------------------------------------------
async function snapshot(): Promise<RuntimeSnapshot> {
  const [state, auth] = await Promise.all([loadState(), getAuthInfo().catch(() => null)]);
  return { state: { ...state, appConnected: desktop.connected }, auth, appConnected: desktop.connected };
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
  const session = state.session;
  if (!session) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  const status = timerStatus(session.events);
  const minutes = Math.floor(activeMs(session.events, Date.now()) / 60_000);
  await chrome.action.setBadgeBackgroundColor({
    color: status === "paused" ? "#a16207" : session.kind === "interview" ? "#dc2626" : "#16a34a",
  });
  await chrome.action.setBadgeText({ text: status === "paused" ? "II" : `${minutes}m` });
}
