import { formatDurationHuman, formatLocalTimestamp } from "@lare/shared";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import type { UserPost } from "@/features/profile/queries";
import { plural } from "@/lib/format";
import type { FeedPost } from "./queries";

/**
 * One post in the feed, Instagram-style: the author header (avatar, name, handle, date) is the
 * main container, the caption sits above a smaller cover image (the author's own, or the
 * pre-generated session card), and the session summary trails underneath.
 */
export function PostCard({ post }: { post: FeedPost | UserPost }) {
  const author = post.profiles;
  const session = post.sessions;
  const problems = session?.session_problems ?? [];
  const name = author?.display_name ?? (author?.handle ? `@${author.handle}` : "Someone");
  const when = post.published_at ?? post.created_at;
  const title = post.title?.trim() || problems[0]?.title || "Untitled session";
  const extra = problems.length > 1 ? ` +${problems.length - 1}` : "";
  const kindLabel = session ? (session.kind === "interview" ? "Interview" : "Practice") : null;
  const hasVideo = Boolean(post.video_id) && post.video_kind !== "none";

  return (
    <div className="px-4 py-4">
      <Link
        to={`/posts/${post.id}`}
        className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/70"
      >
        <div className="flex items-center gap-2.5">
          <Avatar url={author?.avatar_url} name={name} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-zinc-100">
              <span className="font-medium">{name}</span>
              {author?.handle && author.display_name ? (
                <span className="text-zinc-500"> @{author.handle}</span>
              ) : null}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {formatLocalTimestamp(when)}
              {kindLabel ? (
                <>
                  <span aria-hidden> · </span>
                  {kindLabel}
                </>
              ) : null}
              {session ? (
                <>
                  <span aria-hidden> · </span>
                  {formatDurationHuman(session.active_ms)}
                </>
              ) : null}
            </p>
          </div>
        </div>

        <p className="mt-3 text-sm text-zinc-100">
          {title}
          {extra ? <span className="text-zinc-500">{extra}</span> : null}
        </p>

        {post.cover_url ? (
          <img
            src={post.cover_url}
            alt=""
            loading="lazy"
            className="mt-2 max-h-64 w-auto rounded-lg border border-zinc-800 object-contain"
          />
        ) : null}

        <p className="mt-2 text-xs text-zinc-500">
          {plural(problems.length, "problem")}
          {hasVideo ? (
            <>
              <span aria-hidden> · </span>
              video
            </>
          ) : null}
          {post.like_count > 0 ? (
            <>
              <span aria-hidden> · </span>
              {plural(post.like_count, "like")}
            </>
          ) : null}
          {post.comment_count > 0 ? (
            <>
              <span aria-hidden> · </span>
              {plural(post.comment_count, "comment")}
            </>
          ) : null}
          {post.visibility === "private" ? (
            <>
              <span aria-hidden> · </span>
              Only me
            </>
          ) : null}
        </p>
      </Link>
    </div>
  );
}
