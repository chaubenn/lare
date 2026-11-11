import { useNavigate } from "react-router";
import { confirm } from "@/components/ui/Confirm";
import { notify, notifyError } from "@/lib/notices";
import { routes } from "@/lib/routes";
import { isPracticePost, useDeletePracticePost } from "./postActions";
import { useDeletePost } from "./queries";

function confirmDelete(practice: boolean): Promise<boolean> {
  return confirm({
    title: "Delete post",
    message: practice
      ? "Delete this post? It disappears from the feed and your profile, and its problems go back to Tracked problems so you can post them again."
      : "Delete this post? It disappears from the feed and your profile. The session stays in your account.",
    confirmLabel: "Delete",
    cancelLabel: "Keep",
    destructive: true,
  });
}

/**
 * Confirm, delete, then leave the post's pages for the profile it was on. A practice post's
 * problems return to Tracked problems (see `isPracticePost`).
 */
export function useDeletePostFlow(postId: string, sessionClient: string | null | undefined) {
  const practice = isPracticePost(sessionClient);
  const removePost = useDeletePost();
  const removePractice = useDeletePracticePost();
  const navigate = useNavigate();

  const deletePost = async () => {
    if (!(await confirmDelete(practice))) return;
    const handlers = {
      onSuccess: () => {
        notify({
          title: "Post deleted",
          description: practice ? "Its problems are back in Tracked problems." : undefined,
          variant: "success",
        });
        void navigate(routes.profile, { replace: true });
      },
      onError: (e: Error) => notifyError("Couldn't delete", e),
    };
    if (practice) removePractice.mutate(postId, handlers);
    else removePost.mutate(postId, handlers);
  };

  return { deletePost, isPending: removePost.isPending || removePractice.isPending };
}
