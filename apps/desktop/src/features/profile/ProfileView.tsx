import {
  formatDurationHuman,
  type SolvedActivity,
  type SolvedSkills,
  websiteHref,
  websiteLabel,
} from "@lare/shared";
import { ExternalLink, Lock } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActivityGrid } from "@/components/ActivityGrid";
import { Avatar } from "@/components/ui/Avatar";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
import type { ProfileStats } from "@/lib/json";
import { openExternal } from "@/lib/open";
import { FollowListModal } from "./FollowListModal";
import { ProfilePostGrid } from "./ProfilePostGrid";
import type { FollowListKind, UserPost } from "./queries";
import { SkillsPanel } from "./SkillsPanel";

/**
 * A profile, read-only: a compact identity header with inline counts, then posts, with
 * progress (activity and skills) on its own tab.
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
  skills,
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
  skills?: SolvedSkills | null;
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
  const [tab, setTab] = useState<"posts" | "progress">("posts");
  const hasProgress = Boolean(activity?.visible || skills?.visible);
  const shownTab = hasProgress ? tab : "posts";

  const counts: { label: string; value: number | string; onClick?: () => void }[] = stats
    ? [
        ...(showExtendedStats ? [{ label: "posts", value: stats.posts ?? 0 }] : []),
        {
          label: stats.followers === 1 ? "follower" : "followers",
          value: stats.followers,
          onClick: () => setFollowList("followers"),
        },
        { label: "following", value: stats.following, onClick: () => setFollowList("following") },
        ...(showExtendedStats ? [{ label: "solved", value: stats.problems_solved ?? 0 }] : []),
      ]
    : [];

  return (
    <>
      <header className="flex flex-wrap items-start gap-5">
        <Avatar url={avatarUrl} name={name} size={80} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="lare-heading min-w-0 truncate text-[var(--text)]">{name}</h1>
            {isPrivate ? (
              <Lock className="size-3.5 text-[var(--text-tertiary)]" aria-label="Private account" />
            ) : null}
          </div>
          {handle ? <p className="text-sm text-[var(--text-secondary)]">@{handle}</p> : null}

          {statsPending && handle ? (
            <span className="lare-skel mt-3 block h-4 w-64 rounded" />
          ) : statsError ? (
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              Couldn&apos;t load counts.{" "}
              <button type="button" className="underline underline-offset-2" onClick={onRetryStats}>
                Retry
              </button>
            </p>
          ) : counts.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--text-secondary)]">
              {counts.map((c) => {
                const content = (
                  <>
                    <span className="font-semibold tabular-nums text-[var(--text)]">{c.value}</span>{" "}
                    {c.label}
                  </>
                );
                return (
                  <li key={c.label}>
                    {c.onClick ? (
                      <button
                        type="button"
                        onClick={c.onClick}
                        className="rounded-[var(--lare-r-1)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
                      >
                        {content}
                      </button>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}

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
      </header>

      {locked ? (
        <div className="mt-8">
          <EmptyState
            icon={<Lock className="size-8" aria-hidden />}
            title="This account is private"
            description={lockedDescription}
          />
        </div>
      ) : (
        <>
          {/* Posts lead; progress is one click away instead of stacked above them. */}
          <div className="mt-8 mb-4">
            {hasProgress ? (
              <SegmentedTabs
                label="Profile sections"
                value={shownTab}
                onChange={setTab}
                items={[
                  { key: "posts", label: "Posts" },
                  { key: "progress", label: "Progress" },
                ]}
              />
            ) : (
              <h2 className="text-sm font-semibold text-[var(--text)]">Posts</h2>
            )}
          </div>

          {shownTab === "posts" ? (
            postsPending ? (
              <PageSpinner />
            ) : postsError ? (
              <ErrorState error={postsError} onRetry={onRetryPosts} />
            ) : posts.length === 0 ? (
              postsEmpty
            ) : (
              <ProfilePostGrid posts={posts} />
            )
          ) : (
            <div className="space-y-4">
              {showExtendedStats && stats?.total_active_ms ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  <span className="font-semibold text-[var(--text)]">
                    {formatDurationHuman(stats.total_active_ms)}
                  </span>{" "}
                  of active practice recorded
                </p>
              ) : null}
              {/* Side by side, so neither panel sprawls across the whole page on its own. */}
              <div
                className={`grid items-start gap-4 ${activity?.visible && skills?.visible ? "lg:grid-cols-2" : ""}`}
              >
                {activity?.visible ? <ActivityGrid activity={activity} /> : null}
                {skills?.visible ? <SkillsPanel skills={skills} /> : null}
              </div>
            </div>
          )}
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
