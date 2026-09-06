"use client";

import { Heart, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { togglePostLike } from "@/app/social-actions";
import { cn } from "@/lib/cn";
import { CopyLinkButton } from "./copy-link-button";

/**
 * Like / comment / share row. The like flips optimistically and reconciles with the count the
 * database reports; anonymous viewers are sent to the login page instead.
 */
export function PostActions({
  postId,
  likeCount,
  commentCount,
  liked,
  canInteract,
  commentHref,
  className,
}: {
  postId: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  canInteract: boolean;
  commentHref: string;
  className?: string;
}) {
  const router = useRouter();
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
      router.push(`/login?next=${encodeURIComponent(`/p/${postId}`)}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      applyOptimistic(null);
      const result = await togglePostLike(postId, state.liked);
      if (result.error) {
        setError(result.error);
        return;
      }
      setState({ liked: result.liked, count: result.count });
    });
  }

  return (
    <div className={cn("flex items-center gap-1 text-sm text-zinc-400", className)}>
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

      <CopyLinkButton path={`/p/${postId}`} className="ml-auto" />

      {error && (
        <span role="alert" className="ml-2 text-xs text-rose-300">
          {error}
        </span>
      )}
    </div>
  );
}
