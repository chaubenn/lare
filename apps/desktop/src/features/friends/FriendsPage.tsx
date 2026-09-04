import { formatRelativeTime } from "@lare/shared";
import { cn } from "@lare/ui";
import { Check, Search, UserPlus, Users, X } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useSearchParams } from "react-router";
import { useToast } from "@/components/toast/ToastProvider";
import { CountBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, PageSpinner } from "@/components/ui/States";
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

      <div className="mb-5 inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-1">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            aria-current={key === tab ? "page" : undefined}
            onClick={() => setParams({ tab: key })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
              key === tab
                ? "bg-zinc-800 font-medium text-zinc-50"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
            )}
          >
            {TAB_LABELS[key]}
            {key === "requests" ? <CountBadge count={requests.data?.length ?? 0} /> : null}
          </button>
        ))}
      </div>

      {tab === "following" ? <FollowingTab /> : null}
      {tab === "followers" ? <FollowersTab /> : null}
      {tab === "requests" ? <RequestsTab /> : null}
      {tab === "find" ? <FindTab /> : null}
    </>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800">{children}</ul>
  );
}

function FollowingTab() {
  const following = useFollowing();
  if (following.isPending) return <PageSpinner />;
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
        <List>
          {accepted.map((row) => (
            <li key={row.profiles.id}>
              <UserRow
                person={row.profiles}
                state="accepted"
                meta={`following since ${formatRelativeTime(row.created_at)}`}
              />
            </li>
          ))}
        </List>
      )}

      {sent.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Requests you sent
          </h2>
          <List>
            {sent.map((row) => (
              <li key={row.profiles.id}>
                <UserRow
                  person={row.profiles}
                  state="pending"
                  meta={`requested ${formatRelativeTime(row.created_at)}`}
                />
              </li>
            ))}
          </List>
        </section>
      ) : null}
    </div>
  );
}

function FollowersTab() {
  const followers = useFollowers();
  const people = followers.data?.map((row) => row.profiles) ?? [];
  const states = useFollowStates(people.map((p) => p.id));

  if (followers.isPending) return <PageSpinner />;
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
    <List>
      {followers.data.map((row) => (
        <li key={row.profiles.id}>
          <UserRow
            person={row.profiles}
            state={states.data?.[row.profiles.id] ?? "none"}
            meta={`followed you ${formatRelativeTime(row.created_at)}`}
          />
        </li>
      ))}
    </List>
  );
}

function RequestsTab() {
  const requests = useFollowRequests();
  if (requests.isPending) return <PageSpinner />;
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
    <List>
      {requests.data.map((request) => (
        <li key={request.follower_id}>
          <RequestRow request={request} />
        </li>
      ))}
    </List>
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
      person={person}
      meta={`requested ${formatRelativeTime(request.created_at)}`}
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
          className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600"
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
        <List>
          {people.map((person) => (
            <li key={person.id}>
              <UserRow
                person={person}
                state={states.data?.[person.id] ?? ("none" as FollowState)}
              />
            </li>
          ))}
        </List>
      )}
    </div>
  );
}
