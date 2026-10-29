import { ArrowRight, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { useUser } from "@/features/auth/AuthProvider";
import { type FeedPost, useFeed } from "@/features/feed/queries";
import { ProfileHoverCard } from "@/features/profile/ProfileHoverCard";
import { useProfileStats } from "@/features/profile/queries";
import { useFollowRequests } from "@/features/requests/queries";
import { timeAgo } from "@/lib/format";
import { FollowButton } from "./FollowButton";
import { type PersonSummary, useFollowStates } from "./queries";
import { personName } from "./UserRow";

type FriendsTab = "following" | "followers" | "requests" | "find";

/**
 * People who post publicly and whom the viewer doesn't follow yet, most recent poster first.
 * Built from the public feed, so it needs no directory query of its own.
 */
export function useSuggestedPeople(limit: number) {
  const { userId } = useUser();
  const feed = useFeed("all");
  const authors = new Map<string, PersonSummary & { lastPostAt: string }>();
  for (const post of feed.data?.pages.flat() ?? []) {
    const p = post.profiles;
    if (!p?.handle || post.user_id === userId || authors.has(post.user_id)) continue;
    authors.set(post.user_id, {
      id: post.user_id,
      handle: p.handle,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      is_private: p.is_private,
      lastPostAt: post.published_at ?? post.created_at,
    });
  }
  const candidates = [...authors.values()];
  const states = useFollowStates(candidates.map((c) => c.id));
  const people = states.data
    ? candidates.filter((c) => (states.data[c.id] ?? "none") === "none").slice(0, limit)
    : [];
  return { people, isPending: feed.isPending || (candidates.length > 0 && states.isPending) };
}

export function FriendsSidebar({
  onTab,
  suggestions = true,
}: {
  onTab: (tab: FriendsTab) => void;
  /** Off where the page already lists suggestions. */
  suggestions?: boolean;
}) {
  return (
    <aside className="space-y-4" aria-label="Your network and people to follow">
      <Network onTab={onTab} />
      <RecentlyActive />
      {suggestions ? <Suggestions onTab={onTab} /> : null}
    </aside>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkClass =
  "inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text)]";

function Network({ onTab }: { onTab: (tab: FriendsTab) => void }) {
  const { profile } = useUser();
  const stats = useProfileStats(profile?.handle);
  const requests = useFollowRequests();
  const items: { tab: FriendsTab; label: string; value: number | undefined }[] = [
    { tab: "following", label: "Following", value: stats.data?.following },
    { tab: "followers", label: "Followers", value: stats.data?.followers },
    { tab: "requests", label: "Requests", value: requests.data?.length },
  ];
  return (
    <Panel title="Your network">
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <button
            key={item.tab}
            type="button"
            onClick={() => onTab(item.tab)}
            className="rounded-[var(--lare-r-2)] px-2 py-1.5 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--border)_60%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
          >
            <span className="block text-xl font-semibold leading-tight tabular-nums text-[var(--text)]">
              {item.value ?? "—"}
            </span>
            <span className="block text-xs text-[var(--text-secondary)]">{item.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 flex items-start gap-1.5 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-secondary)]">
        {profile?.is_private ? (
          <>
            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              Private account: people request to follow you.{" "}
              <Link
                to="/profile/edit"
                className="underline underline-offset-2 hover:text-[var(--text)]"
              >
                Change
              </Link>
            </span>
          </>
        ) : (
          <span>
            Public account: follows are accepted automatically.{" "}
            <Link
              to="/profile/edit"
              className="underline underline-offset-2 hover:text-[var(--text)]"
            >
              Change
            </Link>
          </span>
        )}
      </p>
    </Panel>
  );
}

/** The latest post from each person the viewer follows. */
function RecentlyActive() {
  const feed = useFeed("following");
  const { userId } = useUser();
  const latest = new Map<string, FeedPost>();
  for (const post of feed.data?.pages.flat() ?? []) {
    if (post.user_id === userId || latest.has(post.user_id)) continue;
    latest.set(post.user_id, post);
  }
  const posts = [...latest.values()].slice(0, 5);
  if (feed.isPending) return null;
  return (
    <Panel
      title="Recently active"
      action={
        posts.length > 0 ? (
          <Link to="/?scope=following" className={linkClass}>
            Feed <ArrowRight className="size-3" aria-hidden />
          </Link>
        ) : undefined
      }
    >
      {posts.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">
          When people you follow post a session, they show up here.
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => {
            const p = post.profiles;
            const name = p?.display_name ?? (p?.handle ? `@${p.handle}` : "Someone");
            return (
              <li key={post.id} className="flex items-start gap-2.5">
                <ProfileHoverCard handle={p?.handle} className="shrink-0">
                  <Link to={p?.handle ? `/u/${p.handle}` : `/posts/${post.id}`}>
                    <Avatar url={p?.avatar_url} name={name} size={28} />
                  </Link>
                </ProfileHoverCard>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-1.5 text-sm">
                    <ProfileHoverCard handle={p?.handle} className="min-w-0 truncate">
                      <Link
                        to={p?.handle ? `/u/${p.handle}` : `/posts/${post.id}`}
                        className="font-medium text-[var(--text)] hover:underline"
                      >
                        {name}
                      </Link>
                    </ProfileHoverCard>
                    <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
                      {timeAgo(post.published_at ?? post.created_at)}
                    </span>
                  </p>
                  <Link
                    to={`/posts/${post.id}`}
                    className="block truncate text-xs text-[var(--text-secondary)] hover:text-[var(--text)]"
                  >
                    {post.title?.trim() || "Untitled session"}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Suggestions({ onTab }: { onTab: (tab: FriendsTab) => void }) {
  const { people } = useSuggestedPeople(4);
  if (people.length === 0) return null;
  return (
    <Panel
      title="People to follow"
      action={
        <button type="button" className={linkClass} onClick={() => onTab("find")}>
          Find more <ArrowRight className="size-3" aria-hidden />
        </button>
      }
    >
      <ul className="space-y-3">
        {people.map((person) => (
          <li key={person.id} className="flex items-center gap-2.5">
            <ProfileHoverCard handle={person.handle} className="shrink-0">
              <Link to={`/u/${person.handle}`}>
                <Avatar url={person.avatar_url} name={personName(person)} size={28} />
              </Link>
            </ProfileHoverCard>
            <div className="min-w-0 flex-1">
              <ProfileHoverCard handle={person.handle} className="block truncate">
                <Link
                  to={`/u/${person.handle}`}
                  className="text-sm font-medium text-[var(--text)] hover:underline"
                >
                  {personName(person)}
                </Link>
              </ProfileHoverCard>
              <p className="truncate text-xs text-[var(--text-tertiary)]">
                posted {timeAgo(person.lastPostAt)}
              </p>
            </div>
            <FollowButton
              targetId={person.id}
              handle={person.handle}
              state="none"
              isPrivate={person.is_private}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
