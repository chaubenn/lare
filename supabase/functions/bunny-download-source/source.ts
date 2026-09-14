import type { BunnyVideo } from "../_shared/bunny.ts";
import { HttpError } from "../_shared/http.ts";

/** Exact-file CDN token, not the unrelated Stream iframe token. */
export async function sourceUrl(video: BunnyVideo, host: string, key: string) {
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
  const expires = Math.floor(Date.now() / 1000) + 300;
  const signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  for (const resolution of resolutions) {
    const url = new URL(`https://${host}/${video.guid}/play_${resolution}.mp4`);
    // Refuse to issue a link if the very same file is publicly downloadable.
    const publicProbe = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (![401, 403].includes(publicProbe.status))
      throw new HttpError(
        "Source download requires CDN token authentication; verify library security settings",
        503,
      );
    const mac = await crypto.subtle.sign(
      "HMAC",
      signingKey,
      new TextEncoder().encode(url.pathname + expires),
    );
    const token = btoa(String.fromCharCode(...new Uint8Array(mac)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    url.searchParams.set("token", `HS256-${token}`);
    url.searchParams.set("expires", String(expires));
    const probe = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (probe.status === 404) continue;
    if (!probe.ok)
      throw new HttpError(
        "Bunny source access denied; verify CDN key, direct access and referrer settings",
        503,
      );
    return { url: url.toString(), expires, kind: "encoded-mp4" as const, resolution };
  }
  throw new HttpError("MP4 source is not available yet", 409);
}
