import { ExternalLink, Rss } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { useViewerLikes } from "@/features/posts/social";
import { profileWebUrl } from "@/lib/env";
import { openExternal } from "@/lib/open";
import { ProfileView } from "./ProfileView";
import { useProfileStats, useSolvedActivity, useUserPosts } from "./queries";

export { type StatItem, StatStrip } from "./StatStrip";

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
    <ProfileView
      title="Profile"
      name={name}
      handle={profile?.handle}
      avatarUrl={profile?.avatar_url}
      bio={profile?.bio}
      email={session.user.email}
      isPrivate={profile?.is_private ?? false}
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
      stats={stats.data}
      statsPending={stats.isPending}
      statsError={stats.isError ? stats.error : undefined}
      onRetryStats={() => void stats.refetch()}
      showExtendedStats
      activity={activity.data}
      posts={postList}
      postsPending={posts.isPending}
      postsError={posts.isError ? posts.error : undefined}
      onRetryPosts={() => void posts.refetch()}
      likedIds={likedIds}
      postsEmpty={
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
      }
    />
  );
}
