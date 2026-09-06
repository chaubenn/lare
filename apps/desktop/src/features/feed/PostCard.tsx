import { excerptFromHtml } from "@lare/shared";
import { cn } from "@lare/ui";
import { Heart, Lock, MessageCircle, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { Avatar } from "@/components/ui/Avatar";
import { CommentsPreview } from "@/features/feed/CommentsPreview";
import { PostLinkButton } from "@/features/feed/PostLinkButton";
import { PostSlides } from "@/features/feed/PostSlides";
import type { FeedPost } from "@/features/feed/queries";
import { useToggleLike } from "@/features/posts/social";
import type { UserPost } from "@/features/profile/queries";
import { errorMessage } from "@/lib/supabase";

const cardClass = "rounded-2xl border border-zinc-800/80 bg-zinc-900/40";

/**
 * A post in the feed, mirroring the web feed card exactly: author header with the post link
 * action, the caption above the swipe deck (cover card → session breakdown → photos → demo
 * video), then the like/comment row with the "View post" link inline and an inline preview
 * of the first comments.
 */
export function PostCard({
  post,
  liked,
}: {
  post: FeedPost | UserPost;
  /** Whether the signed-in viewer has liked this post, resolved once for the whole page. */
  liked: boolean;
}) {
  const { toast } = useToast();
  const toggle = useToggleLike(post.id);
  const author = post.profiles;
  const session = post.sessions;
  const name = author?.display_name ?? (author?.handle ? `@${author.handle}` : "Someone");
  const when = post.published_at ?? post.created_at;
  const title = post.title?.trim() || "Untitled session";
  const excerpt = excerptFromHtml(post.body, 220);
  const href = `/posts/${post.id}`;
  const isLiked = toggle.data?.liked ?? liked;
  const likeCount = toggle.data?.like_count ?? post.like_count;
  const showAiReview = Boolean(post.include_ai_insights && session?.kind === "interview");

  return (
    <article className={cn(cardClass, "overflow-hidden")}>
      <header className="flex items-center gap-3 p-4 pb-3 sm:px-5">
        {author?.handle ? (
          <Link to={`/u/${author.handle}`} className="shrink-0">
            <Avatar url={author.avatar_url} name={name} size={40} />
          </Link>
        ) : (
          <Avatar url={author?.avatar_url} name={name} size={40} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {author?.handle ? (
              <Link
                to={`/u/${author.handle}`}
                className="truncate text-sm font-semibold text-zinc-100 hover:underline"
              >
                {name}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-zinc-100">{name}</span>
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
            <time dateTime={when}>{formatWhen(when)}</time>
            {post.visibility === "private" && (
              <>
                <span aria-hidden>·</span>
                <span className="text-zinc-400">Only me</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <PostLinkButton postId={post.id} />
        </div>
      </header>

      <div className="px-4 sm:px-5">
        <h2 className="text-base font-semibold leading-snug text-zinc-50">
          <Link to={href} className="hover:underline">
            {title}
          </Link>
        </h2>
        {excerpt && <p className="mt-1 text-sm leading-relaxed text-zinc-400">{excerpt}</p>}
      </div>

      <div className="px-4 pt-3 sm:px-5">
        <PostSlides post={post} title={title} />
      </div>

      <div className="p-4 pt-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-1 text-sm text-zinc-400">
          <button
            type="button"
            aria-pressed={isLiked}
            aria-label={isLiked ? "Unlike" : "Like"}
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate(undefined, {
                onError: (e) =>
                  toast({ title: "Couldn't like", description: errorMessage(e), variant: "error" }),
              })
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:text-zinc-100",
              isLiked && "text-rose-400 hover:text-rose-300",
            )}
          >
            <Heart className={cn("size-4.5", isLiked && "fill-current")} />
            <span className="tabular-nums">{likeCount}</span>
          </button>

          <Link
            to={href}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:text-zinc-100"
            aria-label="Comments"
          >
            <MessageCircle className="size-4.5" />
            <span className="tabular-nums">{post.comment_count}</span>
          </Link>

          {showAiReview && (
            <span className="inline-flex items-center gap-1 px-2 py-1.5 text-amber-400/80">
              <Sparkles className="size-3.5" />
              AI review
            </span>
          )}

          <Link
            to={href}
            className="ml-auto inline-flex items-center rounded-lg px-2 py-1.5 transition-colors hover:text-zinc-100"
          >
            View post →
          </Link>
        </div>

        <CommentsPreview
          postId={post.id}
          comments={post.top_comments}
          totalCount={post.comment_count}
        />
      </div>
    </article>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
