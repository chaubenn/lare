import "server-only";

import type { Database } from "@lare/supabase-types";
import type { QueryData, SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { isUuid } from "@/lib/post-utils";
import { createClient } from "@/lib/supabase/server";

type Client = SupabaseClient<Database>;

export const FEED_PAGE_SIZE = 10;

/** Columns needed by `PostCard`. Keep it lean: no code, no distributions, no descriptions. */
export const POST_CARD_SELECT = `
  id, user_id, title, body, status, visibility, video_id, video_kind, include_ai_insights,
  published_at, created_at, updated_at, session_id,
  profiles!posts_user_id_fkey(handle, display_name, avatar_url, is_private),
  sessions!posts_session_id_fkey(id, kind, scope, status, active_ms, started_at, ended_at,
    session_problems(id, slug, title, difficulty, active_ms, opened_at,
      submissions(id, accepted, runtime_ms, runtime_display, runtime_percentile, submitted_at))),
  videos!posts_video_id_fkey(id, status, thumbnail_path, duration_ms)
` as const;

/** Everything `/p/[id]` renders. */
export const POST_DETAIL_SELECT = `
  *,
  profiles!posts_user_id_fkey(id, handle, display_name, avatar_url, is_private),
  sessions!posts_session_id_fkey(*, session_problems(*, submissions(*))),
  videos!posts_video_id_fkey(*)
` as const;

function postCardQuery(supabase: Client) {
  return supabase.from("posts").select(POST_CARD_SELECT);
}
function postDetailQuery(supabase: Client) {
  return supabase.from("posts").select(POST_DETAIL_SELECT);
}

export type PostCardRow = QueryData<ReturnType<typeof postCardQuery>>[number];
export type PostDetail = QueryData<ReturnType<typeof postDetailQuery>>[number];
export type PostCardData = PostCardRow & { thumbnail_url: string | null };

export type PostCardSession = NonNullable<PostCardRow["sessions"]>;
export type PostCardProblem = PostCardSession["session_problems"][number];

/** Sign thumbnail paths in one round-trip; unsignable paths resolve to null. */
export async function signThumbnails(
  supabase: Client,
  paths: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p) => p.length > 0))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase.storage.from("thumbnails").createSignedUrls(unique, 3600);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) map.set(entry.path, entry.signedUrl);
  }
  return map;
}

export async function attachThumbnails(
  supabase: Client,
  rows: PostCardRow[],
): Promise<PostCardData[]> {
  const paths = rows.map((r) => r.videos?.thumbnail_path ?? "").filter(Boolean);
  const signed = await signThumbnails(supabase, paths);
  return rows.map((row) => ({
    ...row,
    thumbnail_url: row.videos?.thumbnail_path
      ? (signed.get(row.videos.thumbnail_path) ?? null)
      : null,
  }));
}

/** "all" is every post the viewer is allowed to see; "following" narrows it to accepted followees. */
export const FEED_SCOPES = ["all", "following"] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];

export function parseFeedScope(raw: string | string[] | undefined): FeedScope {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return FEED_SCOPES.includes(value as FeedScope) ? (value as FeedScope) : "all";
}

/**
 * One page of the viewer's feed, newest first. `before` is the `published_at` cursor of the
 * last item of the previous page. Visibility is enforced by RLS, not here: the RPC only
 * chooses the slice ("all" vs. accounts the viewer follows).
 */
export async function fetchFeedPage(
  supabase: Client,
  before: string | null,
  scope: FeedScope = "all",
): Promise<{ items: PostCardData[]; nextCursor: string | null }> {
  const { data, error } = await supabase
    .rpc("feed", { ...(before ? { before } : {}), page_size: FEED_PAGE_SIZE, scope })
    .select(POST_CARD_SELECT)
    .overrideTypes<PostCardRow[], { merge: false }>();
  if (error) throw new Error(`feed failed: ${error.message}`);
  const rows = data ?? [];
  const items = await attachThumbnails(supabase, rows);
  const last = rows.at(-1);
  const nextCursor =
    rows.length === FEED_PAGE_SIZE && last?.published_at ? last.published_at : null;
  return { items, nextCursor };
}

/** Published posts by one user (RLS hides whatever the viewer can't see). */
export async function fetchUserPosts(supabase: Client, userId: string): Promise<PostCardData[]> {
  const { data, error } = await postCardQuery(supabase)
    .eq("user_id", userId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`posts failed: ${error.message}`);
  return attachThumbnails(supabase, data ?? []);
}

/** Full post for `/p/[id]`, deduped between `generateMetadata` and the page. Null = not visible. */
export const getPostDetail = cache(async (id: string): Promise<PostDetail | null> => {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await postDetailQuery(supabase).eq("id", id).maybeSingle();
  if (error) throw new Error(`post failed: ${error.message}`);
  return data ?? null;
});
