import { cn } from "@lare/ui";
import { Rss } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/Button";
import { PageHeader, StackedList, StackedListItem } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { PostCard } from "./PostCard";
import { type FeedScope, useFeed } from "./queries";

const SCOPES: Array<{ key: FeedScope; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "following", label: "Following" },
];

export function FeedPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("scope");
  const scope: FeedScope = raw === "following" ? "following" : "all";
  const feed = useFeed(scope);
  const posts = feed.data?.pages.flat() ?? [];

  return (
    <>
      <PageHeader
        title="Feed"
        subtitle={
          scope === "following"
            ? "Posts from the people you follow."
            : "Public sessions from everyone on Lare, plus your own posts."
        }
      />

      <div className="mb-5 inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-1">
        {SCOPES.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-current={item.key === scope ? "page" : undefined}
            onClick={() => setParams(item.key === "all" ? {} : { scope: item.key })}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              item.key === scope
                ? "bg-zinc-800 font-medium text-zinc-50"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {feed.isPending ? (
        <PageSpinner />
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Rss className="size-8" aria-hidden />}
          title={scope === "following" ? "Nothing from your follows yet" : "Nothing here yet"}
          description={
            scope === "following" ? (
              <>
                Posts from the people you follow show up here.{" "}
                <Link to="/friends?tab=find" className="text-zinc-200 underline underline-offset-2">
                  Find people to follow
                </Link>
              </>
            ) : (
              <>
                Nobody has published a public session yet. Publish a draft to see it here.{" "}
                <Link to="/drafts" className="text-zinc-200 underline underline-offset-2">
                  Go to drafts
                </Link>
              </>
            )
          }
        />
      ) : (
        <>
          <StackedList>
            {posts.map((post) => (
              <StackedListItem key={post.id}>
                <PostCard post={post} />
              </StackedListItem>
            ))}
          </StackedList>
          {feed.hasNextPage ? (
            <div className="flex justify-center pt-4">
              <Button
                onClick={() => void feed.fetchNextPage()}
                loading={feed.isFetchingNextPage}
                disabled={feed.isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
