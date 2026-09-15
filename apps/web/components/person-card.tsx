import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { FollowButton, type FollowState } from "@/components/follow-button";
import { ProfileHoverCard } from "@/components/profile-hover-card";
import type { ProfileStats } from "@/lib/parse";

export interface PersonSummary {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_private: boolean;
}

export function displayNameOf(person: PersonSummary): string {
  return person.display_name || (person.handle ? `@${person.handle}` : "Someone");
}

/** People as a grid of cards, so a short list doesn't stretch one row across the whole page. */
export function PeopleGrid({ children }: { children: ReactNode }) {
  return <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</ul>;
}

/**
 * One person on the friends page: avatar and name (both open a profile preview on hover), their
 * solved / posts / followers counts, a follow button or the list's own action, and how they are
 * connected to the viewer.
 */
export function PersonCard({
  person,
  viewerId,
  followState,
  stats,
  meta,
  action,
}: {
  person: PersonSummary;
  viewerId: string | null;
  /** Omit to render no follow button (e.g. cards that carry accept/decline forms instead). */
  followState?: FollowState;
  /** Omit to hide the counts line. */
  stats?: ProfileStats | null;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  const name = displayNameOf(person);
  const href = person.handle ? `/u/${person.handle}` : null;

  return (
    <li className="flex min-w-0 flex-col rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)] transition-colors hover:border-[var(--border-strong)]">
      <div className="flex items-start gap-3 p-4 pb-3">
        <ProfileHoverCard handle={person.handle} viewerId={viewerId} className="shrink-0">
          {href ? (
            <Link href={href}>
              <Avatar src={person.avatar_url} name={name} />
            </Link>
          ) : (
            <Avatar src={person.avatar_url} name={name} />
          )}
        </ProfileHoverCard>
        <div className="min-w-0 flex-1">
          <ProfileHoverCard
            handle={person.handle}
            viewerId={viewerId}
            className="flex min-w-0 items-center gap-1.5"
          >
            {href ? (
              <Link
                href={href}
                className="truncate text-sm font-semibold text-[var(--text)] hover:underline"
              >
                {name}
              </Link>
            ) : (
              <span className="truncate text-sm font-semibold text-[var(--text)]">{name}</span>
            )}
            {person.is_private ? (
              <Lock
                className="size-3 shrink-0 text-[var(--text-tertiary)]"
                aria-label="Private account"
              />
            ) : null}
          </ProfileHoverCard>
          {person.handle ? (
            <p className="truncate text-xs text-[var(--text-secondary)]">@{person.handle}</p>
          ) : null}
          {stats ? <PersonStats stats={stats} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {action ??
            (person.handle && followState !== undefined ? (
              <FollowButton
                targetId={person.id}
                targetHandle={person.handle}
                viewerId={viewerId}
                initialState={followState}
              />
            ) : null)}
        </div>
      </div>
      {meta ? (
        <p className="mt-auto truncate border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--text-tertiary)]">
          {meta}
        </p>
      ) : null}
    </li>
  );
}

/** Solved, posts and followers; only the follower count for a profile the viewer can't see. */
function PersonStats({ stats }: { stats: ProfileStats }) {
  const items = stats.visible
    ? [
        { label: "solved", value: stats.problems_solved ?? 0 },
        { label: "posts", value: stats.posts ?? 0 },
        { label: "followers", value: stats.followers },
      ]
    : [{ label: "followers", value: stats.followers }];
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
      {items.map((item) => (
        <span key={item.label}>
          <span className="font-semibold tabular-nums text-[var(--text)]">{item.value}</span>{" "}
          {item.label}
        </span>
      ))}
    </p>
  );
}

/** "Following since 5 Sep 2026". */
export function since(prefix: string, iso: string): string {
  return `${prefix} ${new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
