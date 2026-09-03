// POST { sessionId, force?: boolean } -> interview review (also upserted into interview_reviews).
// Builds a timeline from the whisper transcript, Monaco edit checkpoints and LeetCode
// submissions, then asks OpenAI (Responses API, strict JSON schema) for a graded debrief.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AI_REVIEW_SCHEMA_NAME, type AiReview, aiReviewJsonSchema } from "../_shared/aiReviewSchema.ts";
import { type EditLog, checkpoints, gunzipJson, lineDiff } from "../_shared/edits.ts";
import { HttpError, env, envOptional, handler, json, readJson } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

const DAILY_LIMIT = 5;
const MAX_INPUT_CHARS = 60_000;

interface Segment {
  s: number;
  e: number;
  text: string;
}

interface TimelineItem {
  t: number; // ms relative to recording start
  text: string;
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function stripHtml(html: string | null | undefined, max = 1500): string {
  if (!html) return "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
    const { id: userId } = await requireUser(req);
    const body = await readJson<{ sessionId?: string; force?: boolean }>(req);
    if (!body.sessionId) throw new HttpError("sessionId required");

    const admin = adminClient();
    const { data: session } = await admin
      .from("sessions")
      .select("id, user_id, kind, started_at, ended_at, active_ms, recording_started_at")
      .eq("id", body.sessionId)
      .maybeSingle();
    if (!session || session.user_id !== userId) throw new HttpError("Session not found", 404);

    // Return the cached review unless a regeneration is requested.
    if (!body.force) {
      const { data: existing } = await admin
        .from("interview_reviews")
        .select("*")
        .eq("session_id", session.id)
        .maybeSingle();
      if (existing) return json({ review: existing, cached: true });
    }

    // Rate limit: N reviews per rolling 24h per user.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin
      .from("interview_reviews")
      .select("id, sessions!inner(user_id)", { count: "exact", head: true })
      .eq("sessions.user_id", userId)
      .gte("created_at", since);
    if ((count ?? 0) >= DAILY_LIMIT) {
      throw new HttpError(`Review limit reached (${DAILY_LIMIT} per day). Try again later.`, 429);
    }

    const t0 = session.recording_started_at
      ? new Date(session.recording_started_at).getTime()
      : new Date(session.started_at).getTime();

    const [{ data: problems }, { data: transcript }] = await Promise.all([
      admin
        .from("session_problems")
        .select("id, slug, title, difficulty, description_html, edits_path, opened_at, submissions(*)")
        .eq("session_id", session.id)
        .order("opened_at"),
      admin.from("transcripts").select("segments, language").eq("session_id", session.id).maybeSingle(),
    ]);

    const segments = ((transcript?.segments as Segment[] | null) ?? []).filter((s) => s.text?.trim());
    const timeline: TimelineItem[] = segments.map((s) => ({ t: s.s, text: `[${mmss(s.s)}] SAID: ${s.text.trim()}` }));

    let finalCode = "";
    let finalLang = "";
    const problemBlocks: string[] = [];
    for (const p of problems ?? []) {
      problemBlocks.push(
        `PROBLEM: ${p.title} (${p.difficulty ?? "unknown"}) https://leetcode.com/problems/${p.slug}/\n${stripHtml(p.description_html)}`,
      );
      if (p.edits_path) {
        const { data: blob } = await admin.storage.from("session-data").download(p.edits_path);
        if (blob) {
          const log = await gunzipJson<EditLog>(new Uint8Array(await blob.arrayBuffer()));
          finalLang = log.language ?? finalLang;
          const cps = checkpoints(log.events, 20_000);
          let prev = "";
          for (const cp of cps) {
            const { added, removed } = lineDiff(prev, cp.code);
            const rel = cp.t - t0;
            const diffText = [
              ...removed.slice(0, 40).map((l) => `- ${l}`),
              ...added.slice(0, 60).map((l) => `+ ${l}`),
            ].join("\n");
            timeline.push({ t: rel, text: `[${mmss(rel)}] CODE CHECKPOINT (${p.slug}) diff vs previous:\n${diffText || "(no line changes)"}` });
            prev = cp.code;
          }
          finalCode = prev || finalCode;
        }
      }
      type Sub = {
        submitted_at: string;
        accepted: boolean;
        status_display: string | null;
        runtime_ms: number | null;
        runtime_percentile: number | null;
        memory_mb: number | null;
        memory_percentile: number | null;
        total_correct: number | null;
        total_testcases: number | null;
        code: string | null;
        lang: string | null;
      };
      for (const s of (p.submissions as Sub[] | null) ?? []) {
        const rel = new Date(s.submitted_at).getTime() - t0;
        const stats = s.accepted
          ? `runtime ${s.runtime_ms ?? "?"} ms (beats ${s.runtime_percentile?.toFixed(2) ?? "?"}%), memory ${s.memory_mb ?? "?"} MB (beats ${s.memory_percentile?.toFixed(2) ?? "?"}%)`
          : `${s.total_correct ?? "?"}/${s.total_testcases ?? "?"} testcases passed`;
        timeline.push({ t: rel, text: `[${mmss(rel)}] SUBMITTED (${p.slug}): ${s.status_display ?? (s.accepted ? "Accepted" : "Rejected")} — ${stats}` });
        if (s.code && s.accepted) {
          finalCode = s.code;
          finalLang = s.lang ?? finalLang;
        }
      }
    }
    timeline.sort((a, b) => a.t - b.t);

    let timelineText = timeline.map((i) => i.text).join("\n");
    if (timelineText.length > MAX_INPUT_CHARS) {
      timelineText = `${timelineText.slice(0, MAX_INPUT_CHARS)}\n…(timeline truncated)`;
    }
    const durationMs = session.active_ms || (session.ended_at ? new Date(session.ended_at).getTime() - t0 : 0);

    const system = [
      "You are a senior software engineer running the debrief of a mock coding interview.",
      "You receive the problem statement, a timestamped timeline of what the candidate said (speech transcript),",
      "code checkpoints (line diffs captured from their editor at natural pauses) and their LeetCode submissions.",
      "Grade fairly and specifically. Anchor every moment on a timestamp from the timeline (t_ms = seconds*1000)",
      "and quote the transcript or code verbatim (short). Prefer 6-14 moments spread across the session, mixing",
      "good moments, issues and concrete suggestions. code_iterations should describe each distinct approach",
      "(e.g. brute force -> hash map) with its complexity. If there is no transcript, score communication 0 and",
      "say why in the rationale. Scores are 0-100. Speed considers total active time versus difficulty.",
      "Correctness reflects submissions (accepted, attempts, testcases). Keep the summary to 3-5 sentences.",
      "Never invent events that are not in the timeline.",
    ].join(" ");

    const user = [
      `SESSION: kind=${session.kind}, active time ${mmss(durationMs)}, transcript segments: ${segments.length}, language: ${finalLang || "unknown"}`,
      "",
      ...problemBlocks,
      "",
      "TIMELINE:",
      timelineText || "(empty)",
      "",
      "FINAL CODE:",
      finalCode ? finalCode.slice(0, 8000) : "(no code captured)",
    ].join("\n");

    const model = envOptional("OPENAI_MODEL") ?? "gpt-5-mini";
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${env("OPENAI_API_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        text: { format: { type: "json_schema", name: AI_REVIEW_SCHEMA_NAME, strict: true, schema: aiReviewJsonSchema } },
        reasoning: { effort: "medium" },
        max_output_tokens: 6000,
      }),
    });
    if (!res.ok) throw new HttpError(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 500)}`, 502);
    const out = (await res.json()) as {
      status?: string;
      output?: { type: string; content?: { type: string; text?: string }[] }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const message = out.output?.find((o) => o.type === "message");
    const text = message?.content?.find((c) => c.type === "output_text")?.text;
    if (!text) throw new HttpError(`OpenAI returned no output (status ${out.status ?? "?"})`, 502);
    const review = JSON.parse(text) as AiReview;
    // Clamp timestamps into the session.
    const clamp = (t: number) => Math.max(0, Math.min(Math.round(t), Math.max(durationMs, 0) || Number.MAX_SAFE_INTEGER));
    review.moments = review.moments.map((m) => ({ ...m, t_ms: clamp(m.t_ms) })).sort((a, b) => a.t_ms - b.t_ms);
    review.code_iterations = review.code_iterations.map((c) => ({ ...c, t_ms: clamp(c.t_ms) }));

    const row = {
      session_id: session.id,
      model,
      overall: review.overall,
      scores: review.scores,
      summary: review.summary,
      moments: review.moments,
      code_iterations: review.code_iterations,
      next_steps: review.next_steps,
      tokens_in: out.usage?.input_tokens ?? null,
      tokens_out: out.usage?.output_tokens ?? null,
      created_at: new Date().toISOString(),
    };
    const { data: saved, error } = await admin
      .from("interview_reviews")
      .upsert(row, { onConflict: "session_id" })
      .select("*")
      .single();
    if (error) throw new HttpError(`interview_reviews upsert failed: ${error.message}`, 500);
    return json({ review: saved, cached: false });
  }),
);
