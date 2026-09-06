import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
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
import { createAnonClient } from "@/lib/supabase/anon";
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

interface OgData {
  title: string;
  handle: string | null;
  displayName: string | null;
  kind: "practice" | "interview" | null;
  overview: SessionOverview;
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
        `title, cover_media_id,
         profiles!posts_user_id_fkey(handle, display_name),
         post_media!post_media_post_id_fkey(id, storage_path),
         sessions!posts_session_id_fkey(kind, active_ms,
           session_problems(id, title, difficulty, active_ms, opened_at,
             submissions(accepted, lang, runtime_ms, runtime_display, runtime_percentile,
               memory_mb, memory_display, memory_percentile, submitted_at)))`,
      )
      .eq("id", id)
      .eq("status", "published")
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
      },
    };
  } catch {
    return { data: null, coverPath: null };
  }
}

/**
 * Crawlers arrive without cookies, so the anonymous client is tried first: whatever it can read
 * is what a shared link may show, and that answer is safe to cache publicly. Only when it comes
 * back empty (a private post, or a private account seen by a follower) do we fall back to the
 * viewer's own session — and that render is marked private so it is never cached for others.
 */
async function loadForViewer(
  id: string,
): Promise<{ data: OgData | null; coverPath: string | null; supabase: Client; shared: boolean }> {
  if (!isUuid(id)) {
    return { data: null, coverPath: null, supabase: createAnonClient(), shared: true };
  }
  const anon = createAnonClient();
  const publicResult = await loadOgData(id, anon);
  if (publicResult.data) return { ...publicResult, supabase: anon, shared: true };

  const viewer = await createClient();
  const viewerResult = await loadOgData(id, viewer);
  return { ...viewerResult, supabase: viewer, shared: viewerResult.data === null };
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
 * The session card: an at-a-glance overview of what the author actually did — how many of the
 * problems they solved, how long they were at it, how their fastest accepted run compared, and
 * the problems themselves. Used both as the Open Graph image and as the first slide of the post
 * in the feed, so the two never drift apart.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [{ data, coverPath, supabase, shared }, emblem] = await Promise.all([
    loadForViewer(id),
    emblemSrc,
  ]);

  if (coverPath) {
    const signed = await signedCover(supabase, coverPath);
    if (signed) return NextResponse.redirect(signed, 307);
  }

  const overview = data?.overview;
  const shown = overview?.problems.slice(0, 3) ?? [];
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
        {data ? (
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
            {data.kind === "interview" ? "Mock interview" : "Practice session"}
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 20, color: MUTED }}>Hevy for LeetCode</div>
        )}
      </div>

      {data && overview ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: data.title.length > 46 ? 40 : 46,
                fontWeight: 800,
                lineHeight: 1.1,
                letterSpacing: -1.4,
                display: "flex",
              }}
            >
              {truncate(data.title, 68)}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 22, color: MUTED }}>
              <span>{data.displayName || (data.handle ? `@${data.handle}` : "Someone")}</span>
              {data.handle && data.displayName ? <span>@{data.handle}</span> : null}
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
          : data
            ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
            : "public, max-age=60",
      },
    },
  );
}
