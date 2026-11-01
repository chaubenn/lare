/**
 * The command palette's local search index (`src-tauri/src/search.rs`). Every call rejects when
 * the index cannot run on this machine, and the palette falls back to its own substring search.
 */

import type { SearchDoc, SearchHit, SearchKind } from "@lare/shared";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./tauri";

/** How far the transcripts and reviews have been indexed; the rest is re-sent on every sync. */
export interface SearchSyncState {
  transcriptsSince: string | null;
  reviewsSince: string | null;
}

function requireTauri(): void {
  if (!inTauri) throw new Error("the search index runs in the desktop app only");
}

export async function searchOpen(userId: string): Promise<SearchSyncState> {
  requireTauri();
  return invoke<SearchSyncState>("search_open", { userId });
}

export async function searchIndex(
  docs: SearchDoc[],
  replaceKinds: SearchKind[],
  sync: SearchSyncState,
): Promise<void> {
  requireTauri();
  await invoke("search_index", { docs, replaceKinds, sync });
}

export async function searchQuery(text: string): Promise<SearchHit[]> {
  requireTauri();
  return invoke<SearchHit[]>("search_query", { text });
}
