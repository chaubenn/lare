import { formatLocalTimestamp } from "@lare/shared";
import { cn } from "@lare/ui";
import { Heart, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast/ToastProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { SectionTitle } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Field";
import { errorMessage } from "@/lib/supabase";
import {
  type PostComment,
  useAddComment,
  useComments,
  useDeleteComment,
  useToggleLike,
  useUpdateComment,
  useViewerLike,
} from "./social";

/** Like button + comment count, mirroring the row the web feed shows. */
export function PostActions({
  postId,
  userId,
  likeCount,
  commentCount,
}: {
  postId: string;
  userId: string;
  likeCount: number;
  commentCount: number;
}) {
  const { toast } = useToast();
  const liked = useViewerLike(postId, userId);
  const toggle = useToggleLike(postId);
  // The mutation answers with the authoritative count; until then show the row's own value.
  const count = toggle.data?.like_count ?? likeCount;
  const isLiked = toggle.data?.liked ?? liked.data ?? false;

  return (
    <div className="flex items-center gap-4 text-sm text-zinc-400">
      <button
        type="button"
        aria-pressed={isLiked}
        aria-label={isLiked ? "Unlike" : "Like"}
        disabled={toggle.isPending}
        onClick={() =>
          toggle.mutate(undefined, {
            onError: (e) =>
              toast({ title: "Couldn't like", description: errorMessage(e), variant: "error" }),
          })
        }
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:text-zinc-100",
          isLiked && "text-rose-400 hover:text-rose-300",
        )}
      >
        <Heart className={cn("size-4", isLiked && "fill-current")} aria-hidden />
        <span className="tabular-nums">{count}</span>
      </button>
      <span className="inline-flex items-center gap-1.5 px-2 py-1">
        <MessageCircle className="size-4" aria-hidden />
        <span className="tabular-nums">{commentCount}</span>
      </span>
    </div>
  );
}

/** Comment thread with inline editing for your own comments. */
export function CommentsSection({
  postId,
  userId,
  isPostOwner,
}: {
  postId: string;
  userId: string;
  isPostOwner: boolean;
}) {
  const { toast } = useToast();
  const comments = useComments(postId);
  const add = useAddComment(postId, userId);
  const [draft, setDraft] = useState("");

  const fail = (title: string) => (e: unknown) =>
    toast({ title, description: errorMessage(e), variant: "error" });

  const list = comments.data ?? [];

  return (
    <section className="space-y-3">
      <SectionTitle>
        {list.length} {list.length === 1 ? "comment" : "comments"}
      </SectionTitle>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim().length === 0) return;
          add.mutate(draft, {
            onSuccess: () => setDraft(""),
            onError: fail("Couldn't post the comment"),
          });
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          placeholder="Add a comment"
          aria-label="Add a comment"
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={add.isPending}
          disabled={draft.trim().length === 0}
        >
          Comment
        </Button>
      </form>

      <ul className="space-y-4">
        {list.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            postId={postId}
            canEdit={comment.user_id === userId}
            canDelete={comment.user_id === userId || isPostOwner}
          />
        ))}
      </ul>
    </section>
  );
}

function CommentRow({
  comment,
  postId,
  canEdit,
  canDelete,
}: {
  comment: PostComment;
  postId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { toast } = useToast();
  const update = useUpdateComment(postId);
  const remove = useDeleteComment(postId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const author = comment.profiles;
  const name = author?.display_name ?? (author?.handle ? `@${author.handle}` : "Someone");
  const fail = (title: string) => (e: unknown) =>
    toast({ title, description: errorMessage(e), variant: "error" });

  return (
    <li className="flex gap-3">
      <Avatar url={author?.avatar_url} name={name} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-500">
          <span className="font-medium text-zinc-200">{name}</span>
          <span>{formatLocalTimestamp(comment.created_at)}</span>
          {comment.edited_at ? <span>· edited</span> : null}
        </div>

        {editing ? (
          <div className="mt-1.5 space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={2000}
              aria-label="Edit comment"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={update.isPending}
                disabled={draft.trim().length === 0}
                onClick={() =>
                  update.mutate(
                    { id: comment.id, body: draft },
                    { onSuccess: () => setEditing(false), onError: fail("Couldn't save") },
                  )
                }
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1 select-text whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
            {comment.body}
          </p>
        )}

        {(canEdit || canDelete) && !editing ? (
          <div className="mt-1 flex gap-3 text-xs text-zinc-500">
            {canEdit ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 hover:text-zinc-300"
              >
                <Pencil className="size-3" aria-hidden />
                Edit
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(comment.id, { onError: fail("Couldn't delete the comment") })
                }
                className="inline-flex items-center gap-1 hover:text-rose-300"
              >
                <Trash2 className="size-3" aria-hidden />
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
