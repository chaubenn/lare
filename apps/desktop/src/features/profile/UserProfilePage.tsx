import { ExternalLink, Rss } from "lucide-react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { FollowButton } from "@/features/friends/FollowButton";
import { useViewerLikes } from "@/features/posts/social";
import { profileWebUrl } from "@/lib/env";
import { openExternal } from "@/lib/open";
import { ProfileView } from "./ProfileView";
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
  const postList = posts.data ?? [];
  const likes = useViewerLikes(
    postList.map((p) => p.id),
    userId,
  );
  const likedIds = likes.data ?? new Set<string>();

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
    <ProfileView
      title={name}
      subtitle={`@${profile.handle}`}
      name={name}
      handle={profile.handle}
      avatarUrl={profile.avatar_url}
      bio={profile.bio}
      isPrivate={profile.is_private}
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
      stats={stats.data}
      showExtendedStats={visible}
      activity={activity.data}
      posts={postList}
      postsPending={posts.isPending}
      postsError={posts.isError ? posts.error : undefined}
      onRetryPosts={() => void posts.refetch()}
      likedIds={likedIds}
      postsEmpty={
        <EmptyState
          icon={<Rss className="size-8" aria-hidden />}
          title="No published sessions yet"
        />
      }
      locked={!visible}
      lockedDescription={
        followState.data === "pending"
          ? "Your follow request is waiting for approval."
          : "Request to follow, and their sessions and solved-problem activity appear here once they accept."
      }
    />
  );
}
