import { Rss } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { PostCard } from "./PostCard";
import { useFeed } from "./queries";

export function FeedPage() {
  const feed = useFeed();
  const posts = feed.data?.pages.flat() ?? [];

  return (
    <>
      <PageHeader title="Feed" subtitle="Your posts and posts from people you follow." />
      {feed.isPending ? (
        <PageSpinner />
      ) : feed.isError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Rss className="size-8" aria-hidden />}
          title="Nothing here yet"
          description={
            <>
              Publish a draft to see it here, or follow people from the web app.{" "}
              <Link to="/drafts" className="text-emerald-400 hover:underline">
                Go to drafts
              </Link>
            </>
          }
        />
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
          {feed.hasNextPage ? (
            <div className="flex justify-center pt-2">
              <Button
                onClick={() => void feed.fetchNextPage()}
                loading={feed.isFetchingNextPage}
                disabled={feed.isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
