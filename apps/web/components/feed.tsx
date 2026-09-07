"use client";

import { Button, useToast } from "@lare/ui/primitives";
import { useState, useTransition } from "react";
import { loadFeedPage } from "@/app/feed-actions";
import type { FeedScope, PostCardData } from "@/lib/posts";
import { PostCard } from "./post-card";

export function Feed({
  initialItems,
  initialCursor,
  scope,
  viewerId,
}: {
  initialItems: PostCardData[];
  initialCursor: string | null;
  scope: FeedScope;
  viewerId: string | null;
}) {
  const { error: toastError } = useToast();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      try {
        const page = await loadFeedPage(cursor, scope);
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
        });
        setCursor(page.nextCursor);
      } catch (e) {
        toastError(e instanceof Error ? e.message : "Couldn't load more posts.");
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      {items.map((post) => (
        <PostCard key={post.id} post={post} viewerId={viewerId} />
      ))}

      {cursor ? (
        <div className="flex justify-center pt-2">
          <Button type="button" onClick={loadMore} loading={pending}>
            Load more
          </Button>
        </div>
      ) : (
        items.length > 0 && (
          <p className="pt-2 text-center text-xs text-[var(--text-tertiary)]">
            You're all caught up.
          </p>
        )
      )}
    </div>
  );
}
