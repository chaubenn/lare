import { formatLocalTimestamp } from "@lare/shared";
import { cn } from "@lare/ui";
import { Heart, MessageCircle, Pencil, Reply, Trash2 } from "@lare/ui/icons";
import { Avatar, Button, SectionTitle } from "@lare/ui/primitives";
import { useState } from "react";
import { Link } from "react-router";
import { RichText } from "@/components/rich/RichText";
import { RichTextEditor } from "@/components/rich/RichTextEditor";
import { confirm } from "@/components/ui/Confirm";
import { ProfileHoverCard } from "@/features/profile/ProfileHoverCard";
import { COMMENT_MAX } from "@/features/publishing/drafts/validation";
import { notifyError } from "@/lib/notices";
import { routes } from "@/lib/routes";
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
            onError: (e) => notifyError("Couldn't like", e),
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
  const comments = useComments(postId);
  const add = useAddComment(postId, userId);
  const [draft, setDraft] = useState("");
  // Which top-level comment has its reply box open, and what the box starts with.
  const [replyTo, setReplyTo] = useState<{ parentId: string; prefill: string } | null>(null);

  const fail = (title: string) => (e: unknown) => notifyError(title, e);

  const post = () => {
    if (!commentReady(draft) || add.isPending) return;
    add.mutate(
      { body: draft },
      {
        onSuccess: () => setDraft(""),
        onError: fail("Couldn't post the comment"),
      },
    );
  };

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
          post();
        }}
      >
        <RichTextEditor
          id={COMPOSER_ID}
          value={draft}
          onValueChange={setDraft}
          mentions
          minHeight="min-h-20"
          placeholder="Add a comment. Type @ to mention someone."
          ariaLabel="Add a comment"
          onSubmitShortcut={post}
        />
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={add.isPending}
            disabled={!commentReady(draft)}
          >
            Comment
          </Button>
          <CommentLength body={draft} />
        </div>
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
                replies={thread.length}
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
  const add = useAddComment(postId, userId);
  const [draft, setDraft] = useState(prefill);

  const post = () => {
    if (!commentReady(draft) || add.isPending) return;
    add.mutate(
      { body: draft, parentId },
      {
        onSuccess: onDone,
        onError: (err) => notifyError("Couldn't post the reply", err),
      },
    );
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        post();
      }}
    >
      <RichTextEditor
        value={draft}
        onValueChange={setDraft}
        mentions
        minHeight="min-h-16"
        placeholder="Write a reply"
        ariaLabel="Write a reply"
        autoFocus
        onSubmitShortcut={post}
        onEscape={onDone}
      />
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={add.isPending}
          disabled={!commentReady(draft)}
        >
          Reply
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <CommentLength body={draft} />
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
  replies = 0,
  onReply,
}: {
  comment: PostComment;
  postId: string;
  canEdit: boolean;
  canDelete: boolean;
  /** How many replies a delete takes with it: the database removes them alongside. */
  replies?: number;
  onReply: () => void;
}) {
  const update = useUpdateComment(postId);
  const remove = useDeleteComment(postId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const author = comment.profiles;
  const name = author?.display_name ?? (author?.handle ? `@${author.handle}` : "Someone");
  const fail = (title: string) => (e: unknown) => notifyError(title, e);

  const save = () => {
    if (!commentReady(draft) || update.isPending) return;
    update.mutate(
      { id: comment.id, body: draft },
      { onSuccess: () => setEditing(false), onError: fail("Couldn't save") },
    );
  };
  const cancelEdit = () => {
    setDraft(comment.body);
    setEditing(false);
  };
  const ownComment = canEdit;
  const askToDelete = async () => {
    const ok = await confirm({
      title: "Delete comment?",
      message: [
        ownComment ? "Your comment will be removed." : `${name}'s comment will be removed.`,
        replies > 0
          ? `${replies === 1 ? "Its reply goes" : `All ${replies} replies go`} with it.`
          : "",
        "This can't be undone.",
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) remove.mutate(comment.id, { onError: fail("Couldn't delete the comment") });
  };

  return (
    <div id={`comment-${comment.id}`} className="flex gap-3">
      {author?.handle ? (
        <ProfileHoverCard handle={author.handle} className="shrink-0">
          <Link to={routes.user(author.handle)}>
            <Avatar url={author.avatar_url} name={name} size={28} />
          </Link>
        </ProfileHoverCard>
      ) : (
        <Avatar url={author?.avatar_url} name={name} size={28} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--text-tertiary)]">
          {author?.handle ? (
            <ProfileHoverCard handle={author.handle}>
              <Link
                to={routes.user(author.handle)}
                className="font-medium text-[var(--text)] hover:underline"
              >
                {name}
              </Link>
            </ProfileHoverCard>
          ) : (
            <span className="font-medium text-[var(--text)]">{name}</span>
          )}
          <span>{formatLocalTimestamp(comment.created_at)}</span>
          {comment.edited_at ? <span>· edited</span> : null}
        </div>

        {editing ? (
          <div data-editor-scope className="mt-1.5 space-y-2">
            <RichTextEditor
              value={draft}
              onValueChange={setDraft}
              mentions
              minHeight="min-h-16"
              ariaLabel="Edit comment"
              autoFocus
              onSubmitShortcut={save}
              onEscape={cancelEdit}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={update.isPending}
                disabled={!commentReady(draft)}
                onClick={save}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
              <CommentLength body={draft} />
            </div>
          </div>
        ) : (
          <RichText
            source={comment.body}
            mentions
            className="mt-1 text-sm leading-relaxed text-[var(--text)]"
          />
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
                onClick={() => void askToDelete()}
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

/** A comment can go once it has something in it and fits the column. */
function commentReady(body: string): boolean {
  return body.trim().length > 0 && body.length <= COMMENT_MAX;
}

/** The count, only once it is close to the limit: formatting counts toward it too. */
function CommentLength({ body }: { body: string }) {
  if (body.length < COMMENT_MAX * 0.8) return null;
  return (
    <span
      className={cn(
        "ml-auto text-xs tabular-nums text-[var(--text-tertiary)]",
        body.length > COMMENT_MAX && "text-[var(--lare-danger)]",
      )}
    >
      {body.length}/{COMMENT_MAX}
    </span>
  );
}
