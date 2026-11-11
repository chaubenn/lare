/**
 * What a LeetCode tab reports (a problem opened, edits, a submission), applied to the practice
 * inbox and, when the tab is the one being recorded, to the live interview.
 */
import type {
  ActiveSession,
  EditEvent,
  InboxProblem,
  ProblemInfo,
  TrackedProblem,
} from "@lare/shared";
import { appendEvents } from "./editsDb";
import { interviewForTab } from "./interview";
import type {
  CapturedSubmission,
  QuestionDetails,
  RuntimeResponse,
  StateBroadcast,
} from "./messages";
import { ensureTracked, type SaveOutcome, savePracticeSubmission, trackProblem } from "./practice";
import { enqueueSubmission } from "./queues";
import { broadcast, refreshBadge, snapshot } from "./snapshot";
import { withState } from "./storage";
import { currentUserId } from "./supabase";
import { syncProblemClose, syncProblemOpen, syncSubmission, syncTimerEvent } from "./sync";

/** Submissions kept on an interview problem in local state; the full history is in Supabase. */
const MAX_LOCAL_SUBMISSIONS = 20;

export async function problemOpened(
  problem: ProblemInfo,
  question: QuestionDetails | null,
  sourceTabId?: number,
): Promise<RuntimeResponse> {
  // Passive tracking always runs; the interview bookkeeping below only applies
  // while one is live.
  await trackProblem(problem, question);
  const now = Date.now();
  const change = await withState(async (s) => {
    const session = interviewForTab(s, sourceTabId);
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

export async function edits(
  slug: string,
  language: string | null,
  events: EditEvent[],
  sourceTabId?: number,
): Promise<RuntimeResponse> {
  if (events.length === 0) return { ok: true };
  const target = await withState(async (s) => {
    const session = interviewForTab(s, sourceTabId);
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
  return { ok: true };
}

/**
 * Every submission is captured, interview or not. It always counts towards the inbox problem's
 * tally; during an interview it is also kept on the interview's own problem, and saved against
 * that row instead of the inbox one.
 */
export async function submission(
  slug: string,
  sub: CapturedSubmission,
  problem: ProblemInfo | null,
  question: QuestionDetails | null,
  sourceTabId?: number,
): Promise<RuntimeResponse> {
  await ensureTracked(slug, problem, question, sub);

  type Target = {
    session: ActiveSession | null;
    tp: TrackedProblem | null;
    tracked: InboxProblem | null;
  };
  const target = await withState<Target>(async (s) => {
    const session = interviewForTab(s, sourceTabId);
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
        ? { ...p, submissions: [...p.submissions.slice(1 - MAX_LOCAL_SUBMISSIONS), lite] }
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
