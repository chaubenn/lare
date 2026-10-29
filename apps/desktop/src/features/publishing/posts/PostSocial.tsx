import { formatLocalTimestamp } from "@lare/shared";
import { cn } from "@lare/ui";
import { Heart, MessageCircle, Pencil, Reply, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { SectionTitle } from "@/components/ui/Card";
import { useNotify } from "@/features/notifications/notices";
import { errorMessage } from "@/lib/supabase";
import { CommentText, MentionTextarea } from "./Mentions";
import {
  type PostComment,
  useAddComment,
  useComments,
  useDeleteComment,
  useToggleLike,
  useUpdateComment,
  useViewerLike,
} from "./social";

/** Where the composer lives, so the comment tally can hand focus straight to it. */
const COMPOSER_ID = "post-comment-composer";

/**
 * The meta row under the post: one tally you can press to like, one that jumps to
 * the thread. Padded for the hit target, then pulled back by the same amount so the
 * icons align to the text column rather than sitting nudged inside it.
 */
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
  const { notify } = useNotify();
  const liked = useViewerLike(postId, userId);
  const toggle = useToggleLike(postId);
  // The mutation answers with the authoritative count; until then show the row's own value.
  const count = toggle.data?.like_count ?? likeCount;
  const isLiked = toggle.data?.liked ?? liked.data ?? false;

  const tally =
    "inline-flex items-center gap-1.5 rounded-[var(--lare-r-1)] px-2 py-1 text-[var(--text-secondary)] transition-colors duration-[var(--duration-quick)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] disabled:opacity-60";

  return (
    <div className="-ml-2 flex items-center gap-1 text-sm">
      <button
        type="button"
        aria-pressed={isLiked}
        aria-label={isLiked ? "Unlike" : "Like"}
        disabled={toggle.isPending}
        onClick={() =>
          toggle.mutate(undefined, {
            onError: (e) =>
              notify({ title: "Couldn't like", description: errorMessage(e), variant: "error" }),
          })
        }
        className={cn(
          tally,
          isLiked && "text-[var(--lare-danger)] hover:text-[var(--lare-danger)]",
        )}
      >
        <Heart className={cn("size-4", isLiked && "fill-current")} aria-hidden />
        <span className="tabular-nums">{count}</span>
      </button>
      <button
        type="button"
        className={tally}
        aria-label={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}, go to the thread`}
        onClick={() => document.getElementById(COMPOSER_ID)?.focus()}
      >
        <MessageCircle className="size-4" aria-hidden />
        <span className="tabular-nums">{commentCount}</span>
      </button>
    </div>
  );
}

/**
 * Comment thread with inline editing for your own comments. Replies sit one level under the
 * comment they answer; `@handle` tells that person, and a reply tells everyone in its thread.
 */
export function CommentsSection({
  postId,
  userId,
  isPostOwner,
}: {
  postId: string;
  userId: string;
  isPostOwner: boolean;
}) {
  const { notify } = useNotify();
  const comments = useComments(postId);
  const add = useAddComment(postId, userId);
  const [draft, setDraft] = useState("");
  // Which top-level comment has its reply box open, and what the box starts with.
  const [replyTo, setReplyTo] = useState<{ parentId: string; prefill: string } | null>(null);

  const fail = (title: string) => (e: unknown) =>
    notify({ title, description: errorMessage(e), variant: "error" });

  const list = comments.data ?? [];
  const topLevel = list.filter((c) => !c.parent_id);
  const replies = new Map<string, PostComment[]>();
  for (const c of list) {
    if (!c.parent_id) continue;
    const thread = replies.get(c.parent_id);
    if (thread) thread.push(c);
    else replies.set(c.parent_id, [c]);
  }

  // Replying to a reply stays in the same thread, addressed to the person you answered.
  const startReply = (parentId: string, to: PostComment) => {
    const handle = to.profiles?.handle;
    setReplyTo({ parentId, prefill: handle && to.user_id !== userId ? `@${handle} ` : "" });
  };

  return (
    <section className="space-y-3">
      {/* The tally lives in the action row; repeating it here was the same number twice. */}
      <SectionTitle>Comments</SectionTitle>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim().length === 0) return;
          add.mutate(
            { body: draft },
            {
              onSuccess: () => setDraft(""),
              onError: fail("Couldn't post the comment"),
            },
          );
        }}
      >
        <MentionTextarea
          id={COMPOSER_ID}
          value={draft}
          onValueChange={setDraft}
          maxLength={2000}
          placeholder="Add a comment. Type @ to mention someone."
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
        {topLevel.map((comment) => {
          const thread = replies.get(comment.id) ?? [];
          const replying = replyTo?.parentId === comment.id;
          return (
            <li key={comment.id} className="space-y-3">
              <CommentRow
                comment={comment}
                postId={postId}
                canEdit={comment.user_id === userId}
                canDelete={comment.user_id === userId || isPostOwner}
                onReply={() => startReply(comment.id, comment)}
              />
              {thread.length > 0 || replying ? (
                <ul className="ml-10 space-y-3 border-l border-[var(--border)] pl-4">
                  {thread.map((reply) => (
                    <li key={reply.id}>
                      <CommentRow
                        comment={reply}
                        postId={postId}
                        canEdit={reply.user_id === userId}
                        canDelete={reply.user_id === userId || isPostOwner}
                        onReply={() => startReply(comment.id, reply)}
                      />
                    </li>
                  ))}
                  {replying ? (
                    <li>
                      <ReplyComposer
                        key={replyTo.prefill}
                        postId={postId}
                        userId={userId}
                        parentId={comment.id}
                        prefill={replyTo.prefill}
                        onDone={() => setReplyTo(null)}
                      />
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The inline box under a thread. Posting or cancelling closes it. */
function ReplyComposer({
  postId,
  userId,
  parentId,
  prefill,
  onDone,
}: {
  postId: string;
  userId: string;
  parentId: string;
  prefill: string;
  onDone: () => void;
}) {
  const { notify } = useNotify();
  const add = useAddComment(postId, userId);
  const [draft, setDraft] = useState(prefill);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim().length === 0) return;
        add.mutate(
          { body: draft, parentId },
          {
            onSuccess: onDone,
            onError: (err) =>
              notify({
                title: "Couldn't post the reply",
                description: errorMessage(err),
                variant: "error",
              }),
          },
        );
      }}
    >
      <MentionTextarea
        value={draft}
        onValueChange={setDraft}
        maxLength={2000}
        placeholder="Write a reply"
        aria-label="Write a reply"
        className="min-h-16"
        autoFocus
        onFocus={(e) => {
          const end = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(end, end);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={add.isPending}
          disabled={draft.trim().length === 0}
        >
          Reply
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One comment. Editing happens in place; the author and the post's owner can both delete. */
function CommentRow({
  comment,
  postId,
  canEdit,
  canDelete,
  onReply,
}: {
  comment: PostComment;
  postId: string;
  canEdit: boolean;
  canDelete: boolean;
  onReply: () => void;
}) {
  const { notify } = useNotify();
  const update = useUpdateComment(postId);
  const remove = useDeleteComment(postId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const author = comment.profiles;
  const name = author?.display_name ?? (author?.handle ? `@${author.handle}` : "Someone");
  const fail = (title: string) => (e: unknown) =>
    notify({ title, description: errorMessage(e), variant: "error" });

  return (
    <div id={`comment-${comment.id}`} className="flex gap-3">
      <Avatar url={author?.avatar_url} name={name} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--text-tertiary)]">
          <span className="font-medium text-[var(--text)]">{name}</span>
          <span>{formatLocalTimestamp(comment.created_at)}</span>
          {comment.edited_at ? <span>· edited</span> : null}
        </div>

        {editing ? (
          <div className="mt-1.5 space-y-2">
            <MentionTextarea
              value={draft}
              onValueChange={setDraft}
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
          <p className="mt-1 select-text whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
            <CommentText body={comment.body} />
          </p>
        )}

        {!editing ? (
          <div className="mt-1 flex gap-3 text-xs text-[var(--text-tertiary)]">
            <button
              type="button"
              onClick={onReply}
              className="inline-flex items-center gap-1 rounded-[var(--lare-r-1)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
            >
              <Reply className="size-3" aria-hidden />
              Reply
            </button>
            {canEdit ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-[var(--lare-r-1)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
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
                className="inline-flex items-center gap-1 rounded-[var(--lare-r-1)] hover:text-[var(--lare-danger)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
              >
                <Trash2 className="size-3" aria-hidden />
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
