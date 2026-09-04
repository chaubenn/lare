import { formatDurationHuman } from "@lare/shared";
import { ExternalLink, Lock, Rss } from "lucide-react";
import { useParams } from "react-router";
import { ActivityGrid } from "@/components/ActivityGrid";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { PostCard } from "@/features/feed/PostCard";
import { FollowButton } from "@/features/friends/FollowButton";
import { profileWebUrl } from "@/lib/env";
import { openExternal } from "@/lib/open";
import {
  useFollowState,
  useProfileStats,
  usePublicProfile,
  useSolvedActivity,
  useUserPosts,
} from "./queries";

/** Someone else's profile, opened from the friends tab or a post author. */
export function UserProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const { userId } = useUser();
  const profileQuery = usePublicProfile(handle);
  const profile = profileQuery.data;
  const isSelf = profile?.id === userId;

  const stats = useProfileStats(handle);
  const activity = useSolvedActivity(handle);
  const followState = useFollowState(profile?.id);
  const posts = useUserPosts(profile?.id);

  if (profileQuery.isPending) return <PageSpinner />;
  if (profileQuery.isError) {
    return <ErrorState error={profileQuery.error} onRetry={() => void profileQuery.refetch()} />;
  }
  if (!profile?.handle) {
    return (
      <EmptyState
        title="Profile not found"
        description={`No account with the handle @${handle}.`}
      />
    );
  }

  const name = profile.display_name ?? `@${profile.handle}`;
  // `profile_stats` is the authority on visibility; it applies the same rule as RLS.
  const visible = stats.data?.visible ?? isSelf;

  return (
    <>
      <PageHeader
        title={name}
        subtitle={`@${profile.handle}`}
        actions={
          <>
            <Button
              size="sm"
              icon={<ExternalLink className="size-3.5" aria-hidden />}
              onClick={() => void openExternal(profileWebUrl(profile.handle ?? ""))}
            >
              Open on web
            </Button>
            {isSelf ? null : (
              <FollowButton
                targetId={profile.id}
                handle={profile.handle}
                state={followState.data ?? "none"}
                isPrivate={profile.is_private}
              />
            )}
          </>
        }
      />

      <Card className="flex items-start gap-4">
        <Avatar url={profile.avatar_url} name={name} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-50">{name}</h2>
            {profile.is_private ? (
              <Badge>
                <Lock className="size-3" aria-hidden />
                Private
              </Badge>
            ) : null}
          </div>
          {profile.bio ? (
            <p className="mt-2 select-text whitespace-pre-wrap text-sm text-zinc-300">
              {profile.bio}
            </p>
          ) : null}
          {stats.data ? (
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Followers" value={stats.data.followers} />
              <Stat label="Following" value={stats.data.following} />
              {visible ? (
                <>
                  <Stat label="Posts" value={stats.data.posts ?? 0} />
                  <Stat label="Problems solved" value={stats.data.problems_solved ?? 0} />
                  <Stat
                    label="Time practising"
                    value={formatDurationHuman(stats.data.total_active_ms ?? 0)}
                  />
                </>
              ) : null}
            </dl>
          ) : null}
        </div>
      </Card>

      {!visible ? (
        <div className="mt-4">
          <EmptyState
            icon={<Lock className="size-8" aria-hidden />}
            title="This account is private"
            description={
              followState.data === "pending"
                ? "Your follow request is waiting for approval."
                : "Request to follow, and their sessions and solved-problem activity appear here once they accept."
            }
          />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {activity.data?.visible ? <ActivityGrid activity={activity.data} /> : null}

          {posts.isPending ? (
            <PageSpinner />
          ) : posts.isError ? (
            <ErrorState error={posts.error} onRetry={() => void posts.refetch()} />
          ) : posts.data.length === 0 ? (
            <EmptyState
              icon={<Rss className="size-8" aria-hidden />}
              title="No published sessions yet"
            />
          ) : (
            <div className="space-y-3">
              {posts.data.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-zinc-100">{value}</dd>
    </div>
  );
}
