/** Profile picture upload: bucket/path rules shared by the web settings page and the
 * desktop settings page. The `avatars` storage bucket, its public-read policy and its
 * owner-scoped write policies already exist (0001_init.sql) -- this is the client side.
 */

export const AVATAR_BUCKET = "avatars";

/** Square side length the resized avatar is encoded at. */
export const AVATAR_SIZE = 256;

export const AVATAR_JPEG_QUALITY = 0.85;

export const AVATAR_INPUT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** Generous cap on the *input* file -- it gets resized down before upload, so this only
 * exists to reject obviously-wrong files, not to approximate the final upload size. Matches
 * the bucket's own file_size_limit as the real backstop.
 */
export const MAX_AVATAR_INPUT_BYTES = 20 * 1024 * 1024;

export function isAvatarInputMime(mime: string): boolean {
  return (AVATAR_INPUT_MIME_TYPES as readonly string[]).includes(mime);
}

/** Human reason the file was rejected, or null when it is fine to process. */
export function rejectAvatarInput(file: { type: string; size: number }): string | null {
  if (!isAvatarInputMime(file.type)) return "Photos must be JPEG, PNG, WebP or GIF.";
  if (file.size > MAX_AVATAR_INPUT_BYTES) return "Photos must be 20 MB or smaller.";
  return null;
}

/**
 * `{userId}/avatar.jpg` -- fixed per user (not a new UUID each time), so re-uploading
 * overwrites the same object rather than accumulating old avatars. Always `.jpg`: the
 * resize step (see `resizeAvatarImage`) always re-encodes as JPEG regardless of the
 * original format.
 */
export function avatarPath(userId: string): string {
  return `${userId}/avatar.jpg`;
}

/**
 * The `avatars` bucket is public and the path is fixed per user, so the URL never changes
 * across re-uploads -- without a cache-busting query param, browsers and CDNs would keep
 * serving the old image indefinitely after a change.
 */
export function withCacheBust(url: string, at: number = Date.now()): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${at}`;
}

/**
 * Crops to a centered square and resizes to `AVATAR_SIZE`, re-encoded as JPEG. Browser-only
 * (canvas); both apps run in a webview, so this is safe to share.
 */
export async function resizeAvatarImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode avatar image"))),
        "image/jpeg",
        AVATAR_JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}
