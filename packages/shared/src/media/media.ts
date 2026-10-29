/** Rules for the photos a post carries, shared by the web editor and the desktop composer. */

export const POST_MEDIA_BUCKET = "post-media";

/** Enough for a carousel without turning a post into an album. */
export const MAX_POST_IMAGES = 8;

export const POST_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** Matches the bucket's `file_size_limit` in migration 0007. */
export const MAX_POST_IMAGE_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isPostImageMime(mime: string): boolean {
  return (POST_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

export function imageExtension(mime: string): string {
  return EXTENSIONS[mime] ?? "jpg";
}

/**
 * `{owner}/{post}/{uuid}.{ext}`. The storage policies read both segments: the first proves
 * ownership for writes, the second decides who may read the object.
 */
export function postMediaPath(
  userId: string,
  postId: string,
  mime: string,
  id: string = crypto.randomUUID(),
): string {
  return `${userId}/${postId}/${id}.${imageExtension(mime)}`;
}

/** Human reason the file was rejected, or null when it is fine to upload. */
export function rejectPostImage(file: { type: string; size: number }): string | null {
  if (!isPostImageMime(file.type)) return "Photos must be JPEG, PNG, WebP or GIF.";
  if (file.size > MAX_POST_IMAGE_BYTES) return "Photos must be 10 MB or smaller.";
  return null;
}
