import { MAX_POST_IMAGES, POST_MEDIA_BUCKET, postMediaPath, rejectPostImage } from "@lare/shared";
import type { PostMedia } from "@lare/supabase-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PostImage extends PostMedia {
  /** Signed URL, valid for an hour; null when the object could not be signed. */
  url: string | null;
}

export const postMediaKey = (postId: string) => ["post-media", postId] as const;

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
        .eq("post_id", postId);
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
