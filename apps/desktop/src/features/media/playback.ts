import type { QueryClient } from "@tanstack/react-query";
import { edge, type PlaybackToken } from "@/lib/edge";
import { queryKeys } from "@/lib/queryKeys";

/** A token is handed to a player only while it has this long left: enough to load the embed. */
const EXPIRY_MARGIN_MS = 60_000;

function usableFor(token: PlaybackToken | undefined): number {
  return token ? Math.max(0, token.expires * 1000 - Date.now() - EXPIRY_MARGIN_MS) : 0;
}

/**
 * A signed embed URL for a ready video (the Bunny library uses token authentication). A token is
 * reused until shortly before the `expires` the function stamped on it, and minted again after:
 * a player loading with an expired token shows nothing.
 */
export async function fetchPlaybackUrl(queryClient: QueryClient, videoId: string): Promise<string> {
  const token = await queryClient.fetchQuery({
    queryKey: queryKeys.playbackToken(videoId),
    queryFn: () => edge.playbackToken(videoId),
    staleTime: (query) => usableFor(query.state.data),
    retry: 1,
  });
  if (!token.embedUrl) throw new Error("Couldn't load the player.");
  return token.embedUrl;
}

/** The signed embed URL already in hand for a video, if its token is still usable; no request. */
export function cachedPlaybackUrl(queryClient: QueryClient, videoId: string): string | null {
  const token = queryClient.getQueryData<PlaybackToken>(queryKeys.playbackToken(videoId));
  return token?.embedUrl && usableFor(token) > 0 ? token.embedUrl : null;
}
