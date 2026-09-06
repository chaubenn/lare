"use client";

import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addComment, deleteComment, updateComment } from "@/app/social-actions";
import { Avatar } from "@/components/avatar";
import { TimeAgo } from "@/components/time-ago";
import type { PostCommentRow } from "@/lib/posts";
import { buttonPrimary, buttonSecondary, inputClass } from "@/lib/styles";

/**
 * Comment thread. Authors can edit or delete their own comment; the post's owner can remove
 * any comment on their post — the same rule the RLS policies enforce server-side.
 */
export function Comments({
  postId,
  comments,
  viewerId,
  isPostOwner,
}: {
  postId: string;
  comments: PostCommentRow[];
  viewerId: string | null;
  isPostOwner: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const body = draft.trim();
    if (body.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await addComment(postId, body);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDraft("");
      router.refresh();
    });
  }

  return (
    <section id="comments" aria-label="Comments" className="scroll-mt-20 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        {comments.length} {comments.length === 1 ? "comment" : "comments"}
      </h2>

      {viewerId ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Add a comment"
            className={`${inputClass} min-h-20 resize-y`}
            aria-label="Add a comment"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending || draft.trim().length === 0}
              className={`${buttonPrimary} px-4 py-1.5 text-xs`}
            >
              {pending && <LoaderCircle className="size-3.5 animate-spin" />}
              Comment
            </button>
            <span className="text-xs text-zinc-600">{draft.length}/2000</span>
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-300">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="text-sm text-zinc-500">
          <Link
            href={`/login?next=${encodeURIComponent(`/p/${postId}`)}`}
            className="text-zinc-200 underline underline-offset-2"
          >
            Sign in
          </Link>{" "}
          to join the conversation.
        </p>
      )}

      <ul className="space-y-4">
        {comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            postId={postId}
            canEdit={comment.user_id === viewerId}
            canDelete={comment.user_id === viewerId || isPostOwner}
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
  comment: PostCommentRow;
  postId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const author = comment.profiles;
  const name = author?.display_name || (author?.handle ? `@${author.handle}` : "Someone");

  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  return (
    <li className="flex gap-3">
      {author?.handle ? (
        <Link href={`/u/${author.handle}`} className="shrink-0">
          <Avatar src={author.avatar_url} name={name} size="sm" />
        </Link>
      ) : (
        <Avatar src={author?.avatar_url} name={name} size="sm" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-500">
          {author?.handle ? (
            <Link
              href={`/u/${author.handle}`}
              className="font-semibold text-zinc-200 hover:underline"
            >
              {name}
            </Link>
          ) : (
            <span className="font-semibold text-zinc-200">{name}</span>
          )}
          <TimeAgo iso={comment.created_at} />
          {comment.edited_at && <span>· edited</span>}
        </div>

        {editing ? (
          <div className="mt-1.5 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={2000}
              rows={3}
              className={`${inputClass} min-h-16 resize-y`}
              aria-label="Edit comment"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending || draft.trim().length === 0}
                onClick={() =>
                  run(
                    () => updateComment(comment.id, postId, draft),
                    () => setEditing(false),
                  )
                }
                className={`${buttonPrimary} px-3 py-1 text-xs`}
              >
                {pending && <LoaderCircle className="size-3.5 animate-spin" />}
                Save
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(false);
                }}
                className={`${buttonSecondary} px-3 py-1 text-xs`}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
            {comment.body}
          </p>
        )}

        {(canEdit || canDelete) && !editing && (
          <div className="mt-1 flex gap-3 text-xs text-zinc-500">
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 hover:text-zinc-300"
              >
                <Pencil className="size-3" />
                Edit
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Delete this comment?")) {
                    run(() => deleteComment(comment.id, postId));
                  }
                }}
                className="inline-flex items-center gap-1 hover:text-rose-300"
              >
                <Trash2 className="size-3" />
                Delete
              </button>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-1 text-xs text-rose-300">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
