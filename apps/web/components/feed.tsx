"use client";

import { LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { loadFeedPage } from "@/app/feed-actions";
import type { FeedScope, PostCardData } from "@/lib/posts";
import { buttonSecondary } from "@/lib/styles";
import { PostCard } from "./post-card";

export function Feed({
  initialItems,
  initialCursor,
  scope,
}: {
  initialItems: PostCardData[];
  initialCursor: string | null;
  scope: FeedScope;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      try {
        const page = await loadFeedPage(cursor, scope);
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
        });
        setCursor(page.nextCursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load more posts.");
      }
    });
  }

  return (
    <div className="space-y-4">
      {items.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}

      {error && (
        <p role="alert" className="text-center text-sm text-rose-300">
          {error}
        </p>
      )}

      {cursor ? (
        <div className="flex justify-center pt-2">
          <button type="button" onClick={loadMore} disabled={pending} className={buttonSecondary}>
            {pending && <LoaderCircle className="size-4 animate-spin" />}
            Load more
          </button>
        </div>
      ) : (
        items.length > 0 && (
          <p className="pt-2 text-center text-xs text-zinc-600">You're all caught up.</p>
        )
      )}
    </div>
  );
}
