/** An upload target stays usable until this long before its TUS authorisation runs out. */
const EXPIRY_MARGIN_MS = 60_000;

interface UploadTarget {
  tus: { headers: Record<string, string> };
}

/**
 * The upload target already on record for a recording, when a new upload of `filePath` can use
 * it: it was made for this file (or before the file was known, as a live capture's is), nothing
 * has finished uploading to it, and Bunny will still accept its signature. Otherwise null, and
 * the caller registers a new one.
 */
export function reusableUpload<T extends UploadTarget>(
  meta: { upload?: T; uploadPath?: string; uploaded: boolean } | null,
  filePath: string,
  now: number,
): T | null {
  if (!meta?.upload || meta.uploaded) return null;
  if (meta.uploadPath && meta.uploadPath !== filePath) return null;
  // Bunny's TUS header: when the signature expires, in epoch seconds.
  const expiresAt = Number(meta.upload.tus.headers.AuthorizationExpire) * 1000;
  return expiresAt > now + EXPIRY_MARGIN_MS ? meta.upload : null;
}
