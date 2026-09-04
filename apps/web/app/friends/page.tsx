import { Check, Inbox, Search, UserRoundSearch, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { FollowState } from "@/components/follow-button";
import { PendingButton } from "@/components/pending-button";
import { TabNav } from "@/components/tab-nav";
import { TimeAgo } from "@/components/time-ago";
import { type PersonSummary, UserRow } from "@/components/user-row";
import { buttonDanger, buttonPrimary, cardClass, inputClass } from "@/lib/styles";
import { createClient } from "@/lib/supabase/server";
import { getPendingRequestCount, requireViewer } from "@/lib/viewer";
import { acceptFollowRequest, declineFollowRequest } from "./actions";

export const metadata: Metadata = { title: "Friends" };

const TABS = ["following", "followers", "requests", "find"] as const;
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

type Params = { searchParams: Promise<{ tab?: string | string[]; q?: string | string[] }> };

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
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-zinc-50">Friends</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {viewer.profile.is_private
            ? "Your account is private, so people have to request to follow you before they can see your posts."
            : "Your account is public, so new followers are accepted automatically."}
        </p>
      </div>

      <div className="mb-5">
        <TabNav
          label="Friends sections"
          active={tab}
          items={[
            { key: "following", label: "Following", href: href("following") },
            { key: "followers", label: "Followers", href: href("followers") },
            { key: "requests", label: "Requests", href: href("requests"), badge: pendingCount },
            { key: "find", label: "Find people", href: href("find") },
          ]}
        />
      </div>

      {tab === "following" && <FollowingTab viewerId={viewer.id} />}
      {tab === "followers" && <FollowersTab viewerId={viewer.id} />}
      {tab === "requests" && <RequestsTab viewerId={viewer.id} />}
      {tab === "find" && <FindTab viewerId={viewer.id} query={query} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
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

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className={`${cardClass} px-6 py-12 text-center`}>
      <Inbox className="mx-auto size-8 text-zinc-600" />
      <p className="mx-auto mt-3 max-w-sm text-sm text-zinc-400">{children}</p>
    </div>
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
          <ul className={`${cardClass} divide-y divide-zinc-800/80`}>
            {accepted.map((row) => (
              <UserRow
                key={row.profiles.id}
                person={row.profiles}
                viewerId={viewerId}
                followState="accepted"
                meta={
                  <>
                    following since <TimeAgo iso={row.created_at} />
                  </>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {sent.length > 0 && (
        <section aria-label="Requests you sent">
          <h2 className="mb-2 text-sm font-semibold text-zinc-300">Requests you sent</h2>
          <ul className={`${cardClass} divide-y divide-zinc-800/80`}>
            {sent.map((row) => (
              <UserRow
                key={row.profiles.id}
                person={row.profiles}
                viewerId={viewerId}
                followState="pending"
                meta={
                  <>
                    requested <TimeAgo iso={row.created_at} />
                  </>
                }
              />
            ))}
          </ul>
        </section>
      )}
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
  if (rows.length === 0) return <EmptyState>Nobody follows you yet.</EmptyState>;

  const states = await outgoingFollowStates(
    viewerId,
    rows.map((row) => row.profiles.id),
  );

  return (
    <ul className={`${cardClass} divide-y divide-zinc-800/80`}>
      {rows.map((row) => (
        <UserRow
          key={row.profiles.id}
          person={row.profiles}
          viewerId={viewerId}
          followState={states.get(row.profiles.id) ?? "none"}
          meta={
            <>
              followed you <TimeAgo iso={row.created_at} />
            </>
          }
        />
      ))}
    </ul>
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

  return (
    <ul className={`${cardClass} divide-y divide-zinc-800/80`}>
      {rows.map((row) => (
        <UserRow
          key={row.follower_id}
          person={row.profiles}
          viewerId={viewerId}
          meta={
            <>
              requested <TimeAgo iso={row.created_at} />
            </>
          }
          action={
            <div className="flex items-center gap-2">
              <form action={acceptFollowRequest}>
                <input type="hidden" name="follower" value={row.follower_id} />
                <PendingButton className={`${buttonPrimary} px-3 py-1.5 text-xs`}>
                  <Check className="size-3.5" />
                  Accept
                </PendingButton>
              </form>
              <form action={declineFollowRequest}>
                <input type="hidden" name="follower" value={row.follower_id} />
                <PendingButton className={`${buttonDanger} px-3 py-1.5 text-xs`}>
                  <X className="size-3.5" />
                  Decline
                </PendingButton>
              </form>
            </div>
          }
        />
      ))}
    </ul>
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
  const states = await outgoingFollowStates(
    viewerId,
    people.map((p) => p.id),
  );

  return (
    <div className="space-y-4">
      <form action="/friends" method="get" className="flex gap-2">
        <input type="hidden" name="tab" value="find" />
        <label htmlFor="friends-search" className="sr-only">
          Search people by handle or name
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            id="friends-search"
            name="q"
            defaultValue={query}
            placeholder="Search by @handle or name"
            autoComplete="off"
            className={`${inputClass} pl-9`}
          />
        </div>
        <button type="submit" className={`${buttonPrimary} px-4 py-2 text-sm`}>
          Search
        </button>
      </form>

      {query.length === 0 ? (
        <div className={`${cardClass} px-6 py-12 text-center`}>
          <UserRoundSearch className="mx-auto size-8 text-zinc-600" />
          <p className="mx-auto mt-3 max-w-sm text-sm text-zinc-400">
            Search for someone by their @handle or display name to view their profile and follow
            them.
          </p>
        </div>
      ) : people.length === 0 ? (
        <EmptyState>
          No profiles match “{query}”. Handles are 3–20 lowercase letters, numbers or underscores.
        </EmptyState>
      ) : (
        <ul className={`${cardClass} divide-y divide-zinc-800/80`}>
          {people.map((person) => (
            <UserRow
              key={person.id}
              person={person}
              viewerId={viewerId}
              followState={states.get(person.id) ?? "none"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
