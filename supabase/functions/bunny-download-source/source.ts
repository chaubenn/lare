import type { BunnyVideo } from "../_shared/bunny.ts";
import { HttpError } from "../_shared/http.ts";

/**
 * Pick a direct CDN MP4 rendition for a video the caller already owns.
 *
 * This URL is **not** a capability, and an earlier version of this file was wrong to treat it
 * as one. It signed an exact-file CDN token and refused to hand out a link unless an unsigned
 * HEAD came back 401/403 — reading that rejection as proof that CDN token authentication was
 * guarding the file. It is not: the library rejects requests with **no `Referer` header** and
 * serves every request that carries one, whatever it says. The check passed for the wrong
 * reason, and the signed link it produced was then rejected for the same reason, because Deno
 * sends no referrer either.
 *
 * CDN token authentication cannot be switched on to fix that. It applies to every direct URL
 * including the HLS playlist and segments, which are exactly what Bunny's own embed player
 * fetches — and the player has no way to sign them. Turning it on returns 403 for playback of
 * every video in the library. Verified against this library; see docs/cloud-studio.md.
 *
 * So the GUID is the only secret protecting the bytes, and every authorized viewer already has
 * it from the embed URL. Ownership is enforced by the caller before this runs; what this adds
 * is rendition selection and an existence check, not access control. Returning the URL to its
 * owner grants them nothing they could not already construct.
 */
export async function sourceUrl(video: BunnyVideo, host: string, referer: string) {
  if (!/^[a-z0-9-]+\.b-cdn\.net$/.test(host) || !/^[0-9a-f-]{36}$/i.test(video.guid))
    throw new HttpError("Invalid source configuration", 503);
  const resolutions = (video.availableResolutions ?? "")
    .split(",")
    .filter((r) => /^(240|360|480|720|1080)p$/.test(r))
    .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
  if (
    !video.hasMP4Fallback ||
    !video.outputCodecs?.split(",").includes("x264") ||
    !resolutions.length
  )
    throw new HttpError(
      "No supported MP4 source. Enable H.264 and MP4 Fallback before upload; existing videos may need re-encoding from a retained original.",
      409,
    );
  for (const resolution of resolutions) {
    const url = `https://${host}/${video.guid}/play_${resolution}.mp4`;
    // The referrer is what the library gates on, so the probe has to carry the same one the
    // desktop importer will send. Probing without it would 403 on a file that is fine.
    const probe = await fetch(url, {
      method: "HEAD",
      headers: { Referer: referer },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (probe.status === 404) continue;
    if (!probe.ok)
      throw new HttpError(
        "Bunny source access denied; verify the library's allowed referrers and direct access settings",
        503,
      );
    return { url, referer, kind: "encoded-mp4" as const, resolution };
  }
  throw new HttpError("MP4 source is not available yet", 409);
}
