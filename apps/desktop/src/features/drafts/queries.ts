import type { Post } from "@lare/supabase-types";
import type { QueryData } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useUser } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

/** Post + the whole session it summarises (problems and their submissions). */
export const DRAFT_SELECT = "*, sessions(*, session_problems(*, submissions(*)))" as const;

function draftsQuery(userId: string) {
  return supabase
    .from("posts")
    .select(DRAFT_SELECT)
    .eq("user_id", userId)
    .eq("status", "draft")
    .order("created_at", { ascending: false });
}

function draftQuery(id: string) {
  return supabase.from("posts").select(DRAFT_SELECT).eq("id", id).maybeSingle();
}

export type Draft = QueryData<ReturnType<typeof draftsQuery>>[number];
export type DraftSession = NonNullable<Draft["sessions"]>;

export const draftsKey = (userId: string) => ["drafts", userId] as const;
export const draftKey = (id: string) => ["draft", id] as const;

export function useDrafts() {
  const { userId } = useUser();
  return useQuery({
    queryKey: draftsKey(userId),
    queryFn: async () => {
      const { data, error } = await draftsQuery(userId);
      if (error) throw error;
      return data;
    },
  });
}

export function useDraft(id: string) {
  return useQuery({
    queryKey: draftKey(id),
    queryFn: async () => {
      const { data, error } = await draftQuery(id);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Realtime: the extension inserts a draft when a session ends. Any change to my posts
 * invalidates the drafts list so it shows up within a couple of seconds.
 */
export function useDraftsRealtime() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`posts:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "posts", filter: `user_id=eq.${userId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["drafts"] });
          void queryClient.invalidateQueries({ queryKey: ["draft"] });
          void queryClient.invalidateQueries({ queryKey: ["sessions"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}

export interface PublishInput {
  id: string;
  title: string;
  body: string;
  visibility: Post["visibility"];
}

export function usePublishDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title, body, visibility }: PublishInput) => {
      const { data, error } = await supabase
        .from("posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          title: title.trim() || null,
          body: body.trim() || null,
          visibility,
        })
        .eq("id", id)
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["drafts"] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useSaveDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title, body, visibility }: PublishInput) => {
      const { error } = await supabase
        .from("posts")
        .update({ title: title.trim() || null, body: body.trim() || null, visibility })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: draftKey(vars.id) });
      void queryClient.invalidateQueries({ queryKey: ["drafts"] });
    },
  });
}

export function useDeleteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["drafts"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
