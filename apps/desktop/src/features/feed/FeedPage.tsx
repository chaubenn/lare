import { Rss } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { useViewerLikes } from "@/features/publishing/posts/social";
import { FeedSidebar } from "./FeedSidebar";
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
  const { userId } = useUser();
  const likes = useViewerLikes(
    posts.map((post) => post.id),
    userId,
  );
  const likedIds = likes.data ?? new Set<string>();

  return (
    // Full page width like every other tab: posts fill the main column and the side column starts
    // level with the first post rather than with the page title.
    <div className="grid w-full gap-x-8 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <PageHeader
          title="Feed"
          subtitle={
            scope === "following"
              ? "Posts from the people you follow."
              : "Public sessions from everyone on Lare, plus your own posts."
          }
        />

        <div className="mb-4">
          <SegmentedTabs
            label="Feed filter"
            value={scope}
            onChange={(key) => setParams(key === "all" ? {} : { scope: key })}
            items={SCOPES}
          />
        </div>
      </div>

      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <div className="w-full">
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
                    <Link
                      to="/friends?tab=find"
                      className="text-zinc-200 underline underline-offset-2"
                    >
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
              <div className="space-y-4">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} liked={likedIds.has(post.id)} />
                ))}
              </div>
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
        </div>
      </div>
      <div className="hidden lg:col-start-2 lg:row-start-2 lg:block">
        <div className="sticky top-0">
          <FeedSidebar posts={posts} />
        </div>
      </div>
    </div>
  );
}
