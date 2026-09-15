import { formatDurationHuman, type SolvedActivity, websiteHref, websiteLabel } from "@lare/shared";
import { ExternalLink, Lock } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActivityGrid } from "@/components/ActivityGrid";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, PageSpinner, Spinner } from "@/components/ui/States";
import type { ProfileStats } from "@/lib/json";
import { openExternal } from "@/lib/open";
import { FollowListModal } from "./FollowListModal";
import { ProfilePostGrid } from "./ProfilePostGrid";
import type { FollowListKind, UserPost } from "./queries";
import { StatStrip } from "./StatStrip";

const SECTION_HEADING = "mb-3 text-sm font-semibold text-[var(--text)]";

/**
 * A profile, read-only: identity and counts in one raised panel, then activity, then posts.
 * Shared by your own profile tab and other people's profiles; editing lives on its own page.
 */
export function ProfileView({
  name,
  handle,
  avatarUrl,
  bio,
  website,
  isPrivate,
  emptyBio,
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
  name: string;
  handle: string | null | undefined;
  avatarUrl: string | null | undefined;
  bio?: string | null;
  website?: string | null;
  isPrivate: boolean;
  /** Shown in place of a missing bio. Only your own profile passes one. */
  emptyBio?: ReactNode;
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
      <section className="rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)]">
        <div className="flex flex-wrap items-start gap-4 p-5">
          <Avatar url={avatarUrl} name={name} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="lare-heading min-w-0 truncate text-[var(--text)]">{name}</h1>
              {isPrivate ? (
                <Badge>
                  <Lock className="size-3" aria-hidden />
                  Private
                </Badge>
              ) : null}
            </div>
            {handle ? <p className="text-sm text-[var(--text-secondary)]">@{handle}</p> : null}
            {bio ? (
              <p className="mt-3 max-w-prose select-text whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
                {bio}
              </p>
            ) : emptyBio ? (
              <p className="mt-3 text-sm text-[var(--text-tertiary)]">{emptyBio}</p>
            ) : null}
            {website ? (
              <button
                type="button"
                onClick={() => void openExternal(websiteHref(website))}
                className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--lare-r-1)] text-sm text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {websiteLabel(website)}
              </button>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>

        {statsPending && handle ? (
          <div className="border-t border-[var(--border)]">
            <Spinner className="py-4" />
          </div>
        ) : statsError ? (
          <div className="border-t border-[var(--border)] p-4">
            <ErrorState error={statsError} onRetry={onRetryStats} />
          </div>
        ) : stats ? (
          <div className="border-t border-[var(--border)] px-5">
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
          </div>
        ) : null}
      </section>

      {locked ? (
        <div className="mt-6">
          <EmptyState
            icon={<Lock className="size-8" aria-hidden />}
            title="This account is private"
            description={lockedDescription}
          />
        </div>
      ) : (
        <>
          {activity?.visible ? (
            <section className="mt-8" aria-labelledby="profile-activity">
              <h2 id="profile-activity" className={SECTION_HEADING}>
                Activity
              </h2>
              <ActivityGrid activity={activity} />
            </section>
          ) : null}

          <section className="mt-8" aria-labelledby="profile-posts">
            <h2 id="profile-posts" className={SECTION_HEADING}>
              Posts
              {posts.length > 0 ? (
                <span className="ml-2 font-normal tabular-nums text-[var(--text-tertiary)]">
                  {posts.length}
                </span>
              ) : null}
            </h2>
            {postsPending ? (
              <PageSpinner />
            ) : postsError ? (
              <ErrorState error={postsError} onRetry={onRetryPosts} />
            ) : posts.length === 0 ? (
              postsEmpty
            ) : (
              <ProfilePostGrid posts={posts} />
            )}
          </section>
        </>
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
