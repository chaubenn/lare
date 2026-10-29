import { Pencil, Rss } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import { useViewerLikes } from "@/features/publishing/posts/social";
import { ProfileView } from "./ProfileView";
import { useProfileStats, useSolvedActivity, useSolvedSkills, useUserPosts } from "./queries";

/** Your profile as others see it. Editing is a deliberate step: `/profile/edit`. */
export function ProfilePage() {
  const navigate = useNavigate();
  const { profile, session, userId } = useUser();
  const stats = useProfileStats(profile?.handle);
  const activity = useSolvedActivity(profile?.handle);
  const skills = useSolvedSkills(profile?.handle);
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
      name={name}
      handle={profile?.handle}
      avatarUrl={profile?.avatar_url}
      bio={profile?.bio}
      website={profile?.website}
      isPrivate={profile?.is_private ?? false}
      emptyBio={
        <>
          No bio yet.{" "}
          <Link
            to="/profile/edit"
            className="text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text)]"
          >
            Add one
          </Link>
        </>
      }
      actions={
        <Button
          size="sm"
          icon={<Pencil className="size-3.5" aria-hidden />}
          onClick={() => navigate("/profile/edit")}
        >
          Edit profile
        </Button>
      }
      stats={stats.data}
      statsPending={stats.isPending}
      statsError={stats.isError ? stats.error : undefined}
      onRetryStats={() => void stats.refetch()}
      showExtendedStats
      activity={activity.data}
      skills={skills.data}
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
