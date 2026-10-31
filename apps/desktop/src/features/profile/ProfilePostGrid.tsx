import { postStateOf } from "@lare/shared";
import { Heart, MessageCircle, Play } from "@lare/ui/icons";
import { Link } from "react-router";
import { KindBadge, PostStateBadge } from "@/components/ui/Badge";
import { DifficultyTag } from "@/components/ui/DifficultyTag";
import type { UserPost } from "./queries";

/**
 * A profile's posts as one list of compact rows. Cover images are left out on purpose: the title,
 * the problems and the numbers say what a post is, and a row takes a fraction of the space a tile
 * with a picture does, so far more of the profile fits on screen.
 */
export function ProfilePostGrid({ posts }: { posts: UserPost[] }) {
  return (
    <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)]">
      {posts.map((post) => (
        <li key={post.id}>
          <PostRow post={post} />
        </li>
      ))}
    </ul>
  );
}

function PostRow({ post }: { post: UserPost }) {
  const session = post.sessions;
  const problems = session?.session_problems ?? [];
  const title = post.title?.trim() || problems[0]?.title || "Untitled session";
  const when = post.published_at ?? post.created_at;
  const hasVideo = Boolean(post.videos) || Boolean(post.demo_videos);

  return (
    <Link
      to={`/posts/${post.id}`}
      className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)] focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-[var(--text)]">{title}</p>
          {hasVideo ? (
            <Play
              className="size-3 shrink-0 text-[var(--text-tertiary)]"
              aria-label="Has a video"
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {session ? <KindBadge kind={session.kind} /> : null}
          <PostStateBadge state={postStateOf(post)} />
          {problems.length === 1 && problems[0]?.title === title ? (
            // The title already names the problem; just add its difficulty.
            <DifficultyTag difficulty={problems[0].difficulty} rounded />
          ) : (
            problems.slice(0, 2).map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 overflow-hidden rounded-[var(--lare-r-1)] border border-[var(--border)] pr-1.5 text-xs text-[var(--text-secondary)]"
              >
                <DifficultyTag difficulty={p.difficulty} />
                <span className="max-w-40 truncate">{p.title}</span>
              </span>
            ))
          )}
          {problems.length > 2 ? (
            <span className="text-xs text-[var(--text-tertiary)]">+{problems.length - 2}</span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2 text-xs text-[var(--text-tertiary)]">
        <time dateTime={when} className="whitespace-nowrap">
          {new Date(when).toLocaleDateString("en-AU", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </time>
        <span className="flex items-center gap-3 tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Heart className="size-3.5" aria-hidden />
            {post.like_count}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" aria-hidden />
            {post.comment_count}
          </span>
        </span>
      </div>
    </Link>
  );
}
