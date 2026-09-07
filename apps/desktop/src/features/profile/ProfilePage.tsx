import { formatDurationHuman } from "@lare/shared";
import { ExternalLink, Lock, Rss } from "lucide-react";
import { Link } from "react-router";
import { ActivityGrid } from "@/components/ActivityGrid";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner, Spinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { PostCard } from "@/features/feed/PostCard";
import { useViewerLikes } from "@/features/posts/social";
import { profileWebUrl } from "@/lib/env";
import { openExternal } from "@/lib/open";
import { useProfileStats, useSolvedActivity, useUserPosts } from "./queries";

export function ProfilePage() {
  const { profile, session, userId } = useUser();
  const stats = useProfileStats(profile?.handle);
  const activity = useSolvedActivity(profile?.handle);
  const posts = useUserPosts(userId);
  const postList = posts.data ?? [];
  const likes = useViewerLikes(
    postList.map((post) => post.id),
    userId,
  );
  const likedIds = likes.data ?? new Set<string>();
  const name = profile?.display_name ?? profile?.handle ?? session.user.email ?? "You";

  return (
    <>
      <PageHeader
        title="Profile"
        actions={
          <>
            {profile?.handle ? (
              <Button
                size="sm"
                icon={<ExternalLink className="size-3.5" aria-hidden />}
                onClick={() => void openExternal(profileWebUrl(profile.handle ?? ""))}
              >
                Open on web
              </Button>
            ) : null}
            <Link
              to="/settings"
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800"
            >
              Edit
            </Link>
          </>
        }
      />

      <section className="flex items-start gap-4">
        <Avatar url={profile?.avatar_url} name={name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-50">{name}</h2>
            {profile?.handle ? (
              <span className="text-sm text-zinc-500">@{profile.handle}</span>
            ) : null}
            {profile?.is_private ? (
              <Badge>
                <Lock className="size-3" aria-hidden />
                Private
              </Badge>
            ) : null}
          </div>
          {profile?.bio ? (
            <p className="mt-1 select-text whitespace-pre-wrap text-sm text-zinc-300">
              {profile.bio}
            </p>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">No bio yet.</p>
          )}
          <p className="mt-1 text-xs text-zinc-600">{session.user.email}</p>
        </div>
      </section>

      <div className="mt-4">
        {stats.isPending && profile?.handle ? (
          <Spinner className="py-4" />
        ) : stats.isError ? (
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        ) : stats.data ? (
          <StatStrip
            items={[
              { label: "Followers", value: stats.data.followers },
              { label: "Following", value: stats.data.following },
              { label: "Posts", value: stats.data.posts ?? 0 },
              { label: "Solved", value: stats.data.problems_solved ?? 0 },
              { label: "Time", value: formatDurationHuman(stats.data.total_active_ms ?? 0) },
            ]}
          />
        ) : null}
      </div>

      {/* Solved activity, then your published sessions — the same order, and the same cards,
          as your own profile on the web (app/u/[handle]/page.tsx). */}
      <div className="mt-4 space-y-4">
        {activity.data?.visible ? <ActivityGrid activity={activity.data} /> : null}

        {posts.isPending ? (
          <PageSpinner />
        ) : posts.isError ? (
          <ErrorState error={posts.error} onRetry={() => void posts.refetch()} />
        ) : postList.length === 0 ? (
          <EmptyState
            icon={<Rss className="size-8" aria-hidden />}
            title="You haven't published a session yet"
            description={
              <>
                Publish a draft and it shows up here and in the feed.{" "}
                <Link to="/drafts" className="text-zinc-200 underline underline-offset-2">
                  Go to drafts
                </Link>
              </>
            }
          />
        ) : (
          <div className="space-y-4">
            {postList.map((post) => (
              <PostCard key={post.id} post={post} liked={likedIds.has(post.id)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function StatStrip({ items }: { items: Array<{ label: string; value: number | string }> }) {
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="bg-zinc-950 px-3 py-2.5">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{item.label}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-zinc-100">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
