/**
 * Post actions that go beyond editing: sharing a link, taking a post back to a draft, and
 * deleting a practice post so its problems return to Tracked problems.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "@/features/notifications/notices";
import { copyText } from "@/lib/clipboard";
import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { postKey } from "./queries";

/** Whether the app offers "Copy link"; the page it points at is lare.fyi/p/<slug>. */
export const SHARE_LINKS = true;

/**
 * Public web address of a post. The short slug is the canonical handle (`/p/<slug>`, see
 * supabase/migrations/0012_post_slugs.sql); the web app also resolves the UUID and redirects.
 */
export function postUrl(slug: string): string {
  return `${env.VITE_SITE_URL.replace(/\/+$/, "")}/p/${slug}`;
}

/** Copy a post's web link and say whether it worked. */
export function useCopyPostLink() {
  const { notify } = useNotify();
  return async (slug: string) => {
    const ok = await copyText(postUrl(slug));
    notify(
      ok
        ? { title: "Link copied", variant: "success" }
        : { title: "Couldn't copy the link", description: postUrl(slug), variant: "error" },
    );
  };
}

/**
 * A post made from Tracked problems owns the session `publish_practice_problems` minted for it
 * (`client = 'inbox'`), so deleting one goes through `delete_practice_post`, which puts its
 * problems back in Tracked problems. The RPC refuses anything else, so interviews and older
 * practice posts keep the plain delete: their session stays in the account either way.
 */
export function isPracticePost(sessionClient: string | null | undefined): boolean {
  return sessionClient === "inbox";
}

/** Every list a post, a draft or a tracked problem shows up in. */
function invalidatePostLists(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of [
    "feed",
    "user-posts",
    "profile-stats",
    "sessions",
    "session",
    "drafts",
    "draft",
    "tracked",
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useDeletePracticePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.rpc("delete_practice_post", { p_post_id: postId });
      if (error) throw error;
    },
    onSuccess: (_data, postId) => {
      queryClient.removeQueries({ queryKey: postKey(postId) });
      invalidatePostLists(queryClient);
    },
  });
}

/**
 * Published (or pending) post back to a draft. Its likes and comments are kept but hidden until
 * it is republished. Always the RPC: the database refuses a direct published-to-draft update.
 */
export function useUnpublishPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.rpc("unpublish_post", { p_post_id: postId });
      if (error) throw error;
    },
    onSuccess: (_data, postId) => {
      void queryClient.invalidateQueries({ queryKey: postKey(postId) });
      invalidatePostLists(queryClient);
    },
  });
}
