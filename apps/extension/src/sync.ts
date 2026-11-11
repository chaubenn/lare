/**
 * Supabase writes. All functions are idempotent where possible (upserts keyed by
 * client-generated uuids) so retries after a service-worker restart never
 * duplicate rows.
 *
 * Two groups: passive practice tracking (the inbox) and mock interviews, which
 * are still explicit timed sessions.
 */
import {
  type ActiveSession,
  activeMs,
  type EditLog,
  type ProblemInfo,
  problemActiveMs,
  type TimerEvent,
  type TrackedProblem,
} from "@lare/shared";
import { deleteSessionEvents, readEvents } from "./editsDb";
import { type CapturedSubmission, type QuestionDetails, sendToTab } from "./messages";
import { CLIENT_TAG, getSupabase } from "./supabase";

const iso = (ms: number) => new Date(ms).toISOString();

/** The `session_problems` columns that describe the problem itself, for inbox and interview rows. */
function problemRow(
  id: string,
  sessionId: string,
  problem: ProblemInfo,
  question: QuestionDetails | null,
  openedAt: number,
) {
  return {
    id,
    session_id: sessionId,
    slug: problem.slug,
    frontend_id: problem.frontendId,
    title: problem.title,
    difficulty: problem.difficulty,
    url: problem.url,
    description_html: question?.descriptionHtml ?? null,
    topic_tags: question?.topicTags ?? [],
    opened_at: iso(openedAt),
  };
}

// ---------------------------------------------------------------------------
// Passive practice tracking
// ---------------------------------------------------------------------------

/**
 * The caller's inbox session id, created server-side on first use.
 *
 * Must be its own round trip: the id cannot be inlined into the
 * `session_problems` insert below, because the `owns_session` RLS check is
 * STABLE and would not see an inbox created within that same statement.
 */
export async function resolveInboxSession(): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("practice_inbox");
  if (error) throw new Error(`practice_inbox: ${error.message}`);
  if (!data) throw new Error("practice_inbox returned no id");
  return data;
}

/**
 * Record a problem against the inbox. Keyed by the client-generated id, so
 * re-opening the same problem updates one row instead of adding another.
 *
 * `active_ms` stays 0: passive tracking has no timer, so there is no honest
 * duration to report and the renderers hide a zero.
 */
export async function trackInboxProblem(
  inboxSessionId: string,
  sessionProblemId: string,
  problem: ProblemInfo,
  question: QuestionDetails | null,
  seenAt: number,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("session_problems")
    .upsert(
      { ...problemRow(sessionProblemId, inboxSessionId, problem, question, seenAt), active_ms: 0 },
      { onConflict: "id" },
    );
  if (error) throw new Error(`session_problems upsert: ${error.message}`);
}

/**
 * Ids of the problems still on the inbox. Publishing moves rows off it and the
 * desktop app's "Clear all" deletes them, so anything missing has been handled.
 */
export async function listInboxProblemIds(inboxSessionId: string): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("session_problems")
    .select("id")
    .eq("session_id", inboxSessionId);
  if (error) throw new Error(`session_problems list: ${error.message}`);
  return new Set(data.map((row) => row.id));
}

/** Drop tracked problems from the inbox without posting them. */
export async function deleteInboxProblems(
  inboxSessionId: string,
  sessionProblemIds: string[],
): Promise<void> {
  if (sessionProblemIds.length === 0) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("session_problems")
    .delete()
    .eq("session_id", inboxSessionId)
    .in("id", sessionProblemIds);
  if (error) throw new Error(`session_problems delete: ${error.message}`);
}

/** Publish a chosen set of tracked problems as one draft post. Returns the post id. */
export async function publishInboxProblems(
  sessionProblemIds: string[],
  title: string | null,
): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("publish_practice_problems", {
    problem_ids: sessionProblemIds,
    post_title: title,
  });
  if (error) throw new Error(`publish_practice_problems: ${error.message}`);
  if (!data) throw new Error("publish_practice_problems returned no post id");
  return data;
}

// ---------------------------------------------------------------------------
// Mock interviews
// ---------------------------------------------------------------------------

export async function syncSessionStart(
  session: ActiveSession,
  userId: string,
  graded: boolean,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("sessions").upsert(
    {
      id: session.sessionId,
      user_id: userId,
      kind: session.kind,
      scope: session.scope,
      status: "active",
      started_at: iso(session.startedAt),
      client: CLIENT_TAG,
      graded,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`sessions upsert: ${error.message}`);
  await syncTimerEvent(session.sessionId, { t: session.startedAt, type: "start" });
}

export async function syncTimerEvent(sessionId: string, event: TimerEvent): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("session_events").insert({
    session_id: sessionId,
    t: iso(event.t),
    type: event.type,
    payload: event.slug ? { slug: event.slug } : {},
  });
  if (error) throw new Error(`session_events insert: ${error.message}`);
  if (event.type === "pause" || event.type === "resume") {
    const { error: statusError } = await supabase
      .from("sessions")
      .update({ status: event.type === "pause" ? "paused" : "active" })
      .eq("id", sessionId);
    // The event row above is what the timer is computed from; the status column only mirrors it.
    if (statusError) console.warn("[lare] session status update failed", statusError);
  }
}

export async function syncProblemOpen(
  sessionId: string,
  tp: TrackedProblem,
  question: QuestionDetails | null,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("session_problems")
    .upsert(problemRow(tp.sessionProblemId, sessionId, tp.problem, question, tp.openedAt), {
      onConflict: "id",
    });
  if (error) throw new Error(`session_problems upsert: ${error.message}`);
  await syncTimerEvent(sessionId, { t: tp.openedAt, type: "problem_open", slug: tp.problem.slug });
}

export async function syncProblemClose(
  session: ActiveSession,
  tp: TrackedProblem,
  closedAt: number,
): Promise<void> {
  const supabase = getSupabase();
  const active = problemActiveMs(session.events, tp.problem.slug, closedAt);
  const { error } = await supabase
    .from("session_problems")
    .update({ closed_at: iso(closedAt), active_ms: active })
    .eq("id", tp.sessionProblemId);
  if (error) throw new Error(`session_problems close: ${error.message}`);
}

export async function syncSubmission(
  sessionProblemId: string,
  s: CapturedSubmission,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("submissions").upsert(
    {
      session_problem_id: sessionProblemId,
      leetcode_submission_id: s.leetcodeSubmissionId,
      submitted_at: iso(s.submittedAt),
      lang: s.lang,
      lang_verbose: s.langVerbose,
      code: s.code,
      status_display: s.statusDisplay,
      status_code: s.statusCode,
      accepted: s.accepted,
      runtime_ms: s.runtimeMs === null ? null : Math.round(s.runtimeMs),
      runtime_display: s.runtimeDisplay,
      runtime_percentile: s.runtimePercentile,
      memory_mb: s.memoryMb,
      memory_display: s.memoryDisplay,
      memory_percentile: s.memoryPercentile,
      runtime_distribution: s.runtimeDistribution,
      memory_distribution: s.memoryDistribution,
      total_correct: s.totalCorrect,
      total_testcases: s.totalTestcases,
    },
    { onConflict: "session_problem_id,leetcode_submission_id", ignoreDuplicates: false },
  );
  if (error) throw new Error(`submissions upsert: ${error.message}`);
}

async function gzipJson(value: unknown): Promise<Blob> {
  const json = JSON.stringify(value);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

/**
 * Persist the code timeline and session duration before desktop requests AI review.
 */
async function syncSessionEnd(
  session: ActiveSession,
  userId: string,
  endedAt: number,
): Promise<void> {
  if (session.tabId !== null) await sendToTab(session.tabId, { type: "LARE_FLUSH_EDITS" });
  const supabase = getSupabase();
  const total = activeMs(session.events, endedAt);

  for (const tp of session.problems) {
    const { language, events } = await readEvents(session.sessionId, tp.sessionProblemId);
    let editsPath: string | null = null;
    if (events.length > 0) {
      const log: EditLog = {
        version: 1,
        slug: tp.problem.slug,
        language: language ?? tp.problem.language ?? undefined,
        events,
      };
      const blob = await gzipJson(log);
      editsPath = `${userId}/${session.sessionId}/${tp.sessionProblemId}.json.gz`;
      const { error } = await supabase.storage
        .from("session-data")
        .upload(editsPath, blob, { contentType: "application/gzip", upsert: true });
      if (error) throw new Error(`edits upload: ${error.message}`);
    }
    const closedAt = tp.closedAt ?? endedAt;
    const { error } = await supabase
      .from("session_problems")
      .update({
        closed_at: iso(closedAt),
        active_ms: problemActiveMs(session.events, tp.problem.slug, closedAt),
        ...(editsPath ? { edits_path: editsPath } : {}),
      })
      .eq("id", tp.sessionProblemId);
    if (error) throw new Error(`session_problems finalize: ${error.message}`);
  }

  const { error: sessErr } = await supabase
    .from("sessions")
    .update({
      status: "ended",
      ended_at: iso(endedAt),
      active_ms: total,
    })
    .eq("id", session.sessionId);
  if (sessErr) throw new Error(`sessions end: ${sessErr.message}`);
}

/**
 * Close a session row that will get no draft: a start that failed, a discarded interview, an
 * unsaved one given up on. `ungraded` also clears `graded`, so the desktop pipeline does not wait
 * to transcribe a recording that is not coming. Best effort: a failure is logged, not thrown.
 */
export async function closeSession(
  sessionId: string,
  endedAt: number,
  ungraded: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from("sessions")
    .update({ status: "ended", ended_at: iso(endedAt), ...(ungraded ? { graded: false } : {}) })
    .eq("id", sessionId);
  if (error) console.warn("[lare] close session", error);
}

export async function finalizeSession(
  session: ActiveSession,
  userId: string,
  endedAt: number,
): Promise<string> {
  await syncSessionEnd(session, userId, endedAt);
  const supabase = getSupabase();

  const first = session.problems[0];
  const title =
    session.problems.length === 1 && first
      ? first.problem.title
      : session.problems.length > 1
        ? `${session.problems.length} problems`
        : session.kind === "interview"
          ? "Mock interview"
          : "Practice session";

  // Insert only: a retry after the post already exists must leave it alone, since the author may
  // have published it and the desktop app attaches the interview video to the row when its upload
  // lands. `status` is left to the column default (draft); only publishing and `unpublish_post`
  // change it.
  const { error: insertErr } = await supabase.from("posts").upsert(
    {
      user_id: userId,
      session_id: session.sessionId,
      visibility: "public",
      title,
      include_ai_insights: false,
    },
    { onConflict: "session_id", ignoreDuplicates: true },
  );
  if (insertErr) throw new Error(`posts upsert: ${insertErr.message}`);
  // An ignored duplicate returns no row, so read the id back separately.
  const { data: post, error: postErr } = await supabase
    .from("posts")
    .select("id")
    .eq("session_id", session.sessionId)
    .single();
  if (postErr || !post) throw new Error(`posts select: ${postErr?.message ?? "no row"}`);

  await deleteSessionEvents(session.sessionId);
  return post.id;
}
