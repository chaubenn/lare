import { Lock } from "@lare/ui/icons";
import { Avatar, Badge } from "@lare/ui/primitives";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { routes } from "@/lib/routes";
import { FollowButton } from "./FollowButton";
import type { FollowState, PersonSummary } from "./follows";
import { ProfileHoverCard } from "./ProfileHoverCard";

export function personName(person: PersonSummary): string {
  return person.display_name ?? (person.handle ? `@${person.handle}` : "Unknown user");
}

/**
 * One person in a list of people: avatar, name, a private-account indicator and either a follow
 * button or the caller's own action.
 */
export function UserRow({
  person,
  state,
  action,
}: {
  person: PersonSummary;
  /** Omit to render no follow button. */
  state?: FollowState;
  action?: ReactNode;
}) {
  const name = personName(person);
  const showRequestHint = person.is_private && state !== undefined && state !== "accepted";

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <ProfileHoverCard handle={person.handle} className="shrink-0">
        <ProfileLink handle={person.handle}>
          <Avatar url={person.avatar_url} name={name} size={36} />
        </ProfileLink>
      </ProfileHoverCard>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <ProfileHoverCard handle={person.handle} className="min-w-0 truncate">
            <ProfileLink
              handle={person.handle}
              className="text-sm font-medium text-[var(--text)] hover:underline"
            >
              {name}
            </ProfileLink>
          </ProfileHoverCard>
          {person.is_private ? (
            <Badge>
              <Lock className="size-3" aria-hidden />
              Private
            </Badge>
          ) : null}
        </div>
        <div className="truncate text-xs text-[var(--text-tertiary)]">
          {person.handle ? `@${person.handle}` : null}
        </div>
        {showRequestHint ? (
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
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
    <Link to={routes.user(handle)} className={className}>
      {children}
    </Link>
  );
}
