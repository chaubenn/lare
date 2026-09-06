import { MAX_POST_IMAGES, POST_MEDIA_BUCKET, postMediaPath, rejectPostImage } from "@lare/shared";
import type { PostMedia } from "@lare/supabase-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PostImage extends PostMedia {
  /** Signed URL, valid for an hour; null when the object could not be signed. */
  url: string | null;
}

export const postMediaKey = (postId: string) => ["post-media", postId] as const;

/**
 * Ask the `og-snapshot` Edge Function to render and store the post's session card (the OG image).
 * Fire-and-forget: the function is idempotent and the feed falls back to rendering on demand.
 */
export function requestOgSnapshot(postId: string, force = false): Promise<unknown> {
  return supabase.functions
    .invoke("og-snapshot", { body: force ? { postId, force: true } : { postId } })
    .catch(() => null);
}

/** One carousel photo with a signed, ready-to-render URL. */
export interface FeedImage {
  id: string;
  url: string;
  caption: string | null;
}

/** Signed media URLs the feed card needs on top of the raw row. */
export interface PostDecoration {
  thumbnail_url: string | null;
  images: FeedImage[];
  /** Author-supplied cover, or null when the generated session card is used instead. */
  cover_url: string | null;
  /** Signed URL of the stored, pre-generated session card (post_media kind 'og'), if any. */
  og_url: string | null;
}

interface DecoratableRow {
  id: string;
  cover_media_id: string | null;
  videos: { thumbnail_path: string | null } | null;
  post_media:
    | {
        id: string;
        storage_path: string;
        kind: "og" | "photo" | null;
        caption: string | null;
        position: number;
        created_at: string;
      }[]
    | null;
}

/** Sign storage paths in one round-trip; unsignable paths resolve to null. */
async function signPaths(bucket: string, paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p) => p.length > 0))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, 3600);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl && !entry.error) map.set(entry.path, entry.signedUrl);
  }
  return map;
}

/** Author order: `position` first (what the editor drags), creation time as the tiebreak. */
function orderMedia<T extends { position: number; created_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
  );
}

/**
 * Attach signed thumbnail/photo/OG-card URLs to a batch of post rows — the same decoration
 * the web feed does, so both apps render the identical card. One signing round-trip per
 * bucket, whatever the page size.
 */
export async function decoratePosts<T extends DecoratableRow>(
  rows: T[],
): Promise<(T & PostDecoration)[]> {
  if (rows.length === 0) return [];
  const [thumbs, media] = await Promise.all([
    signPaths(
      "thumbnails",
      rows.map((r) => r.videos?.thumbnail_path ?? ""),
    ),
    signPaths(
      POST_MEDIA_BUCKET,
      rows.flatMap((r) => (r.post_media ?? []).map((m) => m.storage_path)),
    ),
  ]);
  return rows.map((row) => {
    const mediaRows = orderMedia(row.post_media ?? []);
    // Author photos only: the pre-generated session card (kind 'og') is the cover fallback,
    // never a carousel photo.
    const images: FeedImage[] = mediaRows
      .filter((m) => m.kind !== "og")
      .flatMap((m) => {
        const url = media.get(m.storage_path);
        return url ? [{ id: m.id, url, caption: m.caption }] : [];
      });
    const ogRow = mediaRows.find((m) => m.kind === "og");
    return {
      ...row,
      thumbnail_url: row.videos?.thumbnail_path
        ? (thumbs.get(row.videos.thumbnail_path) ?? null)
        : null,
      images,
      cover_url: images.find((i) => i.id === row.cover_media_id)?.url ?? null,
      og_url: ogRow ? (media.get(ogRow.storage_path) ?? null) : null,
    };
  });
}

/** Photos attached to a post, in author order, each with a signed URL ready to render. */
export function usePostMedia(postId: string) {
  return useQuery({
    queryKey: postMediaKey(postId),
    enabled: postId.length > 0,
    queryFn: async (): Promise<PostImage[]> => {
      const { data, error } = await supabase
        .from("post_media")
        .select("*")
        .eq("post_id", postId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return [];

      const { data: signed } = await supabase.storage.from(POST_MEDIA_BUCKET).createSignedUrls(
        rows.map((r) => r.storage_path),
        3600,
      );
      const urls = new Map<string, string>();
      for (const entry of signed ?? []) {
        if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
      }
      return rows.map((row) => ({ ...row, url: urls.get(row.storage_path) ?? null }));
    },
  });
}

/** Natural pixel size, used only to keep the carousel from reflowing. */
async function imageSize(file: File): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

export function useUploadPostImages(postId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]) => {
      const { count } = await supabase
        .from("post_media")
        .select("id", { count: "exact", head: true })
        .eq("post_id", postId)
        .eq("kind", "photo");
      const existing = count ?? 0;
      const room = MAX_POST_IMAGES - existing;
      if (room <= 0) throw new Error(`A post can hold ${MAX_POST_IMAGES} photos.`);

      let position = existing;
      for (const file of files.slice(0, room)) {
        const reason = rejectPostImage(file);
        if (reason) throw new Error(reason);

        const path = postMediaPath(userId, postId, file.type);
        const { error: uploadError } = await supabase.storage
          .from(POST_MEDIA_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;

        const size = await imageSize(file);
        const { error } = await supabase.from("post_media").insert({
          post_id: postId,
          user_id: userId,
          storage_path: path,
          width: size.width,
          height: size.height,
          position: position++,
        });
        if (error) {
          await supabase.storage.from(POST_MEDIA_BUCKET).remove([path]);
          throw error;
        }
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: postMediaKey(postId) }),
  });
}

export function useRemovePostImage(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (image: PostImage) => {
      const { error } = await supabase.from("post_media").delete().eq("id", image.id);
      if (error) throw error;
      await supabase.storage.from(POST_MEDIA_BUCKET).remove([image.storage_path]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: postMediaKey(postId) }),
  });
}

export function useReorderPostImages(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      for (const [index, id] of ids.entries()) {
        const { error } = await supabase
          .from("post_media")
          .update({ position: index })
          .eq("id", id)
          .eq("post_id", postId);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: postMediaKey(postId) }),
  });
}

export function useSetImageCaption(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, caption }: { id: string; caption: string }) => {
      const trimmed = caption.trim();
      const { error } = await supabase
        .from("post_media")
        .update({ caption: trimmed.length > 0 ? trimmed : null })
        .eq("id", id)
        .eq("post_id", postId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: postMediaKey(postId) }),
  });
}

/** Re-render and replace the stored session card (OG image) for this post. */
export function useRegenerateOgSnapshot(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("og-snapshot", {
        body: { postId, force: true },
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: postMediaKey(postId) }),
  });
}
