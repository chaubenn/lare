import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/features/auth/AuthProvider";
import type { PersonSummary } from "@/features/profile/follows";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/lib/supabase";

const PERSON_COLUMNS = "id, handle, display_name, avatar_url, is_private";

// ---------------------------------------------------------------------------
// Following / followers
// ---------------------------------------------------------------------------
function followingQuery(userId: string) {
  return supabase
    .from("follows")
    .select(`created_at, status, profiles!follows_followee_id_fkey(${PERSON_COLUMNS})`)
    .eq("follower_id", userId)
    .order("created_at", { ascending: false });
}

function followersQuery(userId: string) {
  return supabase
    .from("follows")
    .select(`created_at, profiles!follows_follower_id_fkey(${PERSON_COLUMNS})`)
    .eq("followee_id", userId)
    .eq("status", "accepted")
    .order("created_at", { ascending: false });
}

/** Everyone the viewer follows, including the requests still waiting for approval. */
export function useFollowing() {
  const { userId } = useUser();
  return useQuery({
    queryKey: queryKeys.following.of(userId),
    queryFn: async () => {
      const { data, error } = await followingQuery(userId);
      if (error) throw error;
      return data;
    },
  });
}

export function useFollowers() {
  const { userId } = useUser();
  return useQuery({
    queryKey: queryKeys.followers.of(userId),
    queryFn: async () => {
      const { data, error } = await followersQuery(userId);
      if (error) throw error;
      return data;
    },
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
/** Handles are `[a-z0-9_]`; keep the term to characters PostgREST's `or` filter parses. */
function sanitiseSearch(raw: string): string {
  return raw
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_ -]/g, " ")
    .trim()
    .slice(0, 40);
}

/** `profiles` is a public directory under RLS, so the search runs straight against the table. */
export function useProfileSearch(term: string) {
  const { userId } = useUser();
  const query = sanitiseSearch(term);
  return useQuery({
    queryKey: queryKeys.profileSearch.of(query),
    enabled: query.length > 0,
    queryFn: async (): Promise<PersonSummary[]> => {
      const like = `%${query}%`;
      const { data, error } = await supabase
        .from("profiles")
        .select(PERSON_COLUMNS)
        .not("handle", "is", null)
        .neq("id", userId)
        .or(`handle.ilike.${like},display_name.ilike.${like}`)
        .order("handle")
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });
}
