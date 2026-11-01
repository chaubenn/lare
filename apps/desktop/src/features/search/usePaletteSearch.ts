import {
  arrangeHits,
  fallbackSearch,
  SEARCH_MIN_QUERY,
  type SearchGroup,
  type SearchHit,
  searchText,
} from "@lare/shared";
import { useEffect, useState } from "react";
import { searchQuery } from "@/lib/search";
import { searchFallbackDocs } from "./sync";

const DEBOUNCE_MS = 80;

async function findHits(text: string): Promise<SearchHit[]> {
  try {
    return await searchQuery(text);
  } catch {
    return fallbackSearch(searchFallbackDocs(), text);
  }
}

/** The palette's search results for `query`, grouped for display. Empty below two characters. */
export function usePaletteSearch(query: string): SearchGroup[] {
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  useEffect(() => {
    const text = searchText(query);
    if (text.replace(/[^\p{L}\p{N}]/gu, "").length < SEARCH_MIN_QUERY) {
      setGroups([]);
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      void findHits(text).then((hits) => {
        if (!stale) setGroups(arrangeHits(hits));
      });
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [query]);
  return groups;
}
