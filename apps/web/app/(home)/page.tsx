import { Inbox } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Feed } from "@/components/feed";
import { Landing } from "@/components/landing";
import { GITHUB_RELEASES_URL } from "@/lib/env";
import { fetchFeedPage } from "@/lib/posts";
import { cardClass } from "@/lib/styles";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer) return <Landing />;
  if (!viewer.profile?.handle) redirect("/onboarding");

  const supabase = await createClient();
  const { items, nextCursor } = await fetchFeedPage(supabase, null);

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-zinc-50">Feed</h1>
        <Link
          href={`/u/${viewer.profile.handle}`}
          className="text-sm text-zinc-400 hover:text-zinc-100"
        >
          My profile →
        </Link>
      </div>

      {items.length === 0 ? (
        <div className={`${cardClass} px-6 py-12 text-center`}>
          <Inbox className="mx-auto size-8 text-zinc-600" />
          <h2 className="mt-3 text-base font-semibold text-zinc-100">Your feed is empty</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-400">
            Posts from people you follow show up here. Publish your own session from the{" "}
            <a
              href={GITHUB_RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="text-zinc-200 underline underline-offset-2"
            >
              desktop app
            </a>
            , or find friends by their @handle.
          </p>
        </div>
      ) : (
        <Feed initialItems={items} initialCursor={nextCursor} />
      )}
    </div>
  );
}
