import { Card, Container, PageHeader } from "@lare/ui/primitives";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Feed } from "@/components/feed";
import { Landing } from "@/components/landing";
import { ProgressPanel } from "@/components/progress-panel";
import { PostCardSkeleton } from "@/components/skeleton";
import { TabNav } from "@/components/tab-nav";
import { GITHUB_RELEASES_URL } from "@/lib/env";
import { type FeedScope, fetchFeedPage, parseFeedScope } from "@/lib/posts";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[]; landing?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer || (await searchParams).landing === "1") return <Landing />;
  if (!viewer.profile?.handle) redirect("/onboarding");

  const scope = parseFeedScope((await searchParams).scope);

  return (
    <Container width="wide">
      {/* Same shape as Friends: the side column starts level with the feed, and stacks above it
          on smaller screens. */}
      <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <PageHeader
            title="Feed"
            actions={
              <Link
                href={`/u/${viewer.profile.handle}`}
                className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text)]"
              >
                My profile →
              </Link>
            }
          />

          <div className="mb-4">
            <TabNav
              label="Feed filter"
              active={scope}
              items={[
                { key: "all", label: "Everyone", href: "/" },
                { key: "following", label: "Following", href: "/?scope=following" },
              ]}
            />
          </div>
        </div>

        <div className="mb-6 min-w-0 lg:col-start-2 lg:row-start-2 lg:mb-0">
          <div className="lg:sticky lg:top-4">
            <Suspense fallback={<div className="lare-skel h-32 rounded-[var(--lare-r-4)]" />}>
              <ProgressPanel handle={viewer.profile.handle} />
            </Suspense>
          </div>
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          {/* The page frame — header and filter — paints while the feed's queries are still in
              flight, so switching Everyone/Following moves immediately instead of blanking. */}
          <Suspense
            key={scope}
            fallback={
              <div className="mx-auto w-full max-w-xl space-y-4" role="status" aria-busy="true">
                <PostCardSkeleton />
                <PostCardSkeleton />
              </div>
            }
          >
            <FeedSection scope={scope} viewerId={viewer.id} />
          </Suspense>
        </div>
      </div>
    </Container>
  );
}

/**
 * The feed itself, split out so it can stream in behind a `<Suspense>` boundary: the queries
 * behind it are the slow part of this page, and nothing above it depends on them.
 */
async function FeedSection({ scope, viewerId }: { scope: FeedScope; viewerId: string }) {
  const supabase = await createClient();
  const { items, nextCursor } = await fetchFeedPage(supabase, null, scope);

  if (items.length === 0) {
    return (
      <Card className="mx-auto max-w-xl px-6 py-12 text-center">
        <Inbox className="mx-auto size-8 text-[var(--text-tertiary)]" />
        <h2 className="mt-3 text-base font-semibold text-[var(--text)]">
          {scope === "following" ? "Nothing from your follows yet" : "Your feed is empty"}
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-secondary)]">
          {scope === "following" ? (
            <>
              Posts from accounts you follow show up here. Switch to{" "}
              <Link href="/" className="text-[var(--text)] underline underline-offset-2">
                Everyone
              </Link>{" "}
              to see what the rest of Lare is publishing, or{" "}
              <Link href="/friends" className="text-[var(--text)] underline underline-offset-2">
                find people to follow
              </Link>
              .
            </>
          ) : (
            <>
              Nobody has published a public session yet. Publish your own from the{" "}
              <a
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--text)] underline underline-offset-2"
              >
                desktop app
              </a>
              , or{" "}
              <Link href="/friends" className="text-[var(--text)] underline underline-offset-2">
                find people to follow
              </Link>
              .
            </>
          )}
        </p>
      </Card>
    );
  }

  // Keyed so switching scope resets the paging state instead of reusing the old page.
  return (
    <Feed
      key={scope}
      initialItems={items}
      initialCursor={nextCursor}
      scope={scope}
      viewerId={viewerId}
    />
  );
}
