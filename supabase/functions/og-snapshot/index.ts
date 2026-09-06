// og-snapshot: make every post carry a pre-generated Open Graph card.
//
// Renders the session card through the web app's `/api/og/{postId}?card=1` route (which knows how
// to draw it), stores the PNG in the `post-media` bucket at `{owner}/{post}/og.png`, records it as
// a `post_media` row of kind 'og' and attaches it as the post's cover when the author has not
// chosen a custom one. The feed, the post page and link unfurls then all read the stored image
// instead of rendering on demand.
//
// Body:
//   { postId }                 generate once (no-op when the post already has a card)
//   { postId, force: true }    regenerate (after an edit, or a manual "regenerate card")
//   { backfill: true, limit? } generate for every published post the caller can see that lacks a
//                              card (anonymous callers therefore only ever touch public posts)
//
// Visibility is enforced twice: the caller must be able to SELECT the post (RLS, with their own
// JWT forwarded to the render route so private posts draw for their owner), and storage reads keep
// following `private.can_view_post_object` from migration 0007.
//
// Drafts: an author may snapshot their own unpublished post so the editor can preview the card
// they are about to publish. Everyone else still gets 409 until the post is published — and RLS
// only ever shows a draft to its owner, so the visibility check above already covers it.

import { envOptional, HttpError, handler, json, readJson } from "../_shared/http.ts";
import { adminClient, bearerJwt, optionalUser } from "../_shared/supabase.ts";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const DEFAULT_BACKFILL_LIMIT = 25;
const MAX_BACKFILL_LIMIT = 100;

interface Body {
  postId?: unknown;
  force?: unknown;
  backfill?: unknown;
  limit?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function renderCard(
  siteUrl: string,
  postId: string,
  jwt: string | null,
): Promise<ArrayBuffer> {
  const res = await fetch(`${siteUrl}/api/og/${postId}?card=1`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  });
  if (!res.ok) throw new HttpError(`card render failed (${res.status})`, 502);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/"))
    throw new HttpError(`card render returned ${type}, not an image`, 502);
  return await res.arrayBuffer();
}

type Admin = ReturnType<typeof adminClient>;

interface PostRow {
  id: string;
  user_id: string;
  status: string;
  cover_media_id: string | null;
}

/** Attach the card as the post's cover, but never over a cover the author picked themselves. */
async function attachAsCover(admin: Admin, postId: string, mediaId: string): Promise<void> {
  const { error } = await admin
    .from("posts")
    .update({ cover_media_id: mediaId })
    .eq("id", postId)
    .is("cover_media_id", null);
  if (error) console.warn(`attaching the card as cover failed: ${error.message}`);
}

async function snapshotPost(
  admin: Admin,
  siteUrl: string,
  postId: string,
  jwt: string | null,
  force: boolean,
  callerId: string | null,
): Promise<"created" | "refreshed" | "exists" | "skipped"> {
  const { data: post } = await admin
    .from("posts")
    .select("id, user_id, status, cover_media_id")
    .eq("id", postId)
    .maybeSingle();
  if (!post) throw new HttpError("Post not found", 404);
  const owner = post as PostRow;
  // Authors may snapshot their own draft to preview it; nobody else sees a card before publish.
  if (owner.status !== "published" && owner.user_id !== callerId) {
    throw new HttpError("Post is not published", 409);
  }

  const { data: existing } = await admin
    .from("post_media")
    .select("id")
    .eq("post_id", postId)
    .eq("kind", "og")
    .maybeSingle();
  if (existing && !force) {
    // The card is already there, but the post may have lost its cover since (an edit that
    // cleared it, or a draft saved from an editor that had not seen the card yet).
    if (!owner.cover_media_id) await attachAsCover(admin, postId, existing.id as string);
    return "exists";
  }

  const png = await renderCard(siteUrl, postId, jwt);
  const path = `${owner.user_id}/${postId}/og.png`;
  const { error: uploadError } = await admin.storage
    .from("post-media")
    .upload(path, png, { contentType: "image/png", upsert: true });
  if (uploadError) throw new HttpError(`storing the card failed: ${uploadError.message}`, 502);

  let mediaId: string;
  if (existing) {
    mediaId = existing.id as string;
    const { error: updateError } = await admin
      .from("post_media")
      .update({ storage_path: path, width: OG_WIDTH, height: OG_HEIGHT })
      .eq("id", mediaId);
    if (updateError) throw new HttpError(updateError.message, 500);
  } else {
    const { data: row, error: insertError } = await admin
      .from("post_media")
      .insert({
        post_id: postId,
        user_id: owner.user_id,
        storage_path: path,
        width: OG_WIDTH,
        height: OG_HEIGHT,
        kind: "og",
        position: 0,
      })
      .select("id")
      .single();
    if (insertError) throw new HttpError(insertError.message, 500);
    mediaId = row.id as string;
  }

  // Attach as the cover only while the author has not picked their own; a custom cover always wins.
  if (!owner.cover_media_id) await attachAsCover(admin, postId, mediaId);
  return existing ? "refreshed" : "created";
}

Deno.serve(
  handler(async (req) => {
    if (req.method !== "POST") throw new HttpError("Use POST", 405);
    const body = await readJson<Body>(req);
    const siteUrl = (envOptional("SITE_URL") ?? "https://lare-one.vercel.app").replace(/\/$/, "");
    const jwt = bearerJwt(req);
    const { id: callerId, client: caller } = await optionalUser(req);
    const admin = adminClient();

    if (body.backfill === true) {
      const limit = Math.min(
        Math.max(Number(body.limit) || DEFAULT_BACKFILL_LIMIT, 1),
        MAX_BACKFILL_LIMIT,
      );
      // RLS narrows this to what the caller may see: public posts for anonymous callers.
      const { data: posts, error: listError } = await caller
        .from("posts")
        .select("id, post_media!post_media_post_id_fkey(kind)")
        .eq("status", "published")
        .not("published_at", "is", null)
        .order("published_at", { ascending: true })
        .limit(limit);
      if (listError) throw new HttpError(listError.message, 500);
      const missing = (posts ?? []).filter(
        (p) => !((p.post_media as { kind: string }[] | null) ?? []).some((m) => m.kind === "og"),
      );
      const results: Record<string, string> = {};
      for (const post of missing) {
        const id = post.id as string;
        try {
          results[id] = await snapshotPost(admin, siteUrl, id, jwt, false, callerId);
        } catch (e) {
          results[id] = e instanceof Error ? e.message : "failed";
        }
      }
      return json({ scanned: (posts ?? []).length, generated: results });
    }

    const postId = typeof body.postId === "string" ? body.postId : "";
    if (!UUID_RE.test(postId)) throw new HttpError("postId must be a UUID");

    // The caller must be able to see the post themselves before we render and store its card.
    const { data: visible } = await caller
      .from("posts")
      .select("id")
      .eq("id", postId)
      .maybeSingle();
    if (!visible) throw new HttpError("Post not found", 404);

    const result = await snapshotPost(admin, siteUrl, postId, jwt, body.force === true, callerId);
    return json({ postId, result });
  }),
);
