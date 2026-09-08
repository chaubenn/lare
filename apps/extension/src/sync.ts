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
import type { CapturedSubmission, QuestionDetails } from "./messages";
import { getSupabase } from "./supabase";

const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Passive practice tracking
// ---------------------------------------------------------------------------

/**
 * The caller's inbox session id, created server-side on first use.
 *
 * Must be its own round trip — the id cannot be inlined into the
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
  const { error } = await supabase.from("session_problems").upsert(
    {
      id: sessionProblemId,
      session_id: inboxSessionId,
      slug: problem.slug,
      frontend_id: problem.frontendId,
      title: problem.title,
      difficulty: problem.difficulty,
      url: problem.url,
      description_html: question?.descriptionHtml ?? null,
      topic_tags: question?.topicTags ?? [],
      opened_at: iso(seenAt),
      active_ms: 0,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`session_problems upsert: ${error.message}`);
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

export async function syncSessionStart(session: ActiveSession, userId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("sessions").upsert(
    {
      id: session.sessionId,
      user_id: userId,
      kind: session.kind,
      scope: session.scope,
      status: "active",
      started_at: iso(session.startedAt),
      client: `extension/${__EXT_VERSION__}`,
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
    await supabase
      .from("sessions")
      .update({ status: event.type === "pause" ? "paused" : "active" })
      .eq("id", sessionId);
  }
}

export async function syncProblemOpen(
  sessionId: string,
  tp: TrackedProblem,
  question: QuestionDetails | null,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("session_problems").upsert(
    {
      id: tp.sessionProblemId,
      session_id: sessionId,
      slug: tp.problem.slug,
      frontend_id: tp.problem.frontendId,
      title: tp.problem.title,
      difficulty: tp.problem.difficulty,
      url: tp.problem.url,
      description_html: question?.descriptionHtml ?? null,
      topic_tags: question?.topicTags ?? [],
      opened_at: iso(tp.openedAt),
    },
    { onConflict: "id" },
  );
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
 * End of session: upload edit logs, close problems, mark the session ended and
 * create the draft post. Returns the draft post id.
 */
export async function finalizeSession(
  session: ActiveSession,
  userId: string,
  endedAt: number,
): Promise<string> {
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
        edits_path: editsPath,
      })
      .eq("id", tp.sessionProblemId);
    if (error) throw new Error(`session_problems finalize: ${error.message}`);
  }

  const { error: sessErr } = await supabase
    .from("sessions")
    .update({ status: "ended", ended_at: iso(endedAt), active_ms: total })
    .eq("id", session.sessionId);
  if (sessErr) throw new Error(`sessions end: ${sessErr.message}`);

  const first = session.problems[0];
  const title =
    session.problems.length === 1 && first
      ? first.problem.title
      : session.problems.length > 1
        ? `${session.problems.length} problems`
        : session.kind === "interview"
          ? "Mock interview"
          : "Practice session";

  const { data: post, error: postErr } = await supabase
    .from("posts")
    .upsert(
      {
        user_id: userId,
        session_id: session.sessionId,
        status: "draft",
        visibility: "public",
        title,
        video_kind: "none",
        include_ai_insights: false,
      },
      { onConflict: "session_id" },
    )
    .select("id")
    .single();
  if (postErr || !post) throw new Error(`posts upsert: ${postErr?.message ?? "no row"}`);

  await deleteSessionEvents(session.sessionId);
  return post.id;
}
