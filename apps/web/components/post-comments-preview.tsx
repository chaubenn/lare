import Link from "next/link";
import type { PostCommentRow } from "@/lib/posts";
import { Avatar } from "./avatar";

/**
 * Instagram-style inline preview: the first few comments render right under the post, no
 * expand needed. When there are more, a "View all" link leads to the full thread.
 */
export function PostCommentsPreview({
  postSlug,
  comments,
  totalCount,
}: {
  /** Public slug, for the link. Mutations elsewhere still key off the UUID. */
  postSlug: string;
  comments: PostCommentRow[];
  totalCount: number;
}) {
  if (totalCount === 0 || comments.length === 0) return null;

  return (
    <div className="mt-3 space-y-2.5 border-t border-zinc-800/60 pt-3">
      {totalCount > comments.length && (
        <Link
          href={`/p/${postSlug}#comments`}
          className="block text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          View all {totalCount} comments
        </Link>
      )}
      <ul className="space-y-2.5">
        {comments.map((comment) => (
          <CommentPreview key={comment.id} comment={comment} />
        ))}
      </ul>
    </div>
  );
}

function CommentPreview({ comment }: { comment: PostCommentRow }) {
  const author = comment.profiles;
  const name = author?.display_name || (author?.handle ? `@${author.handle}` : "Someone");

  return (
    <li className="flex gap-2.5">
      {author?.handle ? (
        <Link href={`/u/${author.handle}`} className="shrink-0">
          <Avatar src={author.avatar_url} name={name} size="sm" />
        </Link>
      ) : (
        <Avatar src={author?.avatar_url} name={name} size="sm" />
      )}
      <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-relaxed text-zinc-300">
        {author?.handle ? (
          <Link
            href={`/u/${author.handle}`}
            className="font-semibold text-zinc-200 hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="font-semibold text-zinc-200">{name}</span>
        )}{" "}
        {comment.body}
      </p>
    </li>
  );
}
