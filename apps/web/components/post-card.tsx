import { buildSessionOverview, excerptFromHtml, formatDurationHuman } from "@lare/shared";
import { Clock, ListChecks, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { sessionKindLabel } from "@/lib/post-utils";
import type { PostCardData } from "@/lib/posts";
import { cardClass } from "@/lib/styles";
import { Avatar } from "./avatar";
import { PostActions } from "./post-actions";
import { PostSlides } from "./post-slides";
import { TimeAgo } from "./time-ago";

/**
 * A post in the feed: swipe deck first (cover card → session breakdown → photos → demo video),
 * then the caption and the like/comment row. The cover is the same image crawlers get for the
 * Open Graph card, so what people share and what people scroll past are the same picture.
 */
export function PostCard({ post, viewerId }: { post: PostCardData; viewerId: string | null }) {
  const author = post.profiles;
  const session = post.sessions;
  const overview = buildSessionOverview(
    session?.session_problems ?? [],
    session?.active_ms ?? null,
  );
  const href = `/p/${post.id}`;
  const authorName = author?.display_name || (author?.handle ? `@${author.handle}` : "Unknown");
  const excerpt = excerptFromHtml(post.body, 220);
  const when = post.published_at ?? post.created_at;
  const title = post.title?.trim() || "Untitled session";

  return (
    <article className={cn(cardClass, "overflow-hidden")}>
      <header className="flex items-center gap-3 p-4 pb-3 sm:px-5">
        {author?.handle ? (
          <Link href={`/u/${author.handle}`} className="shrink-0">
            <Avatar src={author.avatar_url} name={authorName} />
          </Link>
        ) : (
          <Avatar src={author?.avatar_url} name={authorName} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {author?.handle ? (
              <Link
                href={`/u/${author.handle}`}
                className="truncate text-sm font-semibold text-zinc-100 hover:underline"
              >
                {authorName}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-zinc-100">{authorName}</span>
            )}
            {author?.handle && (
              <span className="truncate text-xs text-zinc-500">@{author.handle}</span>
            )}
            {author?.is_private && (
              <span title="Private account" className="inline-flex">
                <Lock className="size-3 text-zinc-600" aria-label="Private account" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <TimeAgo iso={when} />
            <span aria-hidden="true">·</span>
            <span>{sessionKindLabel(session?.kind)}</span>
            {post.visibility === "private" && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-zinc-400">Only me</span>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-5">
        <PostSlides post={post} title={title} />
      </div>

      <div className="p-4 pt-3 sm:px-5">
        <PostActions
          postId={post.id}
          likeCount={post.like_count}
          commentCount={post.comment_count}
          liked={post.viewer_liked}
          canInteract={Boolean(viewerId)}
          commentHref={`${href}#comments`}
        />

        <h2 className="mt-2 text-base font-semibold leading-snug text-zinc-50">
          <Link href={href} className="hover:underline">
            {title}
          </Link>
        </h2>
        {excerpt && <p className="mt-1 text-sm leading-relaxed text-zinc-400">{excerpt}</p>}

        <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          {session && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              {formatDurationHuman(session.active_ms)}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-3.5" />
            {overview.solved}/{overview.total} solved
          </span>
          {post.include_ai_insights && session?.kind === "interview" && (
            <span className="inline-flex items-center gap-1 text-amber-400/80">
              <Sparkles className="size-3.5" />
              AI review
            </span>
          )}
          <Link href={href} className="ml-auto text-zinc-400 hover:text-zinc-100">
            View post →
          </Link>
        </footer>
      </div>
    </article>
  );
}
