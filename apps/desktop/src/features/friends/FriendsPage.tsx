import { Check, Lock, Search, UserPlus, Users, X } from "lucide-react";
import { type ReactNode, useDeferredValue, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { Avatar } from "@/components/ui/Avatar";
import { CountBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState, ErrorState, ListSkeleton, PageSpinner } from "@/components/ui/States";
import { ProfileHoverCard } from "@/features/profile/ProfileHoverCard";
import { useProfileStats } from "@/features/profile/queries";
import {
  type FollowRequest,
  useFollowRequests,
  useRespondToRequest,
} from "@/features/requests/queries";
import { errorMessage } from "@/lib/supabase";
import { FollowButton } from "./FollowButton";
import { FriendsSidebar, useSuggestedPeople } from "./FriendsSidebar";
import { LeaderboardTab } from "./LeaderboardTab";
import {
  type FollowState,
  type PersonSummary,
  useFollowers,
  useFollowing,
  useFollowStates,
  useProfileSearch,
} from "./queries";
import { personName } from "./UserRow";

const TABS = ["leaderboard", "following", "followers", "requests", "find"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  leaderboard: "Leaderboard",
  following: "Following",
  followers: "Followers",
  requests: "Requests",
  find: "Find people",
};

export function FriendsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "following";
  const requests = useFollowRequests();
  const setTab = (key: Tab) => setParams({ tab: key });

  return (
    // Same shape as the feed: the side column starts level with the lists, not the title.
    <div className="grid w-full gap-x-8 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <PageHeader
          title="Friends"
          subtitle="The people you follow, who follows you, and who to follow next."
        />
        <div className="mb-4">
          <SegmentedTabs
            label="Friends sections"
            value={tab}
            onChange={setTab}
            items={TABS.map((key) => ({
              key,
              label: TAB_LABELS[key],
              badge:
                key === "requests" ? <CountBadge count={requests.data?.length ?? 0} /> : undefined,
            }))}
          />
        </div>
      </div>

      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        {tab === "leaderboard" ? <LeaderboardTab onFind={() => setTab("find")} /> : null}
        {tab === "following" ? <FollowingTab onFind={() => setTab("find")} /> : null}
        {tab === "followers" ? <FollowersTab /> : null}
        {tab === "requests" ? <RequestsTab /> : null}
        {tab === "find" ? <FindTab /> : null}
      </div>

      <div className="mt-8 min-w-0 lg:col-start-2 lg:row-start-2 lg:mt-0">
        <div className="lg:sticky lg:top-0">
          <FriendsSidebar onTab={setTab} suggestions={tab === "requests"} />
        </div>
      </div>
    </div>
  );
}

/** People as a grid of cards, so a short list doesn't stretch one row across the whole page. */
function PeopleGrid({ children }: { children: ReactNode }) {
  return <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</ul>;
}

function PersonCard({
  person,
  state,
  meta,
  action,
  stats = true,
}: {
  person: PersonSummary;
  state?: FollowState;
  meta?: ReactNode;
  action?: ReactNode;
  stats?: boolean;
}) {
  const name = personName(person);
  const href = person.handle ? `/u/${person.handle}` : undefined;
  return (
    <li className="flex min-w-0 flex-col rounded-[var(--lare-r-4)] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface-raised)_40%,transparent)] transition-colors hover:border-[var(--border-strong)]">
      <div className="flex items-start gap-3 p-4 pb-3">
        <ProfileHoverCard handle={person.handle} className="shrink-0">
          {href ? (
            <Link to={href}>
              <Avatar url={person.avatar_url} name={name} size={40} />
            </Link>
          ) : (
            <Avatar url={person.avatar_url} name={name} size={40} />
          )}
        </ProfileHoverCard>
        <div className="min-w-0 flex-1">
          <ProfileHoverCard handle={person.handle} className="flex min-w-0 items-center gap-1.5">
            {href ? (
              <Link
                to={href}
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
          {stats ? <PersonStats handle={person.handle} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {action ??
            (state !== undefined ? (
              <FollowButton
                targetId={person.id}
                handle={person.handle}
                state={state}
                isPrivate={person.is_private}
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

/** Solved, posts and followers for each person; counts only for profiles the viewer can see. */
function PersonStats({ handle }: { handle: string | null }) {
  const stats = useProfileStats(handle);
  if (!handle) return null;
  if (stats.isPending) return <span className="lare-skel mt-2 block h-3 w-32 rounded" />;
  if (!stats.data) return null;
  const items = stats.data.visible
    ? [
        { label: "solved", value: stats.data.problems_solved ?? 0 },
        { label: "posts", value: stats.data.posts ?? 0 },
        { label: "followers", value: stats.data.followers },
      ]
    : [{ label: "followers", value: stats.data.followers }];
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
function since(prefix: string, iso: string): string {
  return `${prefix} ${new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">{children}</h2>;
}

/** Under the lists, so the page always offers somewhere to go next. */
function Suggested({ title = "People to follow" }: { title?: string }) {
  const { people, isPending } = useSuggestedPeople(6);
  if (isPending || people.length === 0) return null;
  return (
    <section className="mt-8">
      <SectionHeading>{title}</SectionHeading>
      <PeopleGrid>
        {people.map((person) => (
          <PersonCard key={person.id} person={person} state="none" />
        ))}
      </PeopleGrid>
    </section>
  );
}

function FollowingTab({ onFind }: { onFind: () => void }) {
  const following = useFollowing();
  if (following.isPending) return <ListSkeleton />;
  if (following.isError) {
    return <ErrorState error={following.error} onRetry={() => void following.refetch()} />;
  }

  const accepted = following.data.filter((row) => row.status === "accepted");
  const sent = following.data.filter((row) => row.status === "pending");

  return (
    <div className="space-y-6">
      {accepted.length === 0 ? (
        <>
          <EmptyState
            icon={<Users className="size-8" aria-hidden />}
            title="You aren't following anyone yet"
            description="Follow people to see their sessions in your feed."
            action={
              <Button size="sm" onClick={onFind} icon={<Search className="size-3.5" aria-hidden />}>
                Find people
              </Button>
            }
          />
        </>
      ) : (
        <PeopleGrid>
          {accepted.map((row) => (
            <PersonCard
              key={row.profiles.id}
              person={row.profiles}
              state="accepted"
              meta={since("Following since", row.created_at)}
            />
          ))}
        </PeopleGrid>
      )}

      {sent.length > 0 ? (
        <section>
          <SectionHeading>Requests you sent</SectionHeading>
          <PeopleGrid>
            {sent.map((row) => (
              <PersonCard
                key={row.profiles.id}
                person={row.profiles}
                state="pending"
                stats={false}
                meta={since("Requested", row.created_at)}
              />
            ))}
          </PeopleGrid>
        </section>
      ) : null}

      <Suggested />
    </div>
  );
}

function FollowersTab() {
  const followers = useFollowers();
  const people = followers.data?.map((row) => row.profiles) ?? [];
  const states = useFollowStates(people.map((p) => p.id));

  if (followers.isPending) return <ListSkeleton />;
  if (followers.isError) {
    return <ErrorState error={followers.error} onRetry={() => void followers.refetch()} />;
  }
  if (followers.data.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Users className="size-8" aria-hidden />}
          title="Nobody follows you yet"
          description="Publish a session, or follow a few people to get started."
        />
        <Suggested />
      </>
    );
  }

  return (
    <>
      <PeopleGrid>
        {followers.data.map((row) => (
          <PersonCard
            key={row.profiles.id}
            person={row.profiles}
            state={states.data?.[row.profiles.id] ?? "none"}
            meta={since("Followed you", row.created_at)}
          />
        ))}
      </PeopleGrid>
      <Suggested />
    </>
  );
}

function RequestsTab() {
  const requests = useFollowRequests();
  if (requests.isPending) return <ListSkeleton />;
  if (requests.isError) {
    return <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />;
  }
  if (requests.data.length === 0) {
    return (
      <EmptyState
        icon={<UserPlus className="size-8" aria-hidden />}
        title="No pending requests"
        description="Requests only appear when your account is private. Public accounts accept follows automatically."
      />
    );
  }
  return (
    <PeopleGrid>
      {requests.data.map((request) => (
        <RequestCard key={request.follower_id} request={request} />
      ))}
    </PeopleGrid>
  );
}

function RequestCard({ request }: { request: FollowRequest }) {
  const respond = useRespondToRequest();
  const { toast } = useToast();
  const person = request.profiles as PersonSummary;
  const name = personName(person);

  const act = (accept: boolean) =>
    respond.mutate(
      { follower: request.follower_id, accept },
      {
        onSuccess: () =>
          toast({ title: accept ? `Accepted ${name}` : `Declined ${name}`, variant: "success" }),
        onError: (err) =>
          toast({
            title: "Couldn't update request",
            description: errorMessage(err),
            variant: "error",
          }),
      },
    );

  return (
    <PersonCard
      person={person}
      meta={since("Requested", request.created_at)}
      action={
        <>
          <Button
            size="sm"
            variant="primary"
            icon={<Check className="size-3.5" aria-hidden />}
            onClick={() => act(true)}
            disabled={respond.isPending}
          >
            Accept
          </Button>
          <Button
            size="sm"
            icon={<X className="size-3.5" aria-hidden />}
            onClick={() => act(false)}
            disabled={respond.isPending}
            aria-label={`Decline ${name}`}
          />
        </>
      }
    />
  );
}

function FindTab() {
  const [term, setTerm] = useState("");
  const deferred = useDeferredValue(term);
  const results = useProfileSearch(deferred);
  const people = results.data ?? [];
  const states = useFollowStates(people.map((p) => p.id));

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
          aria-hidden
        />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by @handle or name"
          aria-label="Search people by handle or name"
          autoComplete="off"
          className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-smooth-out) focus:border-zinc-600 focus:ring-2 focus:ring-zinc-500/50"
        />
      </div>

      {deferred.trim().length === 0 ? (
        <SuggestedOrPrompt />
      ) : results.isPending ? (
        <PageSpinner />
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => void results.refetch()} />
      ) : people.length === 0 ? (
        <EmptyState
          icon={<Search className="size-8" aria-hidden />}
          title={`No profiles match "${deferred.trim()}"`}
          description="Handles are 3–20 lowercase letters, numbers or underscores."
        />
      ) : (
        <PeopleGrid>
          {people.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              state={states.data?.[person.id] ?? "none"}
            />
          ))}
        </PeopleGrid>
      )}
    </div>
  );
}

/** Before a search: people who have been posting, or the search prompt when there are none. */
function SuggestedOrPrompt() {
  const { people, isPending } = useSuggestedPeople(9);
  if (isPending) return <ListSkeleton />;
  if (people.length === 0) {
    return (
      <EmptyState
        icon={<Search className="size-8" aria-hidden />}
        title="Find people to follow"
        description="Search by @handle or display name to open their profile and follow them."
      />
    );
  }
  return (
    <section>
      <SectionHeading>Posting recently</SectionHeading>
      <PeopleGrid>
        {people.map((person) => (
          <PersonCard key={person.id} person={person} state="none" />
        ))}
      </PeopleGrid>
    </section>
  );
}
