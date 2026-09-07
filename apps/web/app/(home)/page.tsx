import { Card, Container, PageHeader } from "@lare/ui/primitives";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Feed } from "@/components/feed";
import { Landing } from "@/components/landing";
import { TabNav } from "@/components/tab-nav";
import { GITHUB_RELEASES_URL } from "@/lib/env";
import { fetchFeedPage, parseFeedScope } from "@/lib/posts";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  const viewer = await getViewer();
  if (!viewer) return <Landing />;
  if (!viewer.profile?.handle) redirect("/onboarding");

  const scope = parseFeedScope((await searchParams).scope);
  const supabase = await createClient();
  const { items, nextCursor } = await fetchFeedPage(supabase, null, scope);

  return (
    <Container width="page">
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

      {items.length === 0 ? (
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
      ) : (
        // Keyed so switching scope resets the paging state instead of reusing the old page.
        <Feed
          key={scope}
          initialItems={items}
          initialCursor={nextCursor}
          scope={scope}
          viewerId={viewer.id}
        />
      )}
    </Container>
  );
}
