"use client";

/**
 * Recordings made in this tab, kept in memory as object URLs so the author can watch them while
 * the cloud copy processes. They last until the page is reloaded; nothing is written to disk.
 */

import { useSyncExternalStore } from "react";

const previews = new Map<string, string>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Remember `chunks` as the local preview of `videoId`. */
export function rememberLocalPreview(videoId: string, chunks: Blob[], mimeType: string): void {
  const previous = previews.get(videoId);
  if (previous) URL.revokeObjectURL(previous);
  previews.set(videoId, URL.createObjectURL(new Blob(chunks, { type: mimeType })));
  notify();
}

/** Drop the preview once the cloud copy is ready. */
export function forgetLocalPreview(videoId: string): void {
  const url = previews.get(videoId);
  if (!url) return;
  URL.revokeObjectURL(url);
  previews.delete(videoId);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocalPreview(videoId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => previews.get(videoId) ?? null,
    () => null,
  );
}
