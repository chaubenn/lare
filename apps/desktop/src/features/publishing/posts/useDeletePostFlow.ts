import { ask } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router";
import { useNotify } from "@/features/notifications/notices";
import { errorMessage } from "@/lib/supabase";
import { inTauri } from "@/lib/tauri";
import { useDeletePost } from "./queries";

async function confirmDelete(): Promise<boolean> {
  const message =
    "Delete this post? It disappears from the feed and your profile. The session stays in your account.";
  if (inTauri) {
    return ask(message, {
      title: "Delete post",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Keep",
    });
  }
  return window.confirm(message);
}

/** Confirm, delete, then leave the post's pages for the profile it was on. */
export function useDeletePostFlow(postId: string) {
  const remove = useDeletePost();
  const navigate = useNavigate();
  const { notify } = useNotify();

  const deletePost = async () => {
    if (!(await confirmDelete())) return;
    remove.mutate(postId, {
      onSuccess: () => {
        notify({ title: "Post deleted", variant: "success" });
        void navigate("/profile", { replace: true });
      },
      onError: (e) =>
        notify({ title: "Couldn't delete", description: errorMessage(e), variant: "error" }),
    });
  };

  return { deletePost, isPending: remove.isPending };
}
