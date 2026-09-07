import { formatLocalTimestamp } from "@lare/shared";
import { Check, Search, UserPlus, Users, X } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useSearchParams } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { CountBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader, StackedList, StackedListItem } from "@/components/ui/Card";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState, ErrorState, ListSkeleton, PageSpinner } from "@/components/ui/States";
import { useUser } from "@/features/auth/AuthProvider";
import {
  type FollowRequest,
  useFollowRequests,
  useRespondToRequest,
} from "@/features/requests/queries";
import { errorMessage } from "@/lib/supabase";
import {
  type FollowState,
  type PersonSummary,
  useFollowers,
  useFollowing,
  useFollowStates,
  useProfileSearch,
} from "./queries";
import { personName, UserRow } from "./UserRow";

const TABS = ["following", "followers", "requests", "find"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  following: "Following",
  followers: "Followers",
  requests: "Requests",
  find: "Find people",
};

export function FriendsPage() {
  const { profile } = useUser();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "following";
  const requests = useFollowRequests();

  return (
    <>
      <PageHeader
        title="Friends"
        subtitle={
          profile?.is_private
            ? "Your account is private, so people have to request to follow you before they can see your posts."
            : "Your account is public, so new followers are accepted automatically."
        }
      />

      <div className="mb-4">
        <SegmentedTabs
          label="Friends sections"
          value={tab}
          onChange={(key) => setParams({ tab: key })}
          items={TABS.map((key) => ({
            key,
            label: TAB_LABELS[key],
            badge:
              key === "requests" ? <CountBadge count={requests.data?.length ?? 0} /> : undefined,
          }))}
        />
      </div>

      {tab === "following" ? <FollowingTab /> : null}
      {tab === "followers" ? <FollowersTab /> : null}
      {tab === "requests" ? <RequestsTab /> : null}
      {tab === "find" ? <FindTab /> : null}
    </>
  );
}

function PeopleList({ children }: { children: React.ReactNode }) {
  return <StackedList tracks="grid-cols-1">{children}</StackedList>;
}

function FollowingTab() {
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
        <EmptyState
          icon={<Users className="size-8" aria-hidden />}
          title="You aren't following anyone yet"
          description="Use Find people to search by @handle or name."
        />
      ) : (
        <PeopleList>
          {accepted.map((row) => (
            <StackedListItem key={row.profiles.id}>
              <UserRow
                flush
                person={row.profiles}
                state="accepted"
                meta={`following since ${formatLocalTimestamp(row.created_at)}`}
              />
            </StackedListItem>
          ))}
        </PeopleList>
      )}

      {sent.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Requests you sent
          </h2>
          <PeopleList>
            {sent.map((row) => (
              <StackedListItem key={row.profiles.id}>
                <UserRow
                  flush
                  person={row.profiles}
                  state="pending"
                  meta={`requested ${formatLocalTimestamp(row.created_at)}`}
                />
              </StackedListItem>
            ))}
          </PeopleList>
        </section>
      ) : null}
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
      <EmptyState
        icon={<Users className="size-8" aria-hidden />}
        title="Nobody follows you yet"
        description="Publish a session, or follow a few people to get started."
      />
    );
  }

  return (
    <PeopleList>
      {followers.data.map((row) => (
        <StackedListItem key={row.profiles.id}>
          <UserRow
            flush
            person={row.profiles}
            state={states.data?.[row.profiles.id] ?? "none"}
            meta={`followed you ${formatLocalTimestamp(row.created_at)}`}
          />
        </StackedListItem>
      ))}
    </PeopleList>
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
    <PeopleList>
      {requests.data.map((request) => (
        <StackedListItem key={request.follower_id}>
          <RequestRow request={request} />
        </StackedListItem>
      ))}
    </PeopleList>
  );
}

function RequestRow({ request }: { request: FollowRequest }) {
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
    <UserRow
      flush
      person={person}
      meta={`requested ${formatLocalTimestamp(request.created_at)}`}
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
          >
            Decline
          </Button>
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
        <EmptyState
          icon={<Search className="size-8" aria-hidden />}
          title="Find people to follow"
          description="Search by @handle or display name to open their profile and follow them."
        />
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
        <PeopleList>
          {people.map((person) => (
            <StackedListItem key={person.id}>
              <UserRow
                flush
                person={person}
                state={states.data?.[person.id] ?? ("none" as FollowState)}
              />
            </StackedListItem>
          ))}
        </PeopleList>
      )}
    </div>
  );
}
