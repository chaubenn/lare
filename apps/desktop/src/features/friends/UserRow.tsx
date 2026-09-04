import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { FollowButton } from "./FollowButton";
import type { FollowState, PersonSummary } from "./queries";

export function personName(person: PersonSummary): string {
  return person.display_name ?? (person.handle ? `@${person.handle}` : "Unknown user");
}

/**
 * One person in a friends list: avatar, name, a private-account indicator and either a follow
 * button or the caller's own action (accept / decline on the requests tab).
 */
export function UserRow({
  person,
  state,
  meta,
  action,
}: {
  person: PersonSummary;
  /** Omit to render no follow button. */
  state?: FollowState;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  const name = personName(person);
  const showRequestHint = person.is_private && state !== undefined && state !== "accepted";

  return (
    <div className="flex items-center gap-3 p-4">
      <ProfileLink handle={person.handle}>
        <Avatar url={person.avatar_url} name={name} size={36} />
      </ProfileLink>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <ProfileLink
            handle={person.handle}
            className="truncate text-sm font-medium text-zinc-100 hover:underline"
          >
            {name}
          </ProfileLink>
          {person.is_private ? (
            <Badge>
              <Lock className="size-3" aria-hidden />
              Private
            </Badge>
          ) : null}
        </div>
        <div className="truncate text-xs text-zinc-500">
          {person.handle ? `@${person.handle}` : null}
          {person.handle && meta ? " · " : null}
          {meta}
        </div>
        {showRequestHint ? (
          <p className="mt-1 text-xs text-zinc-500">
            {state === "pending"
              ? "Request sent — they still have to approve it."
              : "Request to follow before you can see their sessions."}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
  );
}

function ProfileLink({
  handle,
  className,
  children,
}: {
  handle: string | null;
  className?: string;
  children: ReactNode;
}) {
  if (!handle) return <span className={className}>{children}</span>;
  return (
    <Link to={`/u/${handle}`} className={className}>
      {children}
    </Link>
  );
}
