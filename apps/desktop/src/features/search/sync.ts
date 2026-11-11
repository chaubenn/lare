/**
 * Keeps the palette's search index in step with Supabase for the signed-in user.
 *
 * Sessions, posts and people are small, so every sync sends them whole and the index drops what
 * is no longer there. Transcripts and AI reviews are large and written once, so only the ones
 * newer than the index's watermark are fetched. The docs also stay in memory for the palette's
 * fallback search when the index cannot run here.
 */

import {
  personSearchDoc,
  postSearchDoc,
  reviewSearchDoc,
  type SearchDoc,
  type SearchKind,
  sessionSearchDoc,
  sessionSearchTitle,
  TopicTagSchema,
  transcriptSearchDoc,
} from "@lare/shared";
import { useEffect } from "react";
import { z } from "zod";
import { useUser } from "@/features/auth/AuthProvider";
import { parseTranscriptSegments } from "@/features/sessions/media";
import { type SearchSyncState, searchIndex, searchOpen } from "@/lib/search";
import { supabase } from "@/lib/supabase";

const PAGE = 500;
/** Transcripts are big rows; fetch fewer at a time. */
const SAID_PAGE = 50;
const RESYNC_MS = 10 * 60_000;
/** Opening the palette resyncs, but not more often than this. */
const MIN_RESYNC_MS = 60_000;
const WHOLE_KINDS: SearchKind[] = ["session", "post", "draft", "person"];

const TagsSchema = z.array(TopicTagSchema).catch([]);
const MomentsSchema = z.array(z.object({ quote: z.string(), comment: z.string() })).catch([]);
const NextStepsSchema = z.array(z.string()).catch([]);

let fallbackDocs: SearchDoc[] = [];
let lastSync = 0;
let running: Promise<void> | null = null;
let currentUser: string | null = null;

/** The docs from the last sync, for searching without the index. */
export function searchFallbackDocs(): readonly SearchDoc[] {
  return fallbackDocs;
}

/** Syncs now unless one ran within the last minute (the palette calls this as it opens). */
export function requestSearchSync(): void {
  if (currentUser && Date.now() - lastSync > MIN_RESYNC_MS) void syncSearch(currentUser);
}

/** Mounted once in the app shell: syncs on sign-in and every ten minutes after. */
export function useSearchSync(): void {
  const { userId } = useUser();
  useEffect(() => {
    currentUser = userId;
    fallbackDocs = [];
    lastSync = 0;
    void syncSearch(userId);
    const timer = window.setInterval(() => void syncSearch(userId), RESYNC_MS);
    return () => {
      window.clearInterval(timer);
      if (currentUser === userId) currentUser = null;
    };
  }, [userId]);
}

function syncSearch(userId: string): Promise<void> {
  running ??= runSync(userId)
    .catch((error: unknown) => console.warn("search sync failed", error))
    .finally(() => {
      running = null;
    });
  return running;
}

async function runSync(userId: string): Promise<void> {
  lastSync = Date.now();
  // A machine that cannot run the index still gets the fallback docs.
  const opened = await searchOpen(userId).catch((error: unknown) => {
    console.info("search index unavailable, using the fallback", error);
    return null;
  });
  const [sessions, posts, people] = await Promise.all([
    fetchSessions(userId),
    fetchPosts(userId),
    fetchPeople(userId),
  ]);
  const titles = new Map(sessions.map((s) => [s.id, sessionSearchTitle(s)]));
  const whole = [
    ...sessions.map(sessionSearchDoc),
    ...posts.map(postSearchDoc),
    ...people.map(personSearchDoc),
  ];
  if (currentUser !== userId) return;
  fallbackDocs = [...whole, ...fallbackDocs.filter((d) => d.kind === "said")];

  // The fallback has no watermark to trust, so it fetches all said docs once per sign-in.
  const since: SearchSyncState = opened ?? { transcriptsSince: null, reviewsSince: null };
  if (!opened && fallbackDocs.some((d) => d.kind === "said")) {
    return;
  }
  const [transcripts, reviews] = await Promise.all([
    fetchTranscripts(userId, since.transcriptsSince, titles),
    fetchReviews(userId, since.reviewsSince, titles),
  ]);
  if (currentUser !== userId) return;
  const said = [...transcripts.docs, ...reviews.docs];
  const saidIds = new Set(said.map((d) => d.id));
  fallbackDocs = [
    ...whole,
    ...fallbackDocs.filter((d) => d.kind === "said" && !saidIds.has(d.id)),
    ...said,
  ];
  if (!opened) return;
  await searchIndex([...whole, ...said], WHOLE_KINDS, {
    transcriptsSince: transcripts.since ?? since.transcriptsSince,
    reviewsSince: reviews.since ?? since.reviewsSince,
  });
}

/** Every row of a paged query, `size` at a time. */
async function fetchAll<T>(
  size: number,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

async function fetchSessions(userId: string) {
  const rows = await fetchAll(PAGE, (from, to) =>
    supabase
      .from("sessions")
      .select(
        "id, kind, started_at, session_problems(title, slug, frontend_id, difficulty, topic_tags, submissions(lang, status_display, accepted))",
      )
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .range(from, to),
  );
  return rows.map((s) => ({
    id: s.id,
    kind: s.kind,
    startedAt: s.started_at,
    problems: s.session_problems.map((p) => ({
      title: p.title,
      slug: p.slug,
      frontendId: p.frontend_id,
      difficulty: p.difficulty,
      tags: TagsSchema.parse(p.topic_tags),
      submissions: p.submissions.map((sub) => ({
        lang: sub.lang,
        status: sub.status_display,
        accepted: sub.accepted,
      })),
    })),
  }));
}

async function fetchPosts(userId: string) {
  const rows = await fetchAll(PAGE, (from, to) =>
    supabase
      .from("posts")
      .select("id, status, title, body, published_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .range(from, to),
  );
  return rows.map((p) => ({
    id: p.id,
    status: p.status,
    title: p.title,
    body: p.body,
    publishedAt: p.published_at,
    updatedAt: p.updated_at,
  }));
}

async function fetchPeople(userId: string) {
  const rows = await fetchAll(PAGE, (from, to) =>
    supabase
      .from("follows")
      .select("profiles!follows_followee_id_fkey(id, handle, display_name)")
      .eq("follower_id", userId)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  // Someone who has not finished onboarding has no handle, so no profile page to open.
  return rows.flatMap(({ profiles: p }) =>
    p?.handle ? [{ id: p.id, handle: p.handle, displayName: p.display_name }] : [],
  );
}

interface SaidBatch {
  docs: SearchDoc[];
  /** Newest `created_at` fetched, the next sync's watermark. */
  since: string | null;
}

async function fetchTranscripts(
  userId: string,
  since: string | null,
  titles: Map<string, string>,
): Promise<SaidBatch> {
  const rows = await fetchAll(SAID_PAGE, (from, to) => {
    const query = supabase
      .from("transcripts")
      .select("session_id, segments, created_at, sessions!inner(user_id)")
      .eq("sessions.user_id", userId)
      .order("created_at", { ascending: true })
      .range(from, to);
    return since ? query.gt("created_at", since) : query;
  });
  return {
    docs: rows.map((t) =>
      transcriptSearchDoc({
        sessionId: t.session_id,
        title: titles.get(t.session_id) ?? "Mock interview",
        segments: parseTranscriptSegments(t.segments),
        createdAt: t.created_at,
      }),
    ),
    since: rows.at(-1)?.created_at ?? null,
  };
}

async function fetchReviews(
  userId: string,
  since: string | null,
  titles: Map<string, string>,
): Promise<SaidBatch> {
  const rows = await fetchAll(PAGE, (from, to) => {
    const query = supabase
      .from("interview_reviews")
      .select("session_id, summary, moments, next_steps, created_at, sessions!inner(user_id)")
      .eq("sessions.user_id", userId)
      .order("created_at", { ascending: true })
      .range(from, to);
    return since ? query.gt("created_at", since) : query;
  });
  return {
    docs: rows.map((r) =>
      reviewSearchDoc({
        sessionId: r.session_id,
        title: titles.get(r.session_id) ?? "Mock interview",
        summary: r.summary,
        moments: MomentsSchema.parse(r.moments),
        nextSteps: NextStepsSchema.parse(r.next_steps),
        createdAt: r.created_at,
      }),
    ),
    since: rows.at(-1)?.created_at ?? null,
  };
}
