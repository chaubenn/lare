import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AI_SCORE_LABELS,
  type AiScoreKey,
  buildSessionOverview,
  difficultyMixLabel,
  formatBeats,
  formatDurationHuman,
  type ProblemOverview,
  type SessionOverview,
} from "@lare/shared";
import type { Database } from "@lare/supabase-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isUuid } from "@/lib/post-utils";
import { createAnonClient, createBearerClient } from "@/lib/supabase/anon";
import { createClient } from "@/lib/supabase/server";

const emblemSrc = readFile(join(process.cwd(), "public/brand/emblem-512.png")).then(
  (buf) => `data:image/png;base64,${buf.toString("base64")}`,
);

const SIZE = { width: 1200, height: 630 };

const INK = "#0c0c0b";
const INK_2 = "#161615";
const LINE = "#2a2a27";
const MUTED = "#8a8780";
const BONE = "#f0ece4";
const DIFFICULTY_COLOUR: Record<string, string> = {
  Easy: "#34d399",
  Medium: "#fbbf24",
  Hard: "#fb7185",
};

/** Overall plus the five skill percentages, in the order they are drawn. */
interface AiScores {
  overall: number;
  skills: { key: AiScoreKey; label: string; score: number }[];
}

interface OgData {
  title: string;
  handle: string | null;
  displayName: string | null;
  kind: "practice" | "interview" | null;
  overview: SessionOverview;
  /** The author's "include the session card" switch; false renders the generic Lare card. */
  showCard: boolean;
  sessionId: string | null;
  /** The author's "show the AI percentages on the card" switch. */
  showAiScores: boolean;
}

type Client = SupabaseClient<Database>;

async function loadOgData(
  id: string,
  supabase: Client,
): Promise<{ data: OgData | null; coverPath: string | null }> {
  try {
    const { data } = await supabase
      .from("posts")
      .select(
        `title, cover_media_id, session_id, include_og_card, og_show_ai_scores,
         profiles!posts_user_id_fkey(handle, display_name),
         post_media!post_media_post_id_fkey(id, storage_path),
         sessions!posts_session_id_fkey(kind, active_ms,
           session_problems(id, title, difficulty, active_ms, opened_at,
             submissions(accepted, lang, runtime_ms, runtime_display, runtime_percentile,
               memory_mb, memory_display, memory_percentile, submitted_at)))`,
      )
      .eq("id", id)
      .maybeSingle();
    if (!data) return { data: null, coverPath: null };

    const cover = (data.post_media ?? []).find((m) => m.id === data.cover_media_id);
    return {
      coverPath: cover?.storage_path ?? null,
      data: {
        title: data.title?.trim() || "Untitled session",
        handle: data.profiles?.handle ?? null,
        displayName: data.profiles?.display_name ?? null,
        kind: data.sessions?.kind ?? null,
        overview: buildSessionOverview(
          data.sessions?.session_problems ?? [],
          data.sessions?.active_ms ?? null,
        ),
        showCard: data.include_og_card,
        sessionId: data.session_id,
        showAiScores: data.og_show_ai_scores,
      },
    };
  } catch {
    return { data: null, coverPath: null };
  }
}

/**
 * Crawlers arrive without cookies, so the anonymous client is tried first: whatever it can read
 * is what a shared link may show, and that answer is safe to cache publicly. Only when it comes
 * back empty (a private post, a draft, or a private account seen by a follower) do we fall back
 * to the viewer's own session — cookie-based in the browser, Bearer token for server-to-server
 * callers like the `og-snapshot` Edge Function — and that render is marked private so it is
 * never cached for others.
 *
 * Visibility is left entirely to RLS (`can_view_post`: the owner, or a published public post on
 * a visible profile). That is what lets an author preview the card for a draft they have not
 * published yet, while a stranger asking for the same id still gets the generic fallback.
 */
async function loadForViewer(
  id: string,
  bearer: string | null,
): Promise<{ data: OgData | null; coverPath: string | null; supabase: Client; shared: boolean }> {
  if (!isUuid(id)) {
    return { data: null, coverPath: null, supabase: createAnonClient(), shared: true };
  }
  const anon = createAnonClient();
  const publicResult = await loadOgData(id, anon);
  if (publicResult.data) return { ...publicResult, supabase: anon, shared: true };

  const viewer = await createClient();
  const viewerResult = await loadOgData(id, viewer);
  if (viewerResult.data) return { ...viewerResult, supabase: viewer, shared: false };

  if (bearer) {
    const tokenClient = createBearerClient(bearer);
    const tokenResult = await loadOgData(id, tokenClient);
    return { ...tokenResult, supabase: tokenClient, shared: tokenResult.data === null };
  }
  return { ...viewerResult, supabase: viewer, shared: true };
}

/** Author-supplied cover wins over the generated card; RLS gates the signature. */
async function signedCover(supabase: Client, path: string): Promise<string | null> {
  try {
    const { data } = await supabase.storage.from("post-media").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flex: 1,
        padding: "14px 18px",
        borderRadius: 16,
        background: INK_2,
        border: `1px solid ${LINE}`,
      }}
    >
      <div style={{ fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: MUTED }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: accent ?? BONE, letterSpacing: -0.5 }}>
        {value}
      </div>
    </div>
  );
}

function ProblemRow({ problem }: { problem: ProblemOverview }) {
  const dot = problem.difficulty ? DIFFICULTY_COLOUR[problem.difficulty] : MUTED;
  const beats = problem.solved ? formatBeats(problem.runtimePercentile) : null;
  const right = problem.solved
    ? [problem.runtimeLabel, beats ? `beats ${beats}` : null].filter(Boolean).join(" · ")
    : problem.attempts > 0
      ? `${problem.attempts} ${problem.attempts === 1 ? "attempt" : "attempts"}`
      : "no submission";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "11px 0",
        borderTop: `1px solid ${LINE}`,
      }}
    >
      <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: dot }} />
      <div style={{ display: "flex", fontSize: 24, color: BONE, flex: 1 }}>
        {truncate(problem.title, 34)}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 21,
          color: problem.solved ? "#a7c4b5" : MUTED,
        }}
      >
        {right || "—"}
      </div>
    </div>
  );
}

/**
 * The AI review percentages, when the author asked for them on the card. Read with the same
 * client as the post, so RLS decides: `can_view_session_insights` only opens the review up to
 * the owner and to viewers of a post that ships its AI insights. A crawler that cannot see them
 * simply gets the card without the strip — the stored PNG (rendered for the author by
 * `og-snapshot`) is what shared links actually resolve to.
 */
async function loadAiScores(supabase: Client, sessionId: string): Promise<AiScores | null> {
  try {
    const { data } = await supabase
      .from("interview_reviews")
      .select("overall, scores")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (!data || typeof data.overall !== "number") return null;
    const raw = (data.scores ?? {}) as Record<string, { score?: unknown } | undefined>;
    const skills = (Object.keys(AI_SCORE_LABELS) as AiScoreKey[]).flatMap((key) => {
      const score = raw[key]?.score;
      return typeof score === "number"
        ? [{ key, label: AI_SCORE_LABELS[key], score: Math.round(score) }]
        : [];
    });
    return skills.length > 0 ? { overall: Math.round(data.overall), skills } : null;
  } catch {
    return null;
  }
}

function ScoreChip({ label, value, lead }: { label: string; value: number; lead?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        flex: 1,
        padding: "10px 8px",
        borderRadius: 14,
        background: lead ? "#1d241f" : INK_2,
        border: `1px solid ${lead ? "#34d399" : LINE}`,
      }}
    >
      <div style={{ fontSize: 26, fontWeight: 700, color: lead ? "#34d399" : BONE }}>{value}%</div>
      <div style={{ fontSize: 14, letterSpacing: 1, textTransform: "uppercase", color: MUTED }}>
        {truncate(label, 16)}
      </div>
    </div>
  );
}

/**
 * The session card: an at-a-glance overview of what the author actually did — how many of the
 * problems they solved, how long they were at it, how their fastest accepted run compared, and
 * the problems themselves. Used both as the Open Graph image and as the first slide of the post
 * in the feed, so the two never drift apart.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // `?card=1` forces the generated session card even when the author set a custom cover —
  // the og-snapshot function uses it to (re)generate the stored card image.
  const cardOnly = request.nextUrl.searchParams.get("card") === "1";
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : null;
  const [{ data, coverPath, supabase, shared }, emblem] = await Promise.all([
    loadForViewer(id, bearer),
    emblemSrc,
  ]);

  if (coverPath && !cardOnly) {
    const signed = await signedCover(supabase, coverPath);
    if (signed) return NextResponse.redirect(signed, 307);
  }

  // An author who switched the session card off gets the generic Lare card instead — their
  // stats are not what a shared link should unfurl to.
  const card = data?.showCard ? data : null;
  const scores =
    card?.showAiScores && card.sessionId ? await loadAiScores(supabase, card.sessionId) : null;

  const overview = card?.overview;
  // The score strip takes a row's worth of height, so fewer problems fit under it.
  const shown = overview?.problems.slice(0, scores ? 2 : 3) ?? [];
  const remaining = (overview?.total ?? 0) - shown.length;
  const mix = overview ? difficultyMixLabel(overview.difficulty) : null;
  const beats = overview ? formatBeats(overview.bestPercentile) : null;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 52,
        background: INK,
        color: BONE,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* biome-ignore lint/performance/noImgElement: next/og ImageResponse only supports <img>. */}
          <img src={emblem} width={40} height={40} alt="" />
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5 }}>Lare</div>
        </div>
        {card ? (
          <div
            style={{
              display: "flex",
              fontSize: 18,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: MUTED,
              border: `1px solid ${LINE}`,
              borderRadius: 999,
              padding: "8px 18px",
            }}
          >
            {card.kind === "interview" ? "Mock interview" : "Practice session"}
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 20, color: MUTED }}>Hevy for LeetCode</div>
        )}
      </div>

      {card && overview ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: card.title.length > 46 ? 40 : 46,
                fontWeight: 800,
                lineHeight: 1.1,
                letterSpacing: -1.4,
                display: "flex",
              }}
            >
              {truncate(card.title, 68)}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 22, color: MUTED }}>
              <span>{card.displayName || (card.handle ? `@${card.handle}` : "Someone")}</span>
              {card.handle && card.displayName ? <span>@{card.handle}</span> : null}
              {mix ? <span>· {mix}</span> : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <Stat
              label="Solved"
              value={`${overview.solved}/${overview.total}`}
              accent={overview.solved === overview.total && overview.total > 0 ? "#34d399" : BONE}
            />
            <Stat label="Active" value={formatDurationHuman(overview.activeMs)} />
            <Stat label="Best runtime" value={beats ? `beats ${beats}` : "—"} />
            <Stat label="Submissions" value={String(overview.attempts)} />
          </div>

          {scores ? (
            <div style={{ display: "flex", gap: 10 }}>
              <ScoreChip label="Overall" value={scores.overall} lead />
              {scores.skills.map((skill) => (
                <ScoreChip key={skill.key} label={skill.label} value={skill.score} />
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column" }}>
            {shown.map((problem) => (
              <ProblemRow key={problem.id} problem={problem} />
            ))}
            {remaining > 0 ? (
              <div
                style={{
                  display: "flex",
                  paddingTop: 11,
                  borderTop: `1px solid ${LINE}`,
                  fontSize: 21,
                  color: MUTED,
                }}
              >
                +{remaining} more {remaining === 1 ? "problem" : "problems"}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5 }}>
            A LeetCode session on Lare
          </div>
          <div style={{ fontSize: 26, color: "#d4d4d8" }}>
            Log sessions, share the solve, follow friends.
          </div>
        </div>
      )}

      <div style={{ display: "flex", fontSize: 20, color: MUTED }}>
        lare · github.com/chaubenn/lare
      </div>
    </div>,
    {
      ...SIZE,
      headers: {
        "Cache-Control": !shared
          ? "private, max-age=60"
          : card
            ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
            : "public, max-age=60",
      },
    },
  );
}
