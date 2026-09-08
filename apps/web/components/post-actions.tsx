"use client";

import { cn } from "@lare/ui/cn";
import { useToast } from "@lare/ui/primitives";
import { Heart, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { togglePostLike } from "@/app/social-actions";

/**
 * Like / comment row with the "View post" link inline. The like flips optimistically and
 * reconciles with the count the database reports; anonymous viewers are sent to the login
 * page instead.
 */
export function PostActions({
  postId,
  postSlug,
  likeCount,
  commentCount,
  liked,
  canInteract,
  commentHref,
  viewHref,
  showAiReview = false,
  className,
}: {
  /** UUID — what `togglePostLike` keys off. */
  postId: string;
  /** Public slug — what the login bounce has to come back to. */
  postSlug: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  canInteract: boolean;
  commentHref: string;
  viewHref?: string;
  showAiReview?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { error: toastError } = useToast();
  const [state, setState] = useState({ liked, count: likeCount });
  const [optimistic, applyOptimistic] = useOptimistic(
    state,
    (prev: { liked: boolean; count: number }) => ({
      liked: !prev.liked,
      count: Math.max(0, prev.count + (prev.liked ? -1 : 1)),
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function onLike() {
    if (!canInteract) {
      router.push(`/login?next=${encodeURIComponent(`/p/${postSlug}`)}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      applyOptimistic(null);
      const result = await togglePostLike(postId, state.liked);
      if (result.error) {
        setError(result.error);
        toastError(result.error);
        return;
      }
      setState({ liked: result.liked, count: result.count });
    });
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1 text-sm text-zinc-400", className)}>
      <button
        type="button"
        onClick={onLike}
        aria-pressed={optimistic.liked}
        aria-label={optimistic.liked ? "Unlike" : "Like"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:text-zinc-100",
          optimistic.liked && "text-rose-400 hover:text-rose-300",
        )}
      >
        <Heart className={cn("size-4.5", optimistic.liked && "fill-current")} />
        <span className="tabular-nums">{optimistic.count}</span>
      </button>

      <Link
        href={commentHref}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:text-zinc-100"
        aria-label="Comments"
      >
        <MessageCircle className="size-4.5" />
        <span className="tabular-nums">{commentCount}</span>
      </Link>

      {showAiReview && (
        <span className="inline-flex items-center gap-1 px-2 py-1.5 text-amber-400/80">
          <Sparkles className="size-3.5" />
          AI review
        </span>
      )}

      {viewHref && (
        <Link
          href={viewHref}
          className="ml-auto inline-flex items-center rounded-lg px-2 py-1.5 transition-colors hover:text-zinc-100"
        >
          View post →
        </Link>
      )}

      {error ? <span className="sr-only">{error}</span> : null}
    </div>
  );
}
