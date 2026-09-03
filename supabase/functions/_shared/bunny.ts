import { env } from "./http.ts";

export const BUNNY_VIDEO_API = "https://video.bunnycdn.com";
export const BUNNY_TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";
export const BUNNY_EMBED_BASE = "https://player.mediadelivery.net/embed";

export function libraryId(): number {
  return Number(env("BUNNY_LIBRARY_ID"));
}

function streamHeaders(): Record<string, string> {
  return { AccessKey: env("BUNNY_STREAM_API_KEY"), accept: "application/json" };
}

export interface BunnyVideo {
  guid: string;
  title: string;
  status: number;
  length: number; // seconds
  width: number;
  height: number;
  encodeProgress: number;
  availableResolutions: string | null;
  thumbnailFileName: string | null;
}

export async function createVideo(title: string): Promise<BunnyVideo> {
  const res = await fetch(`${BUNNY_VIDEO_API}/library/${libraryId()}/videos`, {
    method: "POST",
    headers: { ...streamHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Bunny create video failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as BunnyVideo;
}

export async function getVideo(guid: string): Promise<BunnyVideo | null> {
  const res = await fetch(`${BUNNY_VIDEO_API}/library/${libraryId()}/videos/${guid}`, {
    headers: streamHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Bunny get video failed: ${res.status}`);
  return (await res.json()) as BunnyVideo;
}

export async function deleteVideo(guid: string): Promise<void> {
  const res = await fetch(`${BUNNY_VIDEO_API}/library/${libraryId()}/videos/${guid}`, {
    method: "DELETE",
    headers: streamHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Bunny delete video failed: ${res.status}`);
}

export async function uploadCaptions(guid: string, lang: string, label: string, vtt: string): Promise<void> {
  const captionsFile = btoa(unescape(encodeURIComponent(vtt)));
  const res = await fetch(`${BUNNY_VIDEO_API}/library/${libraryId()}/videos/${guid}/captions/${lang}`, {
    method: "POST",
    headers: { ...streamHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ srclang: lang, label, captionsFile }),
  });
  if (!res.ok) throw new Error(`Bunny captions upload failed: ${res.status} ${await res.text()}`);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** TUS `AuthorizationSignature` = SHA256(library_id + api_key + expiration_time + video_id). */
export async function tusSignature(guid: string, expire: number): Promise<string> {
  return sha256Hex(`${libraryId()}${env("BUNNY_STREAM_API_KEY")}${expire}${guid}`);
}

/** Embed view token = SHA256(token_security_key + video_id + expires). */
export async function embedToken(guid: string, expires: number): Promise<string> {
  return sha256Hex(`${env("BUNNY_TOKEN_KEY")}${guid}${expires}`);
}

export function embedUrl(guid: string, params: Record<string, string | number> = {}): string {
  const u = new URL(`${BUNNY_EMBED_BASE}/${libraryId()}/${guid}`);
  u.searchParams.set("autoplay", "false");
  u.searchParams.set("preload", "true");
  u.searchParams.set("responsive", "true");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

/** Verify Bunny's webhook HMAC-SHA256 (key = library read-only API key). */
export async function verifyWebhookSignature(rawBody: string, signatureHex: string | null): Promise<boolean> {
  if (!signatureHex) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env("BUNNY_STREAM_READONLY_KEY")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, signatureHex.trim().toLowerCase());
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Bunny webhook status enum -> videos.status */
export function mapWebhookStatus(status: number): "uploading" | "uploaded" | "processing" | "ready" | "failed" | null {
  switch (status) {
    case 0: // Queued
    case 1: // Processing
    case 2: // Encoding
      return "processing";
    case 3: // Finished
    case 4: // Resolution finished (first playable)
      return "ready";
    case 5: // Failed
      return "failed";
    case 6: // PresignedUploadStarted
      return "uploading";
    case 7: // PresignedUploadFinished
      return "uploaded";
    case 8: // PresignedUploadFailed
      return "failed";
    default:
      return null; // 9 CaptionsGenerated, 10 TitleOrDescriptionGenerated: no state change
  }
}
