import { postStateOf } from "@lare/shared";
import { Heart, MessageCircle, Play } from "lucide-react";
import { Link } from "react-router";
import { KindBadge, PostStateBadge } from "@/components/ui/Badge";
import { DifficultyTag } from "@/components/ui/DifficultyTag";
import type { UserPost } from "./queries";

/**
 * A profile's posts as tiles rather than full feed cards. One post used to fill the screen with
 * its session card; here the card is a thumbnail and the tile says what the post is at a glance.
 */
export function ProfilePostGrid({ posts }: { posts: UserPost[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {posts.map((post) => (
        <li key={post.id}>
          <PostTile post={post} />
        </li>
      ))}
    </ul>
  );
}

function PostTile({ post }: { post: UserPost }) {
  const cover = post.cover_url ?? (post.include_og_card ? post.og_url : null);
  const session = post.sessions;
  const problems = session?.session_problems ?? [];
  const title = post.title?.trim() || problems[0]?.title || "Untitled session";
  const when = post.published_at ?? post.created_at;
  const hasVideo = Boolean(post.videos) || Boolean(post.demo_videos);

  return (
    <Link
      to={`/posts/${post.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
    >
      <div className="relative aspect-[1200/630] overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className={`size-full ${post.cover_url ? "object-cover" : "object-contain"} transition-transform duration-300 group-hover:scale-[1.02]`}
          />
        ) : (
          <div className="flex size-full items-end p-4">
            <span className="line-clamp-2 text-lg font-semibold text-[var(--text)]">{title}</span>
          </div>
        )}
        {hasVideo ? (
          <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--surface)_80%,transparent)] px-2 py-0.5 text-[11px] text-[var(--text)] backdrop-blur">
            <Play className="size-3" aria-hidden />
            Video
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm font-semibold text-[var(--text)]">{title}</p>
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
                <span className="max-w-28 truncate">{p.title}</span>
              </span>
            ))
          )}
          {problems.length > 2 ? (
            <span className="text-xs text-[var(--text-tertiary)]">+{problems.length - 2}</span>
          ) : null}
        </div>
        <div className="mt-auto flex items-center justify-between pt-1 text-xs text-[var(--text-tertiary)]">
          <time dateTime={when}>
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
      </div>
    </Link>
  );
}
