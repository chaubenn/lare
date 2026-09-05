import { formatDurationHuman, formatLocalTimestamp } from "@lare/shared";
import { Link } from "react-router";
import type { UserPost } from "@/features/profile/queries";
import { plural } from "@/lib/format";
import type { FeedPost } from "./queries";

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
    <div className="flex items-baseline gap-4 px-4 py-3.5">
      <Link
        to={`/posts/${post.id}`}
        className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/70"
      >
        <p className="truncate text-sm text-zinc-100">
          {title}
          {extra ? <span className="text-zinc-500">{extra}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {name}
          {author?.handle && author.display_name ? (
            <>
              <span aria-hidden> · </span>@{author.handle}
            </>
          ) : null}
          <span aria-hidden> · </span>
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
          <span aria-hidden> · </span>
          {plural(problems.length, "problem")}
          {hasVideo ? (
            <>
              <span aria-hidden> · </span>
              video
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
