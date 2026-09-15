import { buttonClass, Card, Container, Input, PageHeader } from "@lare/ui/primitives";
import { ArrowRight, Check, Inbox, Lock, Search, UserRoundSearch, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { Avatar } from "@/components/avatar";
import type { FollowState } from "@/components/follow-button";
import { LeaderboardTab, parseLeaderboardWeek } from "@/components/leaderboard";
import { PendingButton } from "@/components/pending-button";
import {
  displayNameOf,
  PeopleGrid,
  PersonCard,
  type PersonSummary,
  since,
  timeAgo,
} from "@/components/person-card";
import { ProfileHoverCard } from "@/components/profile-hover-card";
import { TabNav } from "@/components/tab-nav";
import { type ProfileStats, parseProfileStats } from "@/lib/parse";
import { createClient } from "@/lib/supabase/server";
import { getPendingRequestCount, type OnboardedViewer, requireViewer } from "@/lib/viewer";
import { acceptFollowRequest, declineFollowRequest } from "./actions";

export const metadata: Metadata = { title: "Friends" };

const TABS = ["leaderboard", "following", "followers", "requests", "find"] as const;
type Tab = (typeof TABS)[number];

const PERSON_COLUMNS = "id, handle, display_name, avatar_url, is_private";
const FOLLOWEE = `profiles!follows_followee_id_fkey(${PERSON_COLUMNS})`;
const FOLLOWER = `profiles!follows_follower_id_fkey(${PERSON_COLUMNS})`;

function parseTab(raw: string | string[] | undefined): Tab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return "following";
  return TABS.includes(value as Tab) ? (value as Tab) : "following";
}

/** Handles are `[a-z0-9_]`; keep the search term to characters PostgREST's `or` filter parses. */
function sanitiseQuery(raw: string | string[] | undefined): string {
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return value
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_ -]/g, " ")
    .trim()
    .slice(0, 40);
}

type Params = {
  searchParams: Promise<{
    tab?: string | string[];
    q?: string | string[];
    week?: string | string[];
  }>;
};

export default async function FriendsPage({ searchParams }: Params) {
  const viewer = await requireViewer("/friends");
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const query = sanitiseQuery(params.q);
  const pendingCount = await getPendingRequestCount(viewer.id);

  const href = (next: Tab) =>
    next === "find" && query
      ? `/friends?tab=find&q=${encodeURIComponent(query)}`
      : `/friends?tab=${next}`;

  return (
    <Container width="wide">
      {/* The side column starts level with the lists, not with the page title. */}
      <div className="grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <PageHeader
            title="Friends"
            subtitle="The people you follow, who follows you, and who to follow next."
          />
          <div className="mb-4">
            <TabNav
              label="Friends sections"
              active={tab}
              items={[
                { key: "leaderboard", label: "Leaderboard", href: href("leaderboard") },
                { key: "following", label: "Following", href: href("following") },
                { key: "followers", label: "Followers", href: href("followers") },
                { key: "requests", label: "Requests", href: href("requests"), badge: pendingCount },
                { key: "find", label: "Find people", href: href("find") },
              ]}
            />
          </div>
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          {tab === "leaderboard" && (
            <LeaderboardTab viewerId={viewer.id} week={parseLeaderboardWeek(params.week)} />
          )}
          {tab === "following" && <FollowingTab viewerId={viewer.id} />}
          {tab === "followers" && <FollowersTab viewerId={viewer.id} />}
          {tab === "requests" && <RequestsTab viewerId={viewer.id} />}
          {tab === "find" && <FindTab viewerId={viewer.id} query={query} />}
        </div>

        <div className="mt-8 min-w-0 lg:col-start-2 lg:row-start-2 lg:mt-0">
          <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Your network">
            <Suspense fallback={<PanelSkeleton />}>
              <NetworkPanel viewer={viewer} pendingCount={pendingCount} />
            </Suspense>
            <Suspense fallback={<PanelSkeleton />}>
              <RecentlyActivePanel viewerId={viewer.id} />
            </Suspense>
            {tab === "requests" && (
              <Suspense fallback={null}>
                <SuggestionsPanel viewerId={viewer.id} />
              </Suspense>
            )}
          </aside>
        </div>
      </div>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** The viewer's own outgoing edges towards `ids`, so lists can show Follow / Requested / Following. */
async function outgoingFollowStates(
  viewerId: string,
  ids: string[],
): Promise<Map<string, FollowState>> {
  const states = new Map<string, FollowState>();
  if (ids.length === 0) return states;
  const supabase = await createClient();
  const { data } = await supabase
    .from("follows")
    .select("followee_id, status")
    .eq("follower_id", viewerId)
    .in("followee_id", ids);
  for (const row of data ?? []) states.set(row.followee_id, row.status);
  return states;
}

/** Counts for every card, fetched together. The RPC applies each profile's own visibility. */
async function statsFor(people: PersonSummary[]): Promise<Map<string, ProfileStats | null>> {
  const supabase = await createClient();
  const handles = [...new Set(people.map((p) => p.handle).filter((h): h is string => !!h))];
  const results = await Promise.all(
    handles.map((handle) => supabase.rpc("profile_stats", { target_handle: handle })),
  );
  return new Map(handles.map((handle, i) => [handle, parseProfileStats(results[i]?.data)]));
}

interface RecentPost {
  id: string;
  slug: string;
  title: string | null;
  user_id: string;
  published_at: string | null;
  created_at: string;
  profiles: Omit<PersonSummary, "id"> | null;
}

/** A light slice of the feed: who posted what, without the media the feed card needs. */
async function recentPosts(scope: "all" | "following"): Promise<RecentPost[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .rpc("feed", { page_size: 30, scope })
    .select(
      "id, slug, title, user_id, published_at, created_at, profiles!posts_user_id_fkey(handle, display_name, avatar_url, is_private)",
    )
    .overrideTypes<RecentPost[], { merge: false }>();
  return data ?? [];
}

/** People posting publicly whom the viewer doesn't follow yet, most recent poster first. */
async function suggestedPeople(
  viewerId: string,
  limit: number,
): Promise<(PersonSummary & { lastPostAt: string })[]> {
  const authors = new Map<string, PersonSummary & { lastPostAt: string }>();
  for (const post of await recentPosts("all")) {
    const p = post.profiles;
    if (!p?.handle || post.user_id === viewerId || authors.has(post.user_id)) continue;
    authors.set(post.user_id, {
      id: post.user_id,
      ...p,
      lastPostAt: post.published_at ?? post.created_at,
    });
  }
  const candidates = [...authors.values()];
  const states = await outgoingFollowStates(
    viewerId,
    candidates.map((c) => c.id),
  );
  return candidates.filter((c) => (states.get(c.id) ?? "none") === "none").slice(0, limit);
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Card className="px-6 py-12 text-center">
      <Inbox className="mx-auto size-8 text-[var(--text-tertiary)]" />
      <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--text-secondary)]">{children}</p>
    </Card>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">{children}</h2>;
}

/** Under the lists, so the page always offers somewhere to go next. */
async function Suggested({
  viewerId,
  title = "People to follow",
  limit = 6,
}: {
  viewerId: string;
  title?: string;
  limit?: number;
}) {
  const people = await suggestedPeople(viewerId, limit);
  if (people.length === 0) return null;
  const stats = await statsFor(people);
  return (
    <section className="mt-8">
      <SectionHeading>{title}</SectionHeading>
      <PeopleGrid>
        {people.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            viewerId={viewerId}
            followState="none"
            stats={person.handle ? stats.get(person.handle) : null}
            meta={`Posted ${timeAgo(person.lastPostAt)}`}
          />
        ))}
      </PeopleGrid>
    </section>
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

function PanelSkeleton() {
  return <div className="lare-skel h-32 rounded-[var(--lare-r-4)]" />;
}

const panelLink =
  "inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text)]";

// ---------------------------------------------------------------------------
// Side column
// ---------------------------------------------------------------------------

async function NetworkPanel({
  viewer,
  pendingCount,
}: {
  viewer: OnboardedViewer;
  pendingCount: number;
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("profile_stats", { target_handle: viewer.profile.handle });
  const stats = parseProfileStats(data);
  const items: { tab: Tab; label: string; value: number | undefined }[] = [
    { tab: "following", label: "Following", value: stats?.following },
    { tab: "followers", label: "Followers", value: stats?.followers },
    { tab: "requests", label: "Requests", value: pendingCount },
  ];
  return (
    <Panel title="Your network">
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <Link
            key={item.tab}
            href={`/friends?tab=${item.tab}`}
            className="rounded-[var(--lare-r-2)] px-2 py-1.5 transition-colors hover:bg-[color-mix(in_oklab,var(--border)_60%,transparent)]"
          >
            <span className="block text-xl font-semibold leading-tight tabular-nums text-[var(--text)]">
              {item.value ?? "—"}
            </span>
            <span className="block text-xs text-[var(--text-secondary)]">{item.label}</span>
          </Link>
        ))}
      </div>
      <p className="mt-3 flex items-start gap-1.5 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-secondary)]">
        {viewer.profile.is_private ? <Lock className="mt-0.5 size-3 shrink-0" aria-hidden /> : null}
        <span>
          {viewer.profile.is_private
            ? "Private account: people request to follow you."
            : "Public account: follows are accepted automatically."}{" "}
          <Link href="/settings" className="underline underline-offset-2 hover:text-[var(--text)]">
            Change
          </Link>
        </span>
      </p>
    </Panel>
  );
}

/** The latest post from each person the viewer follows. */
async function RecentlyActivePanel({ viewerId }: { viewerId: string }) {
  const latest = new Map<string, RecentPost>();
  for (const post of await recentPosts("following")) {
    if (post.user_id === viewerId || latest.has(post.user_id)) continue;
    latest.set(post.user_id, post);
  }
  const posts = [...latest.values()].slice(0, 5);
  return (
    <Panel
      title="Recently active"
      action={
        posts.length > 0 ? (
          <Link href="/?scope=following" className={panelLink}>
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
            const name = p?.display_name || (p?.handle ? `@${p.handle}` : "Someone");
            const profileHref = p?.handle ? `/u/${p.handle}` : `/p/${post.slug}`;
            return (
              <li key={post.id} className="flex items-start gap-2.5">
                <ProfileHoverCard handle={p?.handle} viewerId={viewerId} className="shrink-0">
                  <Link href={profileHref}>
                    <Avatar src={p?.avatar_url} name={name} size="sm" />
                  </Link>
                </ProfileHoverCard>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-1.5 text-sm">
                    <ProfileHoverCard
                      handle={p?.handle}
                      viewerId={viewerId}
                      className="min-w-0 truncate"
                    >
                      <Link
                        href={profileHref}
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
                    href={`/p/${post.slug}`}
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

async function SuggestionsPanel({ viewerId }: { viewerId: string }) {
  const people = await suggestedPeople(viewerId, 4);
  if (people.length === 0) return null;
  return (
    <Panel
      title="People to follow"
      action={
        <Link href="/friends?tab=find" className={panelLink}>
          Find more <ArrowRight className="size-3" aria-hidden />
        </Link>
      }
    >
      <ul className="space-y-3">
        {people.map((person) => {
          const name = displayNameOf(person);
          return (
            <li key={person.id} className="flex items-center gap-2.5">
              <ProfileHoverCard handle={person.handle} viewerId={viewerId} className="shrink-0">
                <Link href={`/u/${person.handle}`}>
                  <Avatar src={person.avatar_url} name={name} size="sm" />
                </Link>
              </ProfileHoverCard>
              <div className="min-w-0 flex-1">
                <ProfileHoverCard
                  handle={person.handle}
                  viewerId={viewerId}
                  className="block truncate"
                >
                  <Link
                    href={`/u/${person.handle}`}
                    className="text-sm font-medium text-[var(--text)] hover:underline"
                  >
                    {name}
                  </Link>
                </ProfileHoverCard>
                <p className="truncate text-xs text-[var(--text-tertiary)]">
                  posted {timeAgo(person.lastPostAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

async function FollowingTab({ viewerId }: { viewerId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("follows")
    .select(`created_at, status, ${FOLLOWEE}`)
    .eq("follower_id", viewerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Couldn't load following: ${error.message}`);

  const accepted = (data ?? []).filter((row) => row.status === "accepted");
  const sent = (data ?? []).filter((row) => row.status === "pending");
  const stats = await statsFor(accepted.map((row) => row.profiles));

  return (
    <div className="space-y-6">
      <section aria-label="Following">
        {accepted.length === 0 ? (
          <EmptyState>
            You aren't following anyone yet.{" "}
            <Link href="/friends?tab=find" className="text-zinc-200 underline underline-offset-2">
              Find people
            </Link>{" "}
            to fill your feed.
          </EmptyState>
        ) : (
          <PeopleGrid>
            {accepted.map((row) => (
              <PersonCard
                key={row.profiles.id}
                person={row.profiles}
                viewerId={viewerId}
                followState="accepted"
                stats={row.profiles.handle ? stats.get(row.profiles.handle) : null}
                meta={since("Following since", row.created_at)}
              />
            ))}
          </PeopleGrid>
        )}
      </section>

      {sent.length > 0 && (
        <section aria-label="Requests you sent">
          <SectionHeading>Requests you sent</SectionHeading>
          <PeopleGrid>
            {sent.map((row) => (
              <PersonCard
                key={row.profiles.id}
                person={row.profiles}
                viewerId={viewerId}
                followState="pending"
                meta={since("Requested", row.created_at)}
              />
            ))}
          </PeopleGrid>
        </section>
      )}

      <Suspense fallback={null}>
        <Suggested viewerId={viewerId} />
      </Suspense>
    </div>
  );
}

async function FollowersTab({ viewerId }: { viewerId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("follows")
    .select(`created_at, ${FOLLOWER}`)
    .eq("followee_id", viewerId)
    .eq("status", "accepted")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Couldn't load followers: ${error.message}`);

  const rows = data ?? [];
  const people = rows.map((row) => row.profiles);
  const [states, stats] = await Promise.all([
    outgoingFollowStates(
      viewerId,
      people.map((p) => p.id),
    ),
    statsFor(people),
  ]);

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState>Nobody follows you yet. Publish a session, or follow a few people.</EmptyState>
      ) : (
        <PeopleGrid>
          {rows.map((row) => (
            <PersonCard
              key={row.profiles.id}
              person={row.profiles}
              viewerId={viewerId}
              followState={states.get(row.profiles.id) ?? "none"}
              stats={row.profiles.handle ? stats.get(row.profiles.handle) : null}
              meta={since("Followed you", row.created_at)}
            />
          ))}
        </PeopleGrid>
      )}
      <Suspense fallback={null}>
        <Suggested viewerId={viewerId} />
      </Suspense>
    </>
  );
}

async function RequestsTab({ viewerId }: { viewerId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("follows")
    .select(`follower_id, created_at, ${FOLLOWER}`)
    .eq("followee_id", viewerId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Couldn't load requests: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) {
    return <EmptyState>No pending requests. People who ask to follow you land here.</EmptyState>;
  }
  const stats = await statsFor(rows.map((row) => row.profiles));

  return (
    <PeopleGrid>
      {rows.map((row) => (
        <PersonCard
          key={row.follower_id}
          person={row.profiles}
          viewerId={viewerId}
          stats={row.profiles.handle ? stats.get(row.profiles.handle) : null}
          meta={since("Requested", row.created_at)}
          action={
            <>
              <form action={acceptFollowRequest}>
                <input type="hidden" name="follower" value={row.follower_id} />
                <PendingButton variant="primary" size="sm">
                  <Check className="size-3.5" />
                  Accept
                </PendingButton>
              </form>
              <form action={declineFollowRequest}>
                <input type="hidden" name="follower" value={row.follower_id} />
                <PendingButton variant="secondary" size="sm" tooltip="Decline">
                  <X className="size-3.5" aria-hidden />
                  <span className="sr-only">Decline {displayNameOf(row.profiles)}</span>
                </PendingButton>
              </form>
            </>
          }
        />
      ))}
    </PeopleGrid>
  );
}

async function FindTab({ viewerId, query }: { viewerId: string; query: string }) {
  const supabase = await createClient();
  let people: PersonSummary[] = [];
  if (query.length > 0) {
    const term = `%${query}%`;
    const { data, error } = await supabase
      .from("profiles")
      .select(PERSON_COLUMNS)
      .not("handle", "is", null)
      .neq("id", viewerId)
      .or(`handle.ilike.${term},display_name.ilike.${term}`)
      .order("handle")
      .limit(25);
    if (error) throw new Error(`Search failed: ${error.message}`);
    people = (data ?? []) as PersonSummary[];
  }
  const [states, stats] = await Promise.all([
    outgoingFollowStates(
      viewerId,
      people.map((p) => p.id),
    ),
    statsFor(people),
  ]);

  return (
    <div className="space-y-4">
      <form action="/friends" method="get" className="flex gap-2">
        <input type="hidden" name="tab" value="find" />
        <label htmlFor="friends-search" className="sr-only">
          Search people by handle or name
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <Input
            id="friends-search"
            name="q"
            defaultValue={query}
            placeholder="Search by @handle or name"
            autoComplete="off"
            className="pl-9"
          />
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Search
        </button>
      </form>

      {query.length === 0 ? (
        <Suspense fallback={null}>
          <SuggestedOrPrompt viewerId={viewerId} />
        </Suspense>
      ) : people.length === 0 ? (
        <EmptyState>
          No profiles match “{query}”. Handles are 3–20 lowercase letters, numbers or underscores.
        </EmptyState>
      ) : (
        <PeopleGrid>
          {people.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              viewerId={viewerId}
              followState={states.get(person.id) ?? "none"}
              stats={person.handle ? stats.get(person.handle) : null}
            />
          ))}
        </PeopleGrid>
      )}
    </div>
  );
}

/** Before a search: people who have been posting, or the search prompt when there are none. */
async function SuggestedOrPrompt({ viewerId }: { viewerId: string }) {
  const people = await suggestedPeople(viewerId, 9);
  if (people.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <UserRoundSearch className="mx-auto size-8 text-zinc-600" />
        <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--text-secondary)]">
          Search for someone by their @handle or display name to view their profile and follow them.
        </p>
      </Card>
    );
  }
  return <Suggested viewerId={viewerId} title="Posting recently" limit={9} />;
}
