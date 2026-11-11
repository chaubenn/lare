/**
 * Passive practice tracking: the problems seen and the submissions captured on them, kept in the
 * cloud inbox. Works without the desktop app.
 */
import { type InboxProblem, type ProblemInfo, problemUrl } from "@lare/shared";
import type { CapturedSubmission, QuestionDetails, RuntimeResponse } from "./messages";
import { enqueueSubmission, loadSubmissionQueue, removeQueuedSubmission } from "./queues";
import { broadcast, refreshBadge, snapshot } from "./snapshot";
import { loadState, withState } from "./storage";
import { currentUserId } from "./supabase";
import {
  deleteInboxProblems,
  listInboxProblemIds,
  publishInboxProblems,
  resolveInboxSession,
  syncSubmission,
  trackInboxProblem,
} from "./sync";
import { singleFlight, titleFromSlug } from "./util";

/**
 * In-flight `session_problems` upserts, keyed by slug. `submissions` has a
 * foreign key onto that row, so a submission captured moments after the problem
 * was first seen has to wait for the row to land.
 */
const pendingTrack = new Map<string, Promise<void>>();

function rewriteTracked(rewrite: (problems: InboxProblem[]) => InboxProblem[]): Promise<void> {
  return withState(async (s) => ({
    state: { ...s, tracking: { ...s.tracking, problems: rewrite(s.tracking.problems) } },
    result: undefined,
  }));
}

/** Turn synced inbox problems into one draft post, and stop tracking them here. */
export async function publishTracked(ids: string[]): Promise<RuntimeResponse> {
  const state = await loadState();
  if (
    !ids.every((id) => state.tracking.problems.some((p) => p.sessionProblemId === id && p.synced))
  )
    throw new Error("Select synced inbox problems");
  const postId = await publishInboxProblems(ids, null);
  await rewriteTracked((problems) => problems.filter((p) => !ids.includes(p.sessionProblemId)));
  await refreshBadge();
  await broadcast();
  return { ok: true, postId, ...(await snapshot()) };
}

/** Stop tracking problems without posting them (every one when `only` is omitted). */
export async function clearTracked(only?: string[]): Promise<RuntimeResponse> {
  const state = await loadState();
  const ids = new Set(only ?? state.tracking.problems.map((p) => p.sessionProblemId));
  const synced = state.tracking.problems
    .filter((p) => p.synced && ids.has(p.sessionProblemId))
    .map((p) => p.sessionProblemId);
  if (synced.length > 0) {
    const inboxSessionId = state.tracking.inboxSessionId;
    if (!inboxSessionId) throw new Error("Practice inbox unavailable; try again");
    await deleteInboxProblems(inboxSessionId, synced);
  }
  await rewriteTracked((problems) => problems.filter((p) => !ids.has(p.sessionProblemId)));
  await refreshBadge();
  await broadcast();
  return { ok: true, ...(await snapshot()) };
}

/**
 * Passive capture: remember the problem against the inbox so a later submission
 * has a row to attach to, and record that it was solved even if the user never
 * publishes it. Runs on every problem page; a signed-out user is skipped, as
 * there is nowhere to write.
 */
export async function trackProblem(
  problem: ProblemInfo,
  question: QuestionDetails | null,
): Promise<void> {
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
      await rewriteTracked((problems) =>
        problems.map((p) =>
          p.sessionProblemId === target.entry.sessionProblemId ? { ...p, synced: true } : p,
        ),
      );
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
 * Make sure a submission's problem has a local entry. One first opened offline or signed out, or
 * tracked and since posted, has none: track it now so the tally has somewhere to go and the save
 * has a row.
 */
export async function ensureTracked(
  slug: string,
  problem: ProblemInfo | null,
  question: QuestionDetails | null,
  sub: CapturedSubmission,
): Promise<void> {
  await pendingTrack.get(slug)?.catch(() => undefined);
  if (!(await loadState()).tracking.problems.some((p) => p.slug === slug))
    await trackProblem(problem ?? fallbackProblem(slug, null, sub), question);
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
export async function reconcileTracked(): Promise<void> {
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

/** The inbox session id, looked up once and then kept in the persisted state. */
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

export type SaveOutcome = "saved" | "queued" | "signed-out";

/** A stand-in when the page did not say which problem it is (older content scripts). */
function fallbackProblem(slug: string, title: string | null, sub: CapturedSubmission): ProblemInfo {
  return {
    slug,
    frontendId: null,
    title: title || titleFromSlug(slug),
    difficulty: null,
    url: problemUrl(slug),
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
export async function savePracticeSubmission(
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

/** Save queued submissions for the signed-in user, oldest first. */
export const flushSubmissionQueue = singleFlight(() =>
  runFlushSubmissionQueue().catch((e) => console.warn("[lare] flush submissions", e)),
);

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
