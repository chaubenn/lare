import type { Post } from "@lare/supabase-types";
import type { QueryData } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useUser } from "@/features/auth/AuthProvider";
import { postMediaKey, requestOgSnapshot } from "@/features/posts/media";
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
export const trackedKey = (userId: string) => ["tracked", userId] as const;

/**
 * Problems the extension has tracked passively and that have not been posted yet.
 *
 * They live on the user's single `is_practice_inbox` session; publishing moves
 * them off it, which is exactly what makes them disappear from this list.
 */
function trackedQuery(userId: string) {
  return supabase
    .from("session_problems")
    .select("*, submissions(*), sessions!inner(id, user_id, is_practice_inbox)")
    .eq("sessions.user_id", userId)
    .eq("sessions.is_practice_inbox", true)
    .order("opened_at", { ascending: false });
}

export type TrackedProblemRow = QueryData<ReturnType<typeof trackedQuery>>[number];

export function useTrackedProblems() {
  const { userId } = useUser();
  return useQuery({
    queryKey: trackedKey(userId),
    queryFn: async () => {
      const { data, error } = await trackedQuery(userId);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Turn a selection of tracked problems into one draft post. The RPC mints the
 * session the post owns and moves the chosen problems onto it in a single
 * transaction, so a half-published selection is not possible.
 */
export function usePublishTracked() {
  const queryClient = useQueryClient();
  const { userId } = useUser();
  return useMutation({
    mutationFn: async ({
      sessionProblemIds,
      title,
    }: {
      sessionProblemIds: string[];
      title?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("publish_practice_problems", {
        problem_ids: sessionProblemIds,
        post_title: title ?? null,
      });
      if (error) throw error;
      if (!data) throw new Error("No post was created");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trackedKey(userId) });
      void queryClient.invalidateQueries({ queryKey: draftsKey(userId) });
    },
  });
}

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
      .channel(`posts:${userId}:${crypto.randomUUID()}`)
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

/**
 * The optional extras an author switches on for a post: the AI insights, the generated session
 * card, and the AI percentages drawn on that card. They are saved as they are toggled (not with
 * the form), because the card has to be regenerated or removed to match.
 */
export interface PostExtras {
  include_ai_insights: boolean;
  include_og_card: boolean;
  og_show_ai_scores: boolean;
}

export function useSetPostExtras(postId: string) {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PostExtras>) => {
      const { error } = await supabase.from("posts").update(patch).eq("id", postId);
      if (error) throw error;
      // Both card switches change what the stored card is (or whether there is one at all), so
      // let og-snapshot redraw or clean up. `force`, because the existing card is now stale.
      if ("include_og_card" in patch || "og_show_ai_scores" in patch) {
        await requestOgSnapshot(postId, true);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: draftKey(postId) });
      void queryClient.invalidateQueries({ queryKey: draftsKey(userId) });
      void queryClient.invalidateQueries({ queryKey: postMediaKey(postId) });
    },
  });
}

export interface PublishInput {
  id: string;
  title: string;
  body: string;
  visibility: Post["visibility"];
  /** Show the attached demo video as a slide on the post. */
  showVideo: boolean;
  /** Show the interview's summary video as a slide, ahead of the full recording. */
  showDemoVideo: boolean;
  /** Photo used as the cover; null falls back to the generated session card. */
  coverMediaId: string | null;
}

/** The columns the draft form owns, shared by "save draft" and "publish". */
function postPatch(edit: PublishInput) {
  return {
    title: edit.title.trim() || null,
    body: edit.body.trim() || null,
    visibility: edit.visibility,
    show_video: edit.showVideo,
    show_demo_video: edit.showDemoVideo,
    cover_media_id: edit.coverMediaId,
  };
}

export function usePublishDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (edit: PublishInput) => {
      const { data, error } = await supabase
        .from("posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          ...postPatch(edit),
        })
        .eq("id", edit.id)
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["drafts"] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      // Every published post gets its session card (OG image) pre-generated and attached.
      // `force`, because a card previewed while drafting was drawn from the older title/body.
      void requestOgSnapshot(data.id, true).then(() =>
        queryClient.invalidateQueries({ queryKey: postMediaKey(data.id) }),
      );
    },
  });
}

export function useSaveDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (edit: PublishInput) => {
      const { error } = await supabase.from("posts").update(postPatch(edit)).eq("id", edit.id);
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
