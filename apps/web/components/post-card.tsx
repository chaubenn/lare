import { excerptFromHtml } from "@lare/shared";
import { Card, Tooltip } from "@lare/ui/primitives";
import { Lock } from "lucide-react";
import Link from "next/link";
import type { PostCardData } from "@/lib/posts";
import { Avatar } from "./avatar";
import { CopyLinkButton } from "./copy-link-button";
import { PostActions } from "./post-actions";
import { PostCommentsPreview } from "./post-comments-preview";
import { PostSlides } from "./post-slides";
import { TimeAgo } from "./time-ago";

/**
 * A post in the feed: author header with the post link action, the caption above the swipe
 * deck (cover card → session breakdown → photos → demo video), then the like/comment row and
 * an inline preview of the first comments. The cover is the same image crawlers get for the
 * Open Graph card, so what people share and what people scroll past are the same picture.
 */
export function PostCard({ post, viewerId }: { post: PostCardData; viewerId: string | null }) {
  const author = post.profiles;
  const session = post.sessions;
  const href = `/p/${post.id}`;
  const authorName = author?.display_name || (author?.handle ? `@${author.handle}` : "Unknown");
  const excerpt = excerptFromHtml(post.body, 220);
  const when = post.published_at ?? post.created_at;
  const title = post.title?.trim() || "Untitled session";

  return (
    <Card className="overflow-hidden !p-0">
      <article>
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
                <Tooltip label="Private account">
                  <span className="inline-flex">
                    <Lock
                      className="size-3 text-[var(--text-tertiary)]"
                      aria-label="Private account"
                    />
                  </span>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <TimeAgo iso={when} />
              {post.visibility === "private" && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-zinc-400">Only me</span>
                </>
              )}
            </div>
          </div>
          <div className="shrink-0">
            <CopyLinkButton path={href} />
          </div>
        </header>

        <div className="px-4 sm:px-5">
          <h2 className="text-base font-semibold leading-snug text-zinc-50">
            <Link href={href} className="hover:underline">
              {title}
            </Link>
          </h2>
          {excerpt && <p className="mt-1 text-sm leading-relaxed text-zinc-400">{excerpt}</p>}
        </div>

        <div className="px-4 pt-3 sm:px-5">
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
            viewHref={href}
            showAiReview={Boolean(post.include_ai_insights && session?.kind === "interview")}
          />

          <PostCommentsPreview
            postId={post.id}
            comments={post.top_comments}
            totalCount={post.comment_count}
          />
        </div>
      </article>
    </Card>
  );
}
