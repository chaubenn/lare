import { formatDurationHuman, type SolvedActivity } from "@lare/shared";
import { Lock } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActivityGrid } from "@/components/ActivityGrid";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner, Spinner } from "@/components/ui/States";
import { PostCard } from "@/features/feed/PostCard";
import type { ProfileStats } from "@/lib/json";
import { FollowListModal } from "./FollowListModal";
import type { FollowListKind, UserPost } from "./queries";
import { StatStrip } from "./StatStrip";

export function ProfileView({
  title,
  subtitle,
  name,
  handle,
  avatarUrl,
  bio,
  email,
  isPrivate,
  actions,
  stats,
  statsPending,
  statsError,
  onRetryStats,
  showExtendedStats,
  activity,
  posts,
  postsPending,
  postsError,
  onRetryPosts,
  likedIds,
  postsEmpty,
  locked,
  lockedDescription,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  name: string;
  handle: string | null | undefined;
  avatarUrl: string | null | undefined;
  bio?: string | null;
  email?: string;
  isPrivate: boolean;
  actions?: ReactNode;
  stats: ProfileStats | null | undefined;
  statsPending?: boolean;
  statsError?: unknown;
  onRetryStats?: () => void;
  showExtendedStats: boolean;
  activity?: SolvedActivity | null;
  posts: UserPost[];
  postsPending: boolean;
  postsError: unknown;
  onRetryPosts: () => void;
  likedIds: Set<string>;
  postsEmpty: ReactNode;
  locked?: boolean;
  lockedDescription?: ReactNode;
}) {
  const [followList, setFollowList] = useState<FollowListKind | null>(null);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />

      <section className="flex items-start gap-4">
        <Avatar url={avatarUrl} name={name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-50">{name}</h2>
            {handle && !subtitle ? <span className="text-sm text-zinc-500">@{handle}</span> : null}
            {isPrivate ? (
              <Badge>
                <Lock className="size-3" aria-hidden />
                Private
              </Badge>
            ) : null}
          </div>
          {bio ? (
            <p className="mt-1 select-text whitespace-pre-wrap text-sm text-zinc-300">{bio}</p>
          ) : email ? (
            <p className="mt-1 text-sm text-zinc-500">No bio yet.</p>
          ) : null}
          {email ? <p className="mt-1 text-xs text-zinc-600">{email}</p> : null}
        </div>
      </section>

      <div className="mt-4">
        {statsPending && handle ? (
          <Spinner className="py-4" />
        ) : statsError ? (
          <ErrorState error={statsError} onRetry={onRetryStats} />
        ) : stats ? (
          <StatStrip
            items={[
              {
                label: "Followers",
                value: stats.followers,
                onClick: () => setFollowList("followers"),
              },
              {
                label: "Following",
                value: stats.following,
                onClick: () => setFollowList("following"),
              },
              ...(showExtendedStats
                ? [
                    { label: "Posts", value: stats.posts ?? 0 },
                    { label: "Solved", value: stats.problems_solved ?? 0 },
                    { label: "Time", value: formatDurationHuman(stats.total_active_ms ?? 0) },
                  ]
                : []),
            ]}
          />
        ) : null}
      </div>

      {locked ? (
        <div className="mt-4">
          <EmptyState
            icon={<Lock className="size-8" aria-hidden />}
            title="This account is private"
            description={lockedDescription}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {activity?.visible ? <ActivityGrid activity={activity} /> : null}

          {postsPending ? (
            <PageSpinner />
          ) : postsError ? (
            <ErrorState error={postsError} onRetry={onRetryPosts} />
          ) : posts.length === 0 ? (
            postsEmpty
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} liked={likedIds.has(post.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      <FollowListModal
        handle={handle}
        name={name}
        kind={followList}
        onKindChange={setFollowList}
        onClose={() => setFollowList(null)}
      />
    </>
  );
}
