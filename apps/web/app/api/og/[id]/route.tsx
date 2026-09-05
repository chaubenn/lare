import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatDurationHuman } from "@lare/shared";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/post-utils";
import { createAnonClient } from "@/lib/supabase/anon";

const emblemSrc = readFile(join(process.cwd(), "public/brand/emblem-512.png")).then(
  (buf) => `data:image/png;base64,${buf.toString("base64")}`,
);

const SIZE = { width: 1200, height: 630 };

interface OgData {
  title: string;
  handle: string | null;
  problems: number;
  activeMs: number | null;
  kind: "practice" | "interview" | null;
}

/**
 * Crawlers fetch this without cookies, so we deliberately use the anonymous client: only
 * public posts on public accounts get a rich card; everything else falls back to a generic one.
 */
async function loadOgData(id: string): Promise<OgData | null> {
  if (!isUuid(id)) return null;
  try {
    const supabase = createAnonClient();
    const { data } = await supabase
      .from("posts")
      .select(
        "title, profiles!posts_user_id_fkey(handle), sessions!posts_session_id_fkey(kind, active_ms, session_problems(id))",
      )
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle();
    if (!data) return null;
    return {
      title: data.title?.trim() || "Untitled session",
      handle: data.profiles.handle,
      problems: data.sessions?.session_problems.length ?? 0,
      activeMs: data.sessions?.active_ms ?? null,
      kind: data.sessions?.kind ?? null,
    };
  } catch {
    return null;
  }
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [data, emblem] = await Promise.all([loadOgData(id), emblemSrc]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#0c0c0b",
        color: "#f0ece4",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* biome-ignore lint/performance/noImgElement: next/og ImageResponse only supports <img>. */}
          <img src={emblem} width={44} height={44} alt="" />
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>Lare</div>
        </div>
        <div style={{ fontSize: 22, color: "#8a8780" }}>Hevy for LeetCode</div>
      </div>

      {data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 20,
              textTransform: "uppercase",
              letterSpacing: 4,
              color: "#8a8780",
              display: "flex",
            }}
          >
            {data.kind === "interview" ? "Mock interview" : "Practice session"}
          </div>
          <div
            style={{
              fontSize: data.title.length > 60 ? 48 : 64,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: -1.5,
              display: "flex",
              overflow: "hidden",
              maxHeight: 220,
            }}
          >
            {data.title}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
              fontSize: 26,
              color: "#d4d4d8",
            }}
          >
            {data.handle && <span>@{data.handle}</span>}
            <span style={{ color: "#52525b" }}>•</span>
            <span>
              {data.problems} {data.problems === 1 ? "problem" : "problems"}
            </span>
            {data.activeMs !== null && (
              <>
                <span style={{ color: "#52525b" }}>•</span>
                <span>{formatDurationHuman(data.activeMs)}</span>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5 }}>
            A LeetCode session on Lare
          </div>
          <div style={{ fontSize: 26, color: "#d4d4d8" }}>
            Log sessions, share the solve, follow friends.
          </div>
        </div>
      )}

      <div style={{ display: "flex", fontSize: 22, color: "#71717a" }}>
        lare · github.com/chaubenn/lare
      </div>
    </div>,
    {
      ...SIZE,
      headers: {
        "Cache-Control": data
          ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
          : "public, max-age=60",
      },
    },
  );
}
