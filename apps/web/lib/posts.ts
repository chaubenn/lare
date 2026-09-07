import "server-only";

import type { Database } from "@lare/supabase-types";
import type { QueryData, SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { isUuid, sortSubmissions } from "@/lib/post-utils";
import { createClient } from "@/lib/supabase/server";

type Client = SupabaseClient<Database>;

export const FEED_PAGE_SIZE = 10;

/** Columns needed by `PostCard`. Keep it lean: no code, no distributions, no descriptions. */
export const POST_CARD_SELECT = `
  id, user_id, title, body, status, visibility, video_id, video_kind, include_ai_insights,
  show_video, demo_video_id, show_demo_video, include_og_card, og_show_ai_scores,
  cover_media_id, like_count, comment_count,
  published_at, created_at, updated_at, session_id,
  profiles!posts_user_id_fkey(handle, display_name, avatar_url, is_private),
  sessions!posts_session_id_fkey(id, kind, scope, status, active_ms, started_at, ended_at,
    session_problems(id, slug, title, difficulty, active_ms, opened_at,
      submissions(id, accepted, lang, runtime_ms, runtime_display, runtime_percentile,
        memory_mb, memory_display, memory_percentile, submitted_at))),
  videos!posts_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id),
  demo_videos:videos!posts_demo_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id),
  post_media!post_media_post_id_fkey(id, storage_path, kind, width, height, caption, position, created_at)
` as const;

const SUBMISSION_LIST_SELECT = `
  id, accepted, lang, lang_verbose, status_display, status_code,
  runtime_ms, runtime_display, runtime_percentile,
  memory_mb, memory_display, memory_percentile,
  total_testcases, total_correct, submitted_at
`;

/** Columns `/p/[id]` actually renders. Code + distribution blobs are hydrated only for the expanded submission. */
export const POST_DETAIL_SELECT = `
  id, user_id, title, body, status, visibility, video_id, video_kind, include_ai_insights,
  show_video, demo_video_id, show_demo_video, include_og_card, og_show_ai_scores,
  cover_media_id, like_count, comment_count,
  published_at, created_at, updated_at, session_id,
  profiles!posts_user_id_fkey(id, handle, display_name, avatar_url, is_private),
  sessions!posts_session_id_fkey(id, kind, scope, status, active_ms, started_at, ended_at,
    session_problems(id, slug, title, difficulty, frontend_id, active_ms, opened_at,
      description_html, topic_tags,
      submissions(${SUBMISSION_LIST_SELECT}))),
  videos!posts_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id),
  demo_videos:videos!posts_demo_video_id_fkey(id, status, thumbnail_path, duration_ms, bunny_video_id, library_id),
  post_media!post_media_post_id_fkey(id, storage_path, kind, width, height, caption, position, created_at)
` as const;

function postCardQuery(supabase: Client) {
  return supabase.from("posts").select(POST_CARD_SELECT);
}
function postDetailQuery(supabase: Client) {
  return supabase.from("posts").select(POST_DETAIL_SELECT);
}

export type PostCardRow = QueryData<ReturnType<typeof postCardQuery>>[number];
export type PostDetailRow = QueryData<ReturnType<typeof postDetailQuery>>[number];

/** One carousel photo with a signed, ready-to-render URL. */
export interface PostImage {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
}

/** Everything the card and the post page need on top of the raw row. */
export interface PostSocial {
  thumbnail_url: string | null;
  /** Poster for the summary video (`demo_video_id`), when there is one. */
  demo_thumbnail_url: string | null;
  images: PostImage[];
  /** Author-supplied cover, or null when the generated session card is used instead. */
  cover_url: string | null;
  /** Signed URL of the stored, pre-generated session card (post_media kind 'og'), if any. */
  og_url: string | null;
  viewer_liked: boolean;
}

export type PostCardData = PostCardRow & PostSocial & { top_comments: PostCommentRow[] };
export type PostDetail = PostDetailRow & PostSocial;

export type PostCardSession = NonNullable<PostCardRow["sessions"]>;
export type PostCardProblem = PostCardSession["session_problems"][number];

/** Sign storage paths in one round-trip; unsignable paths resolve to null. */
async function signPaths(
  supabase: Client,
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p) => p.length > 0))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, 3600);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) map.set(entry.path, entry.signedUrl);
  }
  return map;
}

type MediaRow = {
  id: string;
  storage_path: string;
  kind?: "og" | "photo" | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  position: number;
  created_at: string;
};

type DecoratableRow = {
  id: string;
  cover_media_id: string | null;
  videos: { thumbnail_path: string | null } | null;
  demo_videos?: { thumbnail_path: string | null } | null;
  post_media: MediaRow[] | null;
};

/** Author order: `position` first (what the editor drags), creation time as the tiebreak. */
function orderMedia(rows: readonly MediaRow[]): MediaRow[] {
  return [...rows].sort(
    (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
  );
}

/**
 * Attach signed thumbnail/photo URLs and the viewer's like state to a batch of post rows.
 * One signing round-trip per bucket and one query for likes, whatever the page size.
 */
export async function decoratePosts<T extends DecoratableRow>(
  supabase: Client,
  rows: T[],
): Promise<(T & PostSocial)[]> {
  if (rows.length === 0) return [];

  const [thumbs, media, likedIds] = await Promise.all([
    signPaths(
      supabase,
      "thumbnails",
      rows.flatMap((r) =>
        [r.videos?.thumbnail_path, r.demo_videos?.thumbnail_path].filter((p): p is string =>
          Boolean(p),
        ),
      ),
    ),
    signPaths(
      supabase,
      "post-media",
      rows.flatMap((r) => (r.post_media ?? []).map((m) => m.storage_path)),
    ),
    likedPostIds(
      supabase,
      rows.map((r) => r.id),
    ),
  ]);

  return rows.map((row) => {
    const mediaRows = row.post_media ?? [];
    // Author photos only: the pre-generated session card (kind 'og') is the cover fallback,
    // never a carousel photo.
    const images: PostImage[] = orderMedia(mediaRows.filter((m) => m.kind !== "og")).flatMap(
      (m) => {
        const url = media.get(m.storage_path);
        return url ? [{ id: m.id, url, width: m.width, height: m.height, caption: m.caption }] : [];
      },
    );
    const ogRow = mediaRows.find((m) => m.kind === "og");
    return {
      ...row,
      thumbnail_url: row.videos?.thumbnail_path
        ? (thumbs.get(row.videos.thumbnail_path) ?? null)
        : null,
      demo_thumbnail_url: row.demo_videos?.thumbnail_path
        ? (thumbs.get(row.demo_videos.thumbnail_path) ?? null)
        : null,
      images,
      cover_url: images.find((i) => i.id === row.cover_media_id)?.url ?? null,
      og_url: ogRow ? (media.get(ogRow.storage_path) ?? null) : null,
      viewer_liked: likedIds.has(row.id),
    };
  });
}

/** Which of these posts the signed-in viewer has already liked (empty set when anonymous). */
async function likedPostIds(supabase: Client, postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) return new Set();
  const { data } = await supabase
    .from("post_likes")
    .select("post_id")
    .eq("user_id", userId)
    .in("post_id", postIds);
  return new Set((data ?? []).map((row) => row.post_id));
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
  const items = await decorateCardRows(supabase, rows);
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
  return decorateCardRows(supabase, data ?? []);
}

/** Signed media + viewer like + the first few comments, so the feed card renders in one pass. */
async function decorateCardRows(supabase: Client, rows: PostCardRow[]): Promise<PostCardData[]> {
  const [decorated, comments] = await Promise.all([
    decoratePosts(supabase, rows),
    fetchTopComments(
      supabase,
      rows.map((r) => r.id),
    ),
  ]);
  return decorated.map((row) => ({ ...row, top_comments: comments.get(row.id) ?? [] }));
}

/** Full post for `/p/[id]`, deduped between `generateMetadata` and the page. Null = not visible. */
export const getPostDetail = cache(async (id: string): Promise<PostDetail | null> => {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await postDetailQuery(supabase).eq("id", id).maybeSingle();
  if (error) throw new Error(`post failed: ${error.message}`);
  if (!data) return null;
  const [decorated] = await decoratePosts(supabase, [data]);
  return decorated ? hydrateExpandedSubmissions(supabase, decorated) : null;
});

type ExpandablePost = {
  sessions: {
    session_problems: {
      submissions: Array<{ id: string; accepted: boolean; submitted_at: string }>;
    }[];
  } | null;
};

/** First submission per problem (accepted, then newest) gets code + distribution blobs. */
async function hydrateExpandedSubmissions<T extends ExpandablePost>(
  supabase: Client,
  post: T,
): Promise<T> {
  const problems = post.sessions?.session_problems ?? [];
  const firstIds = problems.flatMap((problem) => {
    const first = sortSubmissions(problem.submissions)[0];
    return first ? [first.id] : [];
  });
  if (firstIds.length === 0) return post;
  const { data } = await supabase
    .from("submissions")
    .select("id, code, runtime_distribution, memory_distribution")
    .in("id", firstIds);
  const extra = new Map((data ?? []).map((row) => [row.id, row]));
  if (!post.sessions) return post;
  return {
    ...post,
    sessions: {
      ...post.sessions,
      session_problems: problems.map((problem) => ({
        ...problem,
        submissions: problem.submissions.map((submission) => {
          const more = extra.get(submission.id);
          return more ? { ...submission, ...more } : submission;
        }),
      })),
    },
  };
}

/** Comments on a post, oldest first, with their authors. RLS mirrors the post's visibility. */
export const COMMENT_SELECT = `
  id, post_id, user_id, body, edited_at, created_at,
  profiles!post_comments_user_id_fkey(handle, display_name, avatar_url)
` as const;

function commentQuery(supabase: Client) {
  return supabase.from("post_comments").select(COMMENT_SELECT);
}
export type PostCommentRow = QueryData<ReturnType<typeof commentQuery>>[number];

export async function fetchComments(supabase: Client, postId: string): Promise<PostCommentRow[]> {
  const { data, error } = await commentQuery(supabase)
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`comments failed: ${error.message}`);
  return data ?? [];
}

/**
 * The first few comments of each post (oldest first), for the feed card's inline preview.
 * One query for the whole page; posts with fewer comments simply come back shorter.
 */
export const FEED_COMMENT_PREVIEW = 3;

export async function fetchTopComments(
  supabase: Client,
  postIds: string[],
  limit = FEED_COMMENT_PREVIEW,
): Promise<Map<string, PostCommentRow[]>> {
  if (postIds.length === 0) return new Map();
  const { data, error } = await commentQuery(supabase)
    .in("post_id", postIds)
    .order("created_at", { ascending: true })
    .limit(postIds.length * limit);
  if (error) throw new Error(`comments failed: ${error.message}`);
  const map = new Map<string, PostCommentRow[]>();
  for (const row of data ?? []) {
    const list = map.get(row.post_id);
    if (list && list.length >= limit) continue;
    if (list) list.push(row);
    else map.set(row.post_id, [row]);
  }
  return map;
}
